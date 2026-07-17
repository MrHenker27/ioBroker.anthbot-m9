'use strict';

const crypto = require('node:crypto');
const mqtt = require('mqtt');

const DEFAULT_RECONNECT_DELAY_MS = 15000;
const DEFAULT_URL_EXPIRES_SECONDS = 900;

function awsEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, character =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function hmac(key, value, encoding = undefined) {
    return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function signingKey(secretAccessKey, dateStamp, regionName) {
    const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
    const regionKey = hmac(dateKey, regionName);
    const serviceKey = hmac(regionKey, 'iotdevicegateway');
    return hmac(serviceKey, 'aws4_request');
}

/**
 * Builds the SigV4 WebSocket URL used by the official app's MQTT client.
 * The XAPK contains MQTT.js together with AWS IoT's `/mqtt` WebSocket path
 * and named-shadow subscriptions.
 *
 * @param {object} params
 * @param {string} params.endpoint
 * @param {string} params.regionName
 * @param {string} params.accessKeyId
 * @param {string} params.secretAccessKey
 * @param {string|null|undefined} params.sessionToken
 * @param {Date} [params.now]
 * @param {number} [params.expiresSeconds]
 * @returns {string}
 */
function buildPresignedMqttUrl({
    endpoint,
    regionName,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    now = new Date(),
    expiresSeconds = DEFAULT_URL_EXPIRES_SECONDS,
}) {
    const host = String(endpoint).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${regionName}/iotdevicegateway/aws4_request`;

    const query = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(Math.max(1, Math.min(86400, Math.trunc(expiresSeconds)))),
        'X-Amz-SignedHeaders': 'host',
    };

    const canonicalQuery = Object.entries(query)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
        .join('&');

    const canonicalRequest = [
        'GET',
        '/mqtt',
        canonicalQuery,
        `host:${host}\n`,
        'host',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'),
    ].join('\n');

    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const signature = crypto
        .createHmac('sha256', signingKey(secretAccessKey, dateStamp, regionName))
        .update(stringToSign, 'utf8')
        .digest('hex');

    let url = `wss://${host}/mqtt?${canonicalQuery}&X-Amz-Signature=${signature}`;
    if (sessionToken) {
        url += `&X-Amz-Security-Token=${awsEncode(sessionToken)}`;
    }
    return url;
}

function shadowTopics(serialNumber, shadowName) {
    const base = `$aws/things/${serialNumber}/shadow/name/${shadowName}`;
    return {
        get: `${base}/get`,
        getAccepted: `${base}/get/accepted`,
        updateAccepted: `${base}/update/accepted`,
        updateDocuments: `${base}/update/documents`,
        updateRejected: `${base}/update/rejected`,
    };
}

function reportedStateFromMessage(topic, payload) {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload));
    } catch {
        return null;
    }

    if (topic.endsWith('/update/documents')) {
        const reported = parsed?.current?.state?.reported;
        return reported && typeof reported === 'object' ? reported : null;
    }

    const reported = parsed?.state?.reported;
    return reported && typeof reported === 'object' ? reported : null;
}

class AnthbotMqttShadowClient {
    /**
     * @param {object} config
     * @param {string} config.serialNumber
     * @param {() => Promise<object>} config.credentialsProvider
     * @param {(state: object, metadata: object) => Promise<void>|void} config.onPropertyState
     * @param {(state: object, metadata: object) => Promise<void>|void} config.onServiceState
     * @param {(status: object) => Promise<void>|void} config.onStatus
     * @param {(level: string, message: string) => void} [config.log]
     */
    constructor({
        serialNumber,
        credentialsProvider,
        onPropertyState,
        onServiceState,
        onStatus,
        log = () => {},
    }) {
        this.serialNumber = serialNumber;
        this.credentialsProvider = credentialsProvider;
        this.onPropertyState = onPropertyState;
        this.onServiceState = onServiceState;
        this.onStatus = onStatus;
        this.log = log;
        this.client = null;
        this.stopped = true;
        this.connecting = false;
        this.reconnectTimer = null;
        this.credentialTimer = null;
        this.messageChain = Promise.resolve();
        this.reconnectCount = 0;
        this.lastMessageAt = null;
        this.lastError = '';
    }

    get connected() {
        return Boolean(this.client?.connected);
    }

    async start() {
        if (!this.stopped) {
            return;
        }
        this.stopped = false;
        await this.connect();
    }

    async stop() {
        this.stopped = true;
        this.connecting = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.credentialTimer) {
            clearTimeout(this.credentialTimer);
            this.credentialTimer = null;
        }
        const client = this.client;
        this.client = null;
        if (client) {
            await new Promise(resolve => client.end(true, {}, resolve));
        }
        await this.emitStatus('stopped');
    }

    async reconnectNow() {
        if (this.stopped) {
            return;
        }
        const client = this.client;
        this.client = null;
        if (client) {
            await new Promise(resolve => client.end(true, {}, resolve));
        }
        await this.connect();
    }

    async connect() {
        if (this.stopped || this.connecting || this.connected) {
            return;
        }
        this.connecting = true;
        await this.emitStatus('connecting');

        try {
            const credentials = await this.credentialsProvider();
            const regionName = credentials.regionName;
            const endpoint = credentials.endpoint;
            const expiresSeconds = credentials.expiresAt
                ? Math.max(60, Math.min(DEFAULT_URL_EXPIRES_SECONDS, Math.floor((credentials.expiresAt - Date.now()) / 1000) - 30))
                : DEFAULT_URL_EXPIRES_SECONDS;
            const url = buildPresignedMqttUrl({
                endpoint,
                regionName,
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
                expiresSeconds,
            });

            const clientId = `mqttjs_${crypto.randomBytes(8).toString('hex')}`;
            const client = mqtt.connect(url, {
                protocolVersion: 4,
                clientId,
                clean: true,
                keepalive: 30,
                reconnectPeriod: 0,
                connectTimeout: 20000,
                resubscribe: false,
                rejectUnauthorized: true,
            });
            this.client = client;

            client.on('connect', () => this.handleConnect(credentials));
            client.on('message', (topic, payload) => this.handleMessage(topic, payload));
            client.on('error', error => this.handleError(error));
            client.on('close', () => this.handleClose());
            client.on('offline', () => this.emitStatus('offline'));
        } catch (error) {
            this.lastError = error?.message || String(error);
            this.log('debug', `MQTT setup failed for ${this.serialNumber}: ${this.lastError}`);
            await this.emitStatus('error');
            this.scheduleReconnect();
        } finally {
            this.connecting = false;
        }
    }

    async handleConnect(credentials) {
        this.reconnectCount += 1;
        this.lastError = '';
        const property = shadowTopics(this.serialNumber, 'property');
        const service = shadowTopics(this.serialNumber, 'service');
        const subscriptions = [
            property.getAccepted,
            property.updateAccepted,
            property.updateDocuments,
            property.updateRejected,
            service.getAccepted,
            service.updateAccepted,
            service.updateDocuments,
            service.updateRejected,
        ];

        this.client.subscribe(subscriptions, { qos: 0 }, error => {
            if (error) {
                this.handleError(error);
                return;
            }
            this.client.publish(property.get, '', { qos: 0 });
            this.client.publish(service.get, '', { qos: 0 });
        });

        if (this.credentialTimer) {
            clearTimeout(this.credentialTimer);
        }
        if (credentials.expiresAt) {
            const delay = Math.max(60000, credentials.expiresAt - Date.now() - 60000);
            this.credentialTimer = setTimeout(() => this.reconnectNow(), delay);
        }
        await this.emitStatus('connected');
    }

    handleMessage(topic, payload) {
        this.lastMessageAt = new Date().toISOString();
        this.messageChain = this.messageChain
            .then(async () => {
                if (topic.endsWith('/rejected')) {
                    this.lastError = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
                    await this.emitStatus('connected');
                    return;
                }
                const state = reportedStateFromMessage(topic, payload);
                if (!state) {
                    return;
                }
                const metadata = { topic, receivedAt: this.lastMessageAt };
                if (topic.includes('/shadow/name/property/')) {
                    await this.onPropertyState(state, metadata);
                } else if (topic.includes('/shadow/name/service/')) {
                    await this.onServiceState(state, metadata);
                }
                await this.emitStatus('connected');
            })
            .catch(error => {
                this.lastError = error?.message || String(error);
                this.log('warn', `MQTT message handling failed for ${this.serialNumber}: ${this.lastError}`);
            });
    }

    handleError(error) {
        this.lastError = error?.message || String(error);
        this.log('debug', `MQTT error for ${this.serialNumber}: ${this.lastError}`);
        this.emitStatus('error');
    }

    handleClose() {
        if (this.client) {
            this.client.removeAllListeners();
            this.client = null;
        }
        if (!this.stopped) {
            this.emitStatus('disconnected');
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            await this.connect();
        }, DEFAULT_RECONNECT_DELAY_MS);
    }

    async emitStatus(state) {
        await this.onStatus({
            state,
            connected: this.connected,
            reconnectCount: this.reconnectCount,
            lastMessageAt: this.lastMessageAt,
            lastError: this.lastError,
        });
    }
}

module.exports = {
    AnthbotMqttShadowClient,
    awsEncode,
    buildPresignedMqttUrl,
    reportedStateFromMessage,
    shadowTopics,
};
