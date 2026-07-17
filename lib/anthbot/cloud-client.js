'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');

const { modelNameByCategory } = require('./payload');
const { AnthbotGenieError, asInteger } = require('./utils');
const { decodeM9Map } = require('./m9-map-decoder');
const { decodeRtkSatelliteInfo } = require('./rtk-satellite');
const { decodeM9Bridge } = require('./m9-bridge-decoder');

/** Client for Anthbot cloud API interactions. */
class AnthbotCloudApiClient {
    /**
     * @param {object} config
     * @param {object} config.http
     * @param {string} config.host
     * @param {string|null} [config.bearerToken]
     */
    constructor({ http, host, bearerToken = null }) {
        this.http = http;
        this.host = host;
        this.bearerToken = bearerToken;
        this.authHeaders = {
            Accept: 'application/json, text/plain, */*',
            version: 'v2',
            language: 'en',
            'User-Agent': 'LdMower/1581 CFNetwork/3860.400.51 Darwin/25.3.0',
        };
        if (bearerToken) {
            this.authHeaders.Authorization = bearerToken;
        }
    }

    /**
     * @param {{ username: string, password: string, areaCode: string }} params
     * @returns {Promise<string>}
     */
    async login({ username, password, areaCode }) {
        const response = await this.http.post(
            `https://${this.host}/api/v1/login`,
            {
                username,
                password,
                areaCode,
            },
            {
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'content-type': 'application/json',
                    version: 'v2',
                    language: 'en',
                    'User-Agent': 'LdMower/1581 CFNetwork/3860.400.51 Darwin/25.3.0',
                },
            },
        );
        const data = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(`Login failed (${response.status}): ${String(response.data).slice(0, 300)}`);
        }
        if (!data || typeof data !== 'object') {
            throw new AnthbotGenieError('Invalid login payload type');
        }
        if (data.code !== 0) {
            throw new AnthbotGenieError(`Login rejected: code=${JSON.stringify(data.code)}`);
        }
        const accessToken = data?.data?.access_token;
        if (typeof accessToken !== 'string' || !accessToken) {
            throw new AnthbotGenieError('Login payload missing access_token');
        }
        this.bearerToken = `Bearer ${accessToken}`;
        this.authHeaders.Authorization = this.bearerToken;
        return this.bearerToken;
    }

    /** Ensure the client has a bearer token. */
    requireToken() {
        if (!this.bearerToken) {
            throw new AnthbotGenieError('Bearer token not configured');
        }
    }

    /**
     * @param {string} serialNumber
     * @param {number|null} [timestamp]
     * @returns {string}
     */
    static buildVerificationToken(serialNumber, timestamp = null) {
        const unixTimestamp = timestamp || Math.floor(Date.now() / 1000);
        const tokenSuffix = String(unixTimestamp);
        const tokenPrefix = crypto.createHash('md5').update(`${serialNumber}${tokenSuffix}`, 'utf8').digest('hex');
        return `${tokenPrefix}${tokenSuffix}`;
    }

    /**
     * @returns {Promise<Array<object>>}
     */
    async getBoundDevices() {
        this.requireToken();
        const response = await this.http.get(`https://${this.host}/api/v1/device/bind/list`, {
            headers: this.authHeaders,
        });
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(`Bind list failed (${response.status}): ${String(payload).slice(0, 300)}`);
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid bind list payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`Bind list returned code=${JSON.stringify(payload.code)}`);
        }
        if (!Array.isArray(payload.data)) {
            throw new AnthbotGenieError('Bind list payload missing data array');
        }
        return payload.data
            .filter(item => item && typeof item === 'object' && typeof item.sn === 'string' && item.sn)
            .map(item => ({
                serialNumber: item.sn,
                alias: typeof item.alias === 'string' && item.alias ? item.alias : item.sn,
                model: modelNameByCategory(item.category_id),
                isOwner:
                    typeof item.is_owner === 'boolean'
                        ? item.is_owner
                        : typeof item.is_owner === 'number'
                          ? item.is_owner === 1
                          : null,
            }));
    }

    /**
     * @param {string} serialNumber
     * @returns {Promise<object>}
     */
    async getDeviceRegion(serialNumber) {
        this.requireToken();
        const response = await this.http.get(`https://${this.host}/api/v1/device/v2/region`, {
            headers: this.authHeaders,
            params: { sn: serialNumber },
        });
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(`Device region failed (${response.status}): ${String(payload).slice(0, 300)}`);
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid device region payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`Device region returned code=${JSON.stringify(payload.code)}`);
        }
        const data = payload.data;
        if (!data || typeof data !== 'object') {
            throw new AnthbotGenieError('Device region payload missing data object');
        }
        if (typeof data.region_name !== 'string' || !data.region_name) {
            throw new AnthbotGenieError('Device region missing region_name');
        }
        if (typeof data.iot_endpoint !== 'string' || !data.iot_endpoint) {
            throw new AnthbotGenieError('Device region missing iot_endpoint');
        }
        return {
            serialNumber,
            regionName: data.region_name,
            iotEndpoint: data.iot_endpoint,
        };
    }

    /**
     * @param {string} serialNumber
     * @returns {Promise<object>}
     */
    async getDeviceIotCredentials(serialNumber) {
        this.requireToken();
        const response = await this.http.post(
            `https://${this.host}/api/v1/device/v2/iot/sts/arn`,
            {
                sn: serialNumber,
                verification_token: AnthbotCloudApiClient.buildVerificationToken(serialNumber),
            },
            {
                headers: {
                    ...this.authHeaders,
                    'content-type': 'application/json',
                },
            },
        );
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(`IoT STS failed (${response.status}): ${String(payload).slice(0, 300)}`);
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid IoT STS payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`IoT STS returned code=${JSON.stringify(payload.code)}`);
        }
        const data = payload.data;
        if (!data || typeof data !== 'object') {
            throw new AnthbotGenieError('IoT STS payload missing data object');
        }
        const requiredFields = ['access_key_id', 'secret_access_key', 'session_token', 'region_name', 'endpoint'];
        if (requiredFields.some(field => typeof data[field] !== 'string' || !data[field])) {
            throw new AnthbotGenieError('IoT STS payload missing required fields');
        }
        const expiration = asInteger(data.expiration);
        const expiresAt =
            expiration == null ? null : expiration > 2000000000 ? expiration * 1000 : Date.now() + expiration * 1000;
        return {
            accessKeyId: data.access_key_id,
            secretAccessKey: data.secret_access_key,
            sessionToken: data.session_token,
            regionName: data.region_name,
            endpoint: data.endpoint,
            expiresAt,
        };
    }

    /**
     * @param {string} serialNumber
     * @returns {Promise<object>}
     */
    async getDeviceMap(serialNumber) {
        this.requireToken();

        const response = await this.http.get(`https://${this.host}/api/v1/device/v2/presigned_url`, {
            headers: this.authHeaders,
            params: {
                filename: `map_manager_${serialNumber}.tar.gz`,
                sn: serialNumber,
                category: 'device',
                sub_category: 'map',
                verification_token: AnthbotCloudApiClient.buildVerificationToken(serialNumber),
            },
        });

        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(
                `Map manager presigned URL failed (${response.status}): ${String(payload).slice(0, 300)}`,
            );
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid map manager presigned URL payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(
                `Map manager presigned URL returned code=${JSON.stringify(payload.code)}`,
            );
        }

        const presignedUrl = payload?.data?.presigned_url;
        if (typeof presignedUrl !== 'string' || !presignedUrl) {
            throw new AnthbotGenieError('Map manager payload missing presigned_url');
        }

        const mapResponse = await this.http.get(presignedUrl, {
            responseType: 'arraybuffer',
        });
        if (mapResponse.status !== 200) {
            throw new AnthbotGenieError(`Map manager download failed (${mapResponse.status})`);
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `anthbot-m9-${serialNumber}-`));
        const archivePath = path.join(tempDir, 'map_manager.tar.gz');

        try {
            await fs.writeFile(archivePath, Buffer.from(mapResponse.data));
            await tar.x({
                file: archivePath,
                cwd: tempDir,
                strict: true,
            });

            const areaText = await fs.readFile(path.join(tempDir, 'area_setting.json'), 'utf8');
            const mapBuffer = await fs.readFile(path.join(tempDir, 'iot_map.bin'));
            const areaDefinition = JSON.parse(areaText);
            const mapData = decodeM9Map(mapBuffer);

            try {
                const bridgeBuffer = await fs.readFile(path.join(tempDir, 'iot_bridge.bin'));
                mapData.bridgeData = decodeM9Bridge(bridgeBuffer);
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
                mapData.bridgeData = null;
            }

            if (!areaDefinition || typeof areaDefinition !== 'object' || Array.isArray(areaDefinition)) {
                throw new AnthbotGenieError('M9 area_setting.json payload type is not an object');
            }

            return {
                areaDefinition,
                mapData,
            };
        } catch (error) {
            if (error instanceof AnthbotGenieError) {
                throw error;
            }
            throw new AnthbotGenieError(
                `M9 map archive processing failed: ${error?.message || String(error)}`,
            );
        } finally {
            await fs.rm(tempDir, {
                recursive: true,
                force: true,
            });
        }
    }


    /** Download and decode the RTK base satellite archive used by the app's NetRTK page. */
    async getRtkSatelliteInfo(serialNumber, rtkId) {
        this.requireToken();
        const response = await this.http.get(`https://${this.host}/api/v1/device/v2/presigned_url`, {
            headers: this.authHeaders,
            params: {
                filename: `rtk_manager_${serialNumber}.tar.gz`,
                sn: serialNumber,
                category: 'device',
                sub_category: 'rtk',
                verification_token: AnthbotCloudApiClient.buildVerificationToken(serialNumber),
            },
        });
        const payload = response.data;
        if (response.status !== 200 || !payload || typeof payload !== 'object' || payload.code !== 0) {
            throw new AnthbotGenieError(`RTK satellite presigned URL failed: ${JSON.stringify(payload).slice(0, 300)}`);
        }
        const presignedUrl = payload?.data?.presigned_url;
        if (typeof presignedUrl !== 'string' || !presignedUrl) throw new AnthbotGenieError('RTK satellite payload missing presigned_url');
        const archiveResponse = await this.http.get(presignedUrl, { responseType: 'arraybuffer' });
        if (archiveResponse.status !== 200) throw new AnthbotGenieError(`RTK satellite download failed (${archiveResponse.status})`);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `anthbot-rtk-${serialNumber}-`));
        const archivePath = path.join(tempDir, 'rtk_manager.tar.gz');
        try {
            await fs.writeFile(archivePath, Buffer.from(archiveResponse.data));
            await tar.x({ file: archivePath, cwd: tempDir, strict: true });
            const candidates = [];
            if (rtkId != null && rtkId !== '') candidates.push(path.join(tempDir, String(rtkId), 'rtk_base_info.bin'));
            candidates.push(path.join(tempDir, 'rtk_base_info.bin'));
            let filePath = null;
            for (const candidate of candidates) {
                try { await fs.access(candidate); filePath = candidate; break; } catch {}
            }
            if (!filePath) {
                const entries = await fs.readdir(tempDir, { recursive: true });
                const match = entries.find(entry => String(entry).endsWith('rtk_base_info.bin'));
                if (match) filePath = path.join(tempDir, String(match));
            }
            if (!filePath) throw new AnthbotGenieError('RTK archive does not contain rtk_base_info.bin');
            return decodeRtkSatelliteInfo(await fs.readFile(filePath));
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    /**
     * Backwards-compatible helper.
     *
     * @param {string} serialNumber
     * @returns {Promise<object>}
     */
    async getDeviceAreaDefinition(serialNumber) {
        const map = await this.getDeviceMap(serialNumber);
        return map.areaDefinition;
    }

    /**
     * @returns {Promise<number>}
     */
    async getEventCodeVersion() {
        this.requireToken();
        const response = await this.http.get(`https://${this.host}/api/v1/message/code/version`, {
            headers: this.authHeaders,
        });
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(
                `Event code version failed (${response.status}): ${String(payload).slice(0, 300)}`,
            );
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid event code version payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`Event code version returned code=${JSON.stringify(payload.code)}`);
        }

        const data = payload.data;
        const version =
            typeof data === 'object' && data !== null
                ? asInteger(data.version ?? data.event_code_version ?? data.code_version)
                : asInteger(data);
        if (version == null) {
            throw new AnthbotGenieError('Event code version payload missing version');
        }
        return version;
    }

    /**
     * @param {number} version
     * @returns {Promise<object>}
     */
    async getEventCodeTranslations(version) {
        this.requireToken();
        const response = await this.http.post(
            `https://${this.host}/api/v1/message/code/translate`,
            { version },
            {
                headers: {
                    ...this.authHeaders,
                    'content-type': 'application/json',
                },
            },
        );
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(
                `Event code translations failed (${response.status}): ${String(payload).slice(0, 300)}`,
            );
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid event code translations payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`Event code translations returned code=${JSON.stringify(payload.code)}`);
        }
        if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
            throw new AnthbotGenieError('Event code translations payload missing data object');
        }
        return payload;
    }

    /**
     * @param {string} serialNumber
     * @returns {Promise<string|null>}
     */
    async getDevicePresignedRegion(serialNumber) {
        this.requireToken();
        const response = await this.http.get(`https://${this.host}/api/v1/device/v2/presigned_url`, {
            headers: this.authHeaders,
            params: { sn: serialNumber },
        });
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(`Presigned URL failed (${response.status}): ${String(payload).slice(0, 300)}`);
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid presigned URL payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`Presigned URL returned code=${JSON.stringify(payload.code)}`);
        }
        const presignedUrl = payload?.data?.presigned_url;
        if (typeof presignedUrl !== 'string' || !presignedUrl) {
            throw new AnthbotGenieError('Presigned URL payload missing presigned_url');
        }

        let parsed;
        try {
            parsed = new URL(presignedUrl);
        } catch {
            return null;
        }

        const hostParts = parsed.hostname.split('.');
        if (hostParts.length >= 4 && hostParts[0] === 's3') {
            const candidate = hostParts[1] === 'dualstack' ? hostParts[2] : hostParts[1];
            if (candidate && candidate !== 'amazonaws' && candidate !== 'amazonaws.com') {
                return candidate;
            }
        }

        const credential = parsed.searchParams.get('X-Amz-Credential');
        if (credential) {
            const credentialParts = credential.split('/');
            if (credentialParts.length >= 3 && credentialParts[2]) {
                return credentialParts[2];
            }
        }

        return null;
    }
}

module.exports = {
    AnthbotCloudApiClient,
};
