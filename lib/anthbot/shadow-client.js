'use strict';

const crypto = require('node:crypto');

const { DEFAULT_IOT_ENDPOINT, DEFAULT_IOT_REGION, IOT_ENDPOINT_TEMPLATE } = require('./constants');
const { AnthbotGenieError, asInteger, firstPresent, isMSeriesModel } = require('./utils');

/** @typedef {[requestUri: string, includeSdkHeaders: boolean, canonicalUriOverride: string | null, signContentLength: boolean]} PublishAttempt */

/** Client for AWS IoT shadow communication for a mower. */
class AnthbotShadowApiClient {
    /**
     * @param {object} config
     * @param {object} config.http
     * @param {string} config.serialNumber
     * @param {string|null} config.regionName
     * @param {string|null} config.iotEndpoint
     * @param {object|null} [config.accountClient]
     * @param {object|null} [config.iotCredentials]
     * @param {string|null} [config.deviceModel]
     */
    constructor({
        http,
        serialNumber,
        regionName,
        iotEndpoint,
        accountClient = null,
        iotCredentials = null,
        deviceModel = null,
    }) {
        this.http = http;
        this.serialNumber = serialNumber;
        this.regionName = typeof regionName === 'string' && regionName ? regionName : null;
        this.iotEndpoint = AnthbotShadowApiClient.normalizeEndpoint(iotEndpoint);
        this.accountClient = accountClient && typeof accountClient === 'object' ? accountClient : null;
        this.deviceModel = typeof deviceModel === 'string' && deviceModel ? deviceModel : null;
        this.iotCredentials = null;
        if (iotCredentials && typeof iotCredentials === 'object') {
            this.setTemporaryCredentials(iotCredentials);
        }
    }

    /**
     * @param {object|null} iotCredentials
     */
    setTemporaryCredentials(iotCredentials) {
        this.iotCredentials = iotCredentials && typeof iotCredentials === 'object' ? iotCredentials : null;
        if (typeof this.iotCredentials?.regionName === 'string' && this.iotCredentials.regionName) {
            this.regionName = this.iotCredentials.regionName;
        }
        if (typeof this.iotCredentials?.endpoint === 'string' && this.iotCredentials.endpoint) {
            this.iotEndpoint = AnthbotShadowApiClient.normalizeEndpoint(this.iotCredentials.endpoint);
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async refreshTemporaryCredentials() {
        if (!this.accountClient || typeof this.accountClient.getDeviceIotCredentials !== 'function') {
            throw new AnthbotGenieError('IoT credential refresh client not configured');
        }
        const credentials = await this.accountClient.getDeviceIotCredentials(this.serialNumber);
        this.setTemporaryCredentials(credentials);
    }

    /**
     * @param {number} status
     * @returns {boolean}
     */
    static isForbiddenStatus(status) {
        return status === 403;
    }

    /**
     * @param {string} iotEndpoint
     * @returns {string}
     */
    static normalizeEndpoint(iotEndpoint) {
        if (typeof iotEndpoint !== 'string' || !iotEndpoint) {
            return DEFAULT_IOT_ENDPOINT;
        }
        return (
            iotEndpoint
                .trim()
                .replace(/^https?:\/\//i, '')
                .replace(/\/+$/, '') || DEFAULT_IOT_ENDPOINT
        );
    }

    /**
     * @param {string} iotEndpoint
     * @returns {string|null}
     */
    static guessRegionFromEndpoint(iotEndpoint) {
        if (!iotEndpoint || !String(iotEndpoint).includes('.iot.')) {
            return null;
        }
        const right = String(iotEndpoint).split('.iot.', 2)[1];
        const region = right.split('.', 1)[0];
        return region || null;
    }

    /** Resolve the AWS signing region for the current endpoint. */
    get signingRegion() {
        return (
            AnthbotShadowApiClient.guessRegionFromEndpoint(this.iotEndpoint) || this.regionName || DEFAULT_IOT_REGION
        );
    }

    /**
     * @param {string} regionName
     * @returns {string}
     */
    static buildDefaultIotEndpointForRegion(regionName) {
        return IOT_ENDPOINT_TEMPLATE.replace('{region}', regionName);
    }

    /** Get the active AWS access key id for SigV4 request signing. */
    accessKeyId() {
        if (typeof this.iotCredentials?.accessKeyId === 'string' && this.iotCredentials.accessKeyId) {
            return this.iotCredentials.accessKeyId;
        }
        throw new AnthbotGenieError('Temporary IoT credentials are required for shadow access');
    }

    /** Get the active AWS secret key for SigV4 request signing. */
    secretAccessKey() {
        if (typeof this.iotCredentials?.secretAccessKey === 'string' && this.iotCredentials.secretAccessKey) {
            return this.iotCredentials.secretAccessKey;
        }
        throw new AnthbotGenieError('Temporary IoT credentials are required for shadow access');
    }

    /**
     * @returns {string|null}
     */
    sessionToken() {
        return typeof this.iotCredentials?.sessionToken === 'string' && this.iotCredentials.sessionToken
            ? this.iotCredentials.sessionToken
            : null;
    }

    /**
     * @param {Buffer|string} key
     * @param {string} msg
     * @returns {Buffer}
     */
    sign(key, msg) {
        return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
    }

    /**
     * @param {string} dateStamp
     * @returns {Buffer}
     */
    signingKey(dateStamp) {
        const kDate = this.sign(Buffer.from(`AWS4${this.secretAccessKey()}`, 'utf8'), dateStamp);
        const kRegion = this.sign(kDate, this.signingRegion);
        const kService = this.sign(kRegion, 'iotdata');
        return this.sign(kService, 'aws4_request');
    }

    /**
     * @param {{ amzDate: string, dateStamp: string, canonicalRequest: string }} params
     * @returns {string}
     */
    buildAuthorization({ amzDate, dateStamp, canonicalRequest }) {
        const algorithm = 'AWS4-HMAC-SHA256';
        const signedHeaders = this.signedHeadersFromRequest(canonicalRequest);
        const credentialScope = `${dateStamp}/${this.signingRegion}/iotdata/aws4_request`;
        const stringToSign = [
            algorithm,
            amzDate,
            credentialScope,
            crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
        ].join('\n');
        const signature = crypto
            .createHmac('sha256', this.signingKey(dateStamp))
            .update(stringToSign, 'utf8')
            .digest('hex');
        return `${algorithm} Credential=${this.accessKeyId()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    }

    /**
     * @param {string|number|boolean|null|undefined} value
     * @returns {string}
     */
    static normalizeHeaderValue(value) {
        return String(value).trim().split(/\s+/).join(' ');
    }

    /**
     * @param {object} headers
     * @returns {{ canonical: string, signedHeaders: string }}
     */
    static canonicalHeaders(headers) {
        const lowered = {};
        for (const [key, value] of Object.entries(headers)) {
            lowered[key.toLowerCase()] = AnthbotShadowApiClient.normalizeHeaderValue(value);
        }
        const orderedKeys = Object.keys(lowered).sort();
        return {
            canonical: orderedKeys.map(key => `${key}:${lowered[key]}\n`).join(''),
            signedHeaders: orderedKeys.join(';'),
        };
    }

    /**
     * @param {string} canonicalRequest
     * @returns {string}
     */
    signedHeadersFromRequest(canonicalRequest) {
        const parts = canonicalRequest.split('\n');
        return parts.length >= 6 ? parts[parts.length - 2] : 'host;x-amz-content-sha256;x-amz-date';
    }

    /**
     * @param {string} requestUri
     * @returns {string}
     */
    static canonicalUriForSigv4(requestUri) {
        const encoded = [];
        for (const byte of Buffer.from(requestUri, 'utf8')) {
            if (
                (byte >= 0x30 && byte <= 0x39) ||
                (byte >= 0x41 && byte <= 0x5a) ||
                (byte >= 0x61 && byte <= 0x7a) ||
                [45, 46, 95, 126, 47].includes(byte)
            ) {
                encoded.push(String.fromCharCode(byte));
            } else {
                encoded.push(`%${byte.toString(16).toUpperCase().padStart(2, '0')}`);
            }
        }
        return encoded.join('');
    }

    /**
     * @param {string} shadowName
     * @param {boolean} [allowCredentialRefresh]
     * @returns {Promise<object>}
     */
    async getNamedShadowReportedState(shadowName, allowCredentialRefresh = true) {
        const requestUri = `/things/${encodeURIComponent(this.serialNumber).replace(/%2F/g, '/')}/shadow`;
        const canonicalUri = AnthbotShadowApiClient.canonicalUriForSigv4(requestUri);
        const canonicalQuery = `name=${encodeURIComponent(shadowName)}`;
        const payloadHash = crypto.createHash('sha256').update('', 'utf8').digest('hex');
        const now = new Date();
        const amzDate = `${now
            .toISOString()
            .replace(/[:-]|\.\d{3}/g, '')
            .slice(0, 15)}Z`;
        const dateStamp = amzDate.slice(0, 8);
        const signedHeaderValues = {
            host: this.iotEndpoint,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
        };
        const sessionToken = this.sessionToken();
        if (sessionToken) {
            signedHeaderValues['x-amz-security-token'] = sessionToken;
        }
        const { canonical, signedHeaders } = AnthbotShadowApiClient.canonicalHeaders(signedHeaderValues);
        const canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonical, signedHeaders, payloadHash].join(
            '\n',
        );
        const authorization = this.buildAuthorization({ amzDate, dateStamp, canonicalRequest });
        const response = await this.http.get(`https://${this.iotEndpoint}${requestUri}?${canonicalQuery}`, {
            headers: {
                Accept: '*/*',
                Host: this.iotEndpoint,
                'x-amz-date': amzDate,
                'x-amz-content-sha256': payloadHash,
                ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
                Authorization: authorization,
                'User-Agent': 'LdMower/1581 CFNetwork/3860.400.51 Darwin/25.3.0',
            },
        });
        if (response.status !== 200) {
            if (
                AnthbotShadowApiClient.isForbiddenStatus(response.status) &&
                allowCredentialRefresh &&
                this.accountClient
            ) {
                await this.refreshTemporaryCredentials();
                return this.getNamedShadowReportedState(shadowName, false);
            }
            throw new AnthbotGenieError(
                `Shadow request failed (${response.status}): ${JSON.stringify(response.data).slice(0, 300)}`,
            );
        }
        const payload = response.data;
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid response payload type');
        }
        const reported = payload?.state?.reported;
        if (!reported || typeof reported !== 'object') {
            throw new AnthbotGenieError('Missing state.reported in response');
        }
        return reported;
    }

    /** Retrieve the reported state from the property shadow. */
    async getShadowReportedState() {
        return this.getNamedShadowReportedState('property');
    }

    /** Retrieve the reported state from the service shadow. */
    async getServiceReportedState() {
        return this.getNamedShadowReportedState('service');
    }

    /**
     * @param {string} cmd
     * @param {unknown} data
     * @returns {unknown}
     */
    static encodeMSeriesCommandData(cmd, data) {
        if (cmd === 'param_set') {
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const encoded = { ...data };
                const cutterLift = asInteger(
                    /** @type {string|number|boolean|null|undefined} */ (
                        firstPresent(encoded.cutter_ctl_cutter_lift, encoded.cutter_height)
                    ),
                );
                if (cutterLift != null) {
                    encoded.cutter_ctl_cutter_lift = cutterLift;
                }
                delete encoded.cutter_height;
                return encoded;
            }
            const cutterLift = asInteger(/** @type {string|number|boolean|null|undefined} */ (data));
            return cutterLift == null ? data : { cutter_ctl_cutter_lift: cutterLift };
        }
        if (cmd === 'volume_ctl') {
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const encoded = { ...data };
                const volume = asInteger(
                    /** @type {string|number|boolean|null|undefined} */ (
                        firstPresent(encoded.volume_ctl, encoded.volume)
                    ),
                );
                if (volume != null) {
                    encoded.volume_ctl = volume;
                }
                delete encoded.volume;
                return encoded;
            }
            const volume = asInteger(/** @type {string|number|boolean|null|undefined} */ (data));
            return volume == null ? data : { volume_ctl: volume };
        }
        return data;
    }

    /**
     * @param {{ cmd: string, data?: unknown } & Record<string, unknown>} params
     * @returns {object}
     */
    buildServiceCommandBody({ cmd, data, ...desired }) {
        const commandData = isMSeriesModel(this.deviceModel)
            ? AnthbotShadowApiClient.encodeMSeriesCommandData(cmd, data)
            : data;
        return {
            state: {
                desired: {
                    cmd,
                    ...(commandData === undefined ? {} : { data: commandData }),
                    ...desired,
                },
            },
        };
    }

    /**
     * @param {{
     * requestUri: string,
     * canonicalQuery: string,
     * payloadBytes: Buffer,
     * includeSdkHeaders: boolean,
     * canonicalUriOverride?: string | null,
     * signContentLength?: boolean,
     * }} options
     * @returns {Promise<{ status: number, bodyText: string, payload: object|null, headers: { errortype: string, requestid: string } }>}
     */
    async signedPost({
        requestUri,
        canonicalQuery,
        payloadBytes,
        includeSdkHeaders,
        canonicalUriOverride = null,
        signContentLength = true,
    }) {
        const payloadHash = crypto.createHash('sha256').update(payloadBytes).digest('hex');
        const now = new Date();
        const amzDate = `${now
            .toISOString()
            .replace(/[:-]|\.\d{3}/g, '')
            .slice(0, 15)}Z`;
        const dateStamp = amzDate.slice(0, 8);
        const signedHeaderValues = {
            host: this.iotEndpoint,
            'content-type': 'application/octet-stream',
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
        };
        const headers = {
            Accept: '*/*',
            Host: this.iotEndpoint,
            'Content-Type': 'application/octet-stream',
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
        };
        const sessionToken = this.sessionToken();
        if (sessionToken) {
            signedHeaderValues['x-amz-security-token'] = sessionToken;
            headers['x-amz-security-token'] = sessionToken;
        }
        if (signContentLength) {
            signedHeaderValues['content-length'] = String(payloadBytes.length);
            headers['Content-Length'] = String(payloadBytes.length);
        }
        if (includeSdkHeaders) {
            const invocationId = crypto.randomUUID();
            signedHeaderValues['amz-sdk-invocation-id'] = invocationId;
            signedHeaderValues['amz-sdk-request'] = 'attempt=1; max=3';
            signedHeaderValues['x-amz-user-agent'] = 'aws-sdk-js/3.846.0';
            headers['amz-sdk-invocation-id'] = invocationId;
            headers['amz-sdk-request'] = 'attempt=1; max=3';
            headers['x-amz-user-agent'] = 'aws-sdk-js/3.846.0';
            headers['User-Agent'] =
                'aws-sdk-js/3.846.0 ua/2.1 os/other lang/js md/rn api/iot-data-plane#3.846.0 m/N,E,e';
        } else {
            headers['User-Agent'] = 'LdMower/1581 CFNetwork/3860.400.51 Darwin/25.3.0';
        }
        const { canonical, signedHeaders } = AnthbotShadowApiClient.canonicalHeaders(signedHeaderValues);
        const canonicalUri = canonicalUriOverride || AnthbotShadowApiClient.canonicalUriForSigv4(requestUri);
        const canonicalRequest = ['POST', canonicalUri, canonicalQuery, canonical, signedHeaders, payloadHash].join(
            '\n',
        );
        headers.Authorization = this.buildAuthorization({ amzDate, dateStamp, canonicalRequest });
        const url = canonicalQuery
            ? `https://${this.iotEndpoint}${requestUri}?${canonicalQuery}`
            : `https://${this.iotEndpoint}${requestUri}`;
        const response = await this.http.post(url, payloadBytes, { headers });
        const bodyText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        return {
            status: response.status,
            bodyText,
            payload:
                response.data && typeof response.data === 'object' && !Array.isArray(response.data)
                    ? response.data
                    : null,
            headers: {
                errortype: response.headers['x-amzn-errortype'] || '',
                requestid: response.headers['x-amzn-requestid'] || response.headers['x-amzn-request-id'] || '',
            },
        };
    }

    /**
     * @param {{ cmd: string, data?: unknown } & Record<string, unknown>} params
     * @returns {Promise<void>}
     */
    async publishServiceCommand({ cmd, data, ...desired }) {
        const body = this.buildServiceCommandBody({ cmd, data, ...desired });
        const payloadBytes = Buffer.from(JSON.stringify(body), 'utf8');
        const topic = `$aws/things/${this.serialNumber}/shadow/name/service/update`;
        const requestUriEncoded = `/topics/${encodeURIComponent(topic).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
        const requestUriRaw = `/topics/${topic}`;
        /** @type {PublishAttempt[]} */
        const attempts = [
            [requestUriEncoded, true, null, true],
            [requestUriEncoded, true, requestUriEncoded, true],
            [requestUriEncoded, true, null, false],
            [requestUriEncoded, false, null, true],
            [requestUriRaw, true, null, true],
            [requestUriRaw, true, requestUriRaw, true],
            [requestUriRaw, false, null, true],
        ];
        let last = null;
        for (let refreshAttempt = 0; refreshAttempt < 2; refreshAttempt++) {
            for (const [requestUri, includeSdkHeaders, canonicalUriOverride, signContentLength] of attempts) {
                const result = await this.signedPost({
                    requestUri,
                    canonicalQuery: '',
                    payloadBytes,
                    includeSdkHeaders,
                    canonicalUriOverride,
                    signContentLength,
                });
                if (result.status === 200 && result.payload && typeof result.payload === 'object') {
                    return;
                }
                last = result;
                if (!AnthbotShadowApiClient.isForbiddenStatus(result.status)) {
                    break;
                }
            }
            if (
                AnthbotShadowApiClient.isForbiddenStatus(last?.status || 0) &&
                refreshAttempt === 0 &&
                this.accountClient
            ) {
                await this.refreshTemporaryCredentials();
                continue;
            }
            break;
        }
        throw new AnthbotGenieError(
            `Command '${cmd}' failed (${last?.status || 0}) at endpoint '${this.iotEndpoint}' (region '${this.signingRegion}', errortype '${last?.headers?.errortype || ''}', requestid '${last?.headers?.requestid || ''}'): ${(last?.bodyText || '').slice(0, 300)}`,
        );
    }

    /** Request a full property refresh from the mower. */
    async requestAllProperties() {
        await this.publishServiceCommand({ cmd: 'get_all_props', data: 1 });
    }
}

module.exports = {
    AnthbotShadowApiClient,
};
