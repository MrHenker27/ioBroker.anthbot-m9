'use strict';

const crypto = require('node:crypto');

const DEFAULT_IOT_REGION = 'us-east-1';
const DEFAULT_IOT_ENDPOINT = 'a2bhy9nr7jkgaj-ats.iot.us-east-1.amazonaws.com';
const IOT_ENDPOINT_TEMPLATE = 'a2bhy9nr7jkgaj-ats.iot.{region}.amazonaws.com';
const CN_NORTHWEST_IOT_ENDPOINT = 'a2iw0czxjowiip-ats.iot.cn-northwest-1.amazonaws.com.cn';
const AWS_ACCESS_KEY_DEFAULT = 'AKIAV2C4RVIAOLEXB545';
const AWS_SECRET_KEY_DEFAULT = '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';
const AWS_ACCESS_KEY_CN = 'AKIAWJ3KIT7IV6AHMJ5V';
const AWS_SECRET_KEY_CN = '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';
const AWS_ACCESS_KEY_CN_NORTHWEST = 'AKIAYVWVSSRF7W5YWI74';
const AWS_SECRET_KEY_CN_NORTHWEST = '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';

/**
 * @typedef {object} SignedPostOptions
 * @property {string} requestUri
 * @property {string} canonicalQuery
 * @property {Buffer} payloadBytes
 * @property {boolean} includeSdkHeaders
 * @property {string | null} [canonicalUriOverride]
 * @property {boolean} [signContentLength]
 */

/** @typedef {[requestUri: string, includeSdkHeaders: boolean, canonicalUriOverride: string | null, signContentLength: boolean]} PublishAttempt */

const MODEL_NAME_BY_CATEGORY = {
    'Genie 600': 'Anthbot Genie 600',
    'Genie 1000': 'Anthbot Genie 1000',
    'Genie 3000': 'Anthbot Genie 3000',
    'Genie 5000': 'Anthbot Genie 5000',
};

const RTK_STATE_OPTIONS = {
    0: 'not_ready',
    1: 'single',
    2: 'differential',
    3: 'fixed',
    4: 'float',
    5: 'dead_reckoning',
};

const RTK_BASE_STATE_OPTIONS = {
    0: 'offline',
    1: 'initializing',
    2: 'searching',
    3: 'online',
    4: 'error',
};

const ROBOT_STATUS_BY_CODE = [
    'idle',
    'pause',
    'charge',
    'sleep',
    'ota',
    'position',
    'globalmowing',
    'zonemowing',
    'pointmowing',
    'mapping',
    'backtodock',
    'resume_point',
    'shutdown',
    'remotectrl',
    'factory',
    'sleep',
    'camera_cleaning',
    'gototarget',
    'bordermowing',
    'regionmowing',
    'nestmowing',
];

/**
 * Custom error type for Anthbot Genie adapter failures.
 */
class AnthbotGenieError extends Error {
    /**
     * Construct a new AnthbotGenieError with a message.
     *
     * @param {string} message - Error message
     */
    constructor(message) {
        super(message);
        this.name = 'AnthbotGenieError';
    }
}

/**
 * Check whether an error is likely related to authentication failure.
 *
 * @param {unknown} error - Error object or value
 * @returns {boolean} - True when the error appears authentication-related
 */
function isLikelyAuthenticationError(error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /(401|403|auth|authorization|unauthori[sz]ed|token|bearer token|login rejected)/i.test(message);
}

/**
 * Safely retrieve a nested property from an object.
 *
 * @param {object|*} data - Root object to query
 * @param {...(string|number)} path - Nested properties or keys
 * @returns {*|undefined} - Nested value or undefined if missing
 */
function safeGet(data, ...path) {
    let current = data;
    for (const key of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            return undefined;
        }
        current = current[key];
    }
    return current;
}

/**
 * Normalize a value into an integer when possible.
 *
 * @param {unknown} value - Input value to convert
 * @returns {number|null} - Integer value or null when conversion fails
 */
function asInteger(value) {
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (Number.isInteger(value)) {
        return /** @type {number} */ (value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * Convert a numeric or string timestamp into an ISO timestamp string.
 *
 * @param {unknown} value - Seconds since epoch or formatted timestamp string
 * @returns {string|null} - ISO timestamp string or null for invalid input
 */
function asIsoTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const date = new Date(Math.trunc(value) * 1000);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (typeof value === 'string' && /^\d{14}$/.test(value)) {
        const year = Number(value.slice(0, 4));
        const month = Number(value.slice(4, 6)) - 1;
        const day = Number(value.slice(6, 8));
        const hour = Number(value.slice(8, 10));
        const minute = Number(value.slice(10, 12));
        const second = Number(value.slice(12, 14));
        const date = new Date(Date.UTC(year, month, day, hour, minute, second));
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

/**
 * Determine whether a value represents a non-zero or non-empty state.
 *
 * @param {unknown} value - Input value
 * @returns {boolean} - True when the value is considered non-zero
 */
function isNonZero(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        return value.trim() !== '' && value.trim() !== '0';
    }
    return false;
}

function modelNameByCategory(categoryId) {
    const raw = categoryId != null ? String(categoryId) : '';
    return MODEL_NAME_BY_CATEGORY[raw] || (raw ? `Anthbot ${raw}` : 'Anthbot mower');
}

function eventCodeTranslationsFromCache(cacheOrPayload) {
    const payload =
        cacheOrPayload?.payload && typeof cacheOrPayload.payload === 'object' ? cacheOrPayload.payload : cacheOrPayload;
    return payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
}

/**
 * Resolve a human-readable description for an error code.
 *
 * @param {object} data - Error payload data
 * @param {object|*} [cacheOrPayload] - Optional translation cache or payload
 * @param {string} [language] - Preferred language for messages
 * @returns {string|null} - Localized error description or unknown fallback
 */
function errorDescription(data, cacheOrPayload = null, language = 'English') {
    const code = asInteger(data?.err_code);
    if (code == null) {
        return null;
    }
    const translations = eventCodeTranslationsFromCache(cacheOrPayload);
    const byLanguage = translations[String(code)];
    if (byLanguage && typeof byLanguage === 'object' && !Array.isArray(byLanguage)) {
        for (const candidateLanguage of [language, 'English']) {
            const eventMessage = byLanguage[candidateLanguage]?.event_message;
            if (typeof eventMessage === 'string' && eventMessage.trim()) {
                return eventMessage;
            }
        }
    }
    return `Unknown error (${code})`;
}

/**
 * Translate RTK status code into a readable label.
 *
 * @param {object} data - Robot status payload
 * @returns {string|null} - RTK label or null
 */
function rtkStateLabel(data) {
    const code = asInteger(data?.rtk_state);
    return code == null ? null : RTK_STATE_OPTIONS[code] || 'unknown';
}

/**
 * Translate RTK base station status code into a readable label.
 *
 * @param {object} data - Robot status payload
 * @returns {string|null} - RTK base label or null
 */
function rtkBaseStateLabel(data) {
    const code = asInteger(safeGet(data, 'ctl_rtk_base', 'rtk_base_state'));
    return code == null ? null : RTK_BASE_STATE_OPTIONS[code] || 'unknown';
}

/**
 * Client for Anthbot cloud API interactions.
 */
class AnthbotCloudApiClient {
    /**
     * Constructs a new AnthbotCloudApiClient instance.
     *
     * @param {object} config - Client configuration
     * @param {object} config.http - HTTP client instance
     * @param {string} config.host - Cloud API host
     * @param {string|null} [config.bearerToken] - Optional bearer token
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
     * Log in to the Anthbot cloud and retrieve an access token.
     *
     * @param {object} params - Login parameters
     * @param {string} params.username - Username
     * @param {string} params.password - Password
     * @param {string} params.areaCode - Area code
     * @returns {Promise<string>} - The bearer token
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

    /**
     * Ensure that a bearer token is available.
     *
     * @throws {AnthbotGenieError} If no bearer token is configured
     */
    requireToken() {
        if (!this.bearerToken) {
            throw new AnthbotGenieError('Bearer token not configured');
        }
    }

    /**
     * Build a device verification token from serial and timestamp.
     *
     * @param {string} serialNumber - Device serial number
     * @param {number|null} [timestamp] - Unix timestamp in seconds
     * @returns {string} - The generated verification token
     */
    static buildVerificationToken(serialNumber, timestamp = null) {
        const unixTimestamp = timestamp || Math.floor(Date.now() / 1000);
        const tokenSuffix = String(unixTimestamp);
        const tokenPrefix = crypto.createHash('md5').update(`${serialNumber}${tokenSuffix}`, 'utf8').digest('hex');
        return `${tokenPrefix}${tokenSuffix}`;
    }

    /**
     * Retrieve the list of devices bound to the authenticated account.
     *
     * @returns {Promise<Array<object>>} - Bound device metadata
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
     * Retrieve region information for a device.
     *
     * @param {string} serialNumber - Device serial number
     * @returns {Promise<object>} - Device region information
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
     * Retrieve temporary IoT credentials for a device.
     *
     * @param {string} serialNumber - Device serial number
     * @returns {Promise<object>} - IoT credentials and expiration
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
     * Download and parse the device area definition.
     *
     * @param {string} serialNumber - Device serial number
     * @returns {Promise<object>} - Parsed area definition object
     */
    async getDeviceAreaDefinition(serialNumber) {
        this.requireToken();
        const response = await this.http.get(`https://${this.host}/api/v1/device/v2/presigned_url`, {
            headers: this.authHeaders,
            params: {
                filename: `area_${serialNumber}.txt`,
                sn: serialNumber,
                category: 'device',
                sub_category: 'area',
                verification_token: AnthbotCloudApiClient.buildVerificationToken(serialNumber),
            },
        });
        const payload = response.data;
        if (response.status !== 200) {
            throw new AnthbotGenieError(
                `Area presigned URL failed (${response.status}): ${String(payload).slice(0, 300)}`,
            );
        }
        if (!payload || typeof payload !== 'object') {
            throw new AnthbotGenieError('Invalid area presigned URL payload type');
        }
        if (payload.code !== 0) {
            throw new AnthbotGenieError(`Area presigned URL returned code=${JSON.stringify(payload.code)}`);
        }
        const presignedUrl = payload?.data?.presigned_url;
        if (typeof presignedUrl !== 'string' || !presignedUrl) {
            throw new AnthbotGenieError('Area presigned URL payload missing presigned_url');
        }
        const areaResponse = await this.http.get(presignedUrl);
        if (areaResponse.status !== 200) {
            throw new AnthbotGenieError(
                `Area definition download failed (${areaResponse.status}): ${String(areaResponse.data).slice(0, 300)}`,
            );
        }
        const rawText = typeof areaResponse.data === 'string' ? areaResponse.data : JSON.stringify(areaResponse.data);
        let areaDefinition;
        try {
            areaDefinition = JSON.parse(rawText);
        } catch {
            throw new AnthbotGenieError('Area definition is not valid JSON');
        }
        if (!areaDefinition || typeof areaDefinition !== 'object' || Array.isArray(areaDefinition)) {
            throw new AnthbotGenieError('Area definition payload type is not an object');
        }
        return areaDefinition;
    }

    /**
     * Retrieve the current event code translation version.
     *
     * @returns {Promise<number>} - Event code version
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
     * Retrieve event code translations for a version.
     *
     * @param {number} version - Translation version
     * @returns {Promise<object>} - Translation payload
     */
    async getEventCodeTranslations(version) {
        this.requireToken();
        const response = await this.http.post(
            `https://${this.host}/api/v1/message/code/translate`,
            {
                version,
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
     * Extract the AWS region from a signed URL payload.
     *
     * @param {string} serialNumber - Device serial number
     * @returns {Promise<string|null>} - AWS region name or null
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

/**
 * Client for AWS IoT shadow communication for the mower.
 */
class AnthbotShadowApiClient {
    /**
     * Constructs a new AnthbotShadowApiClient instance.
     *
     * @param {object} config - Shadow client configuration
     * @param {object} config.http - HTTP client instance
     * @param {string} config.serialNumber - Device serial number
     * @param {string|null} config.regionName - AWS region name
     * @param {string|null} config.iotEndpoint - AWS IoT endpoint
     * @param {object|null} [config.iotCredentials] - Optional temporary IoT credentials
     */
    constructor({ http, serialNumber, regionName, iotEndpoint, iotCredentials = null }) {
        this.http = http;
        this.serialNumber = serialNumber;
        this.regionName = typeof regionName === 'string' && regionName ? regionName : null;
        this.iotEndpoint = AnthbotShadowApiClient.normalizeEndpoint(iotEndpoint);
        this.iotCredentials = iotCredentials && typeof iotCredentials === 'object' ? iotCredentials : null;
    }

    /**
     * Normalize an IoT endpoint string to a hostname.
     *
     * @param {string} iotEndpoint - Raw IoT endpoint
     * @returns {string} - Normalized endpoint hostname
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
     * Guess the AWS region from an IoT endpoint hostname.
     *
     * @param {string} iotEndpoint - IoT endpoint hostname
     * @returns {string|null} - Guessed AWS region or null
     */
    static guessRegionFromEndpoint(iotEndpoint) {
        if (!iotEndpoint || !String(iotEndpoint).includes('.iot.')) {
            return null;
        }
        const right = String(iotEndpoint).split('.iot.', 2)[1];
        const region = right.split('.', 1)[0];
        return region || null;
    }

    /**
     * Get the resolved signing AWS region for this client.
     *
     * @returns {string} - Signing region
     */
    get signingRegion() {
        return (
            AnthbotShadowApiClient.guessRegionFromEndpoint(this.iotEndpoint) || this.regionName || DEFAULT_IOT_REGION
        );
    }

    /**
     * Build the default IoT endpoint for an AWS region.
     *
     * @param {string} regionName - AWS region name
     * @returns {string} - Constructed IoT endpoint
     */
    static buildDefaultIotEndpointForRegion(regionName) {
        return IOT_ENDPOINT_TEMPLATE.replace('{region}', regionName);
    }

    /**
     * Get the AWS access key ID for the current IoT region.
     *
     * @returns {string} - AWS access key ID
     */
    accessKeyId() {
        if (typeof this.iotCredentials?.accessKeyId === 'string' && this.iotCredentials.accessKeyId) {
            return this.iotCredentials.accessKeyId;
        }
        if (this.iotEndpoint === CN_NORTHWEST_IOT_ENDPOINT) {
            return AWS_ACCESS_KEY_CN_NORTHWEST;
        }
        if (this.signingRegion.startsWith('cn')) {
            return AWS_ACCESS_KEY_CN;
        }
        return AWS_ACCESS_KEY_DEFAULT;
    }

    /**
     * Get the AWS secret access key for the current IoT region.
     *
     * @returns {string} - AWS secret access key
     */
    secretAccessKey() {
        if (typeof this.iotCredentials?.secretAccessKey === 'string' && this.iotCredentials.secretAccessKey) {
            return this.iotCredentials.secretAccessKey;
        }
        if (this.iotEndpoint === CN_NORTHWEST_IOT_ENDPOINT) {
            return AWS_SECRET_KEY_CN_NORTHWEST;
        }
        if (this.signingRegion.startsWith('cn')) {
            return AWS_SECRET_KEY_CN;
        }
        return AWS_SECRET_KEY_DEFAULT;
    }

    /**
     * Get the current IoT session token.
     *
     * @returns {string|null} - Session token or null
     */
    sessionToken() {
        return typeof this.iotCredentials?.sessionToken === 'string' && this.iotCredentials.sessionToken
            ? this.iotCredentials.sessionToken
            : null;
    }

    /**
     * Sign a message using HMAC-SHA256.
     *
     * @param {Buffer|string} key - Signing key
     * @param {string} msg - Message to sign
     * @returns {Buffer} - Signature
     */
    sign(key, msg) {
        return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
    }

    /**
     * Generate the AWS SigV4 signing key for the IoT service.
     *
     * @param {string} dateStamp - YYYYMMDD date stamp
     * @returns {Buffer} - Derived signing key
     */
    signingKey(dateStamp) {
        const kDate = this.sign(Buffer.from(`AWS4${this.secretAccessKey()}`, 'utf8'), dateStamp);
        const kRegion = this.sign(kDate, this.signingRegion);
        const kService = this.sign(kRegion, 'iotdata');
        return this.sign(kService, 'aws4_request');
    }

    /**
     * Build an AWS SigV4 authorization header value.
     *
     * @param {object} params - Authorization parameters
     * @param {string} params.amzDate - ISO8601 date header value
     * @param {string} params.dateStamp - YYYYMMDD date stamp
     * @param {string} params.canonicalRequest - Canonical request string
     * @returns {string} - Authorization header string
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
     * Normalize an HTTP header value by collapsing whitespace.
     *
     * @param {unknown} value - Header value
     * @returns {string} - Normalized header value
     */
    static normalizeHeaderValue(value) {
        return String(value).trim().split(/\s+/).join(' ');
    }

    /**
     * Build canonical headers and signed header names for SigV4.
     *
     * @param {object} headers - Headers to canonicalize
     * @returns {object} - Canonical header data
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
     * Extract the signed headers list from a canonical request.
     *
     * @param {string} canonicalRequest - Canonical request string
     * @returns {string} - Signed headers list
     */
    signedHeadersFromRequest(canonicalRequest) {
        const parts = canonicalRequest.split('\n');
        return parts.length >= 6 ? parts[parts.length - 2] : 'host;x-amz-content-sha256;x-amz-date';
    }

    /**
     * Encode a URI for AWS SigV4 canonicalization.
     *
     * @param {string} requestUri - Request URI to encode
     * @returns {string} - Encoded canonical URI
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
     * Retrieve the reported state of a named shadow from AWS IoT.
     *
     * @param {string} shadowName - Shadow name to query
     * @returns {Promise<object>} - Reported shadow state
     */
    async getNamedShadowReportedState(shadowName) {
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

    /**
     * Retrieve the reported state from the property shadow.
     *
     * @returns {Promise<object>} - Property shadow reported state
     */
    async getShadowReportedState() {
        return this.getNamedShadowReportedState('property');
    }

    /**
     * Retrieve the reported state from the service shadow.
     *
     * @returns {Promise<object>} - Service shadow reported state
     */
    async getServiceReportedState() {
        return this.getNamedShadowReportedState('service');
    }

    /**
     * @param {SignedPostOptions} options
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
     * Publish a service command to the device shadow.
     *
     * @param {object} params - Command parameters
     * @param {string} params.cmd - Command name
     * @param {unknown} [params.data] - Optional command payload
     * @returns {Promise<void>}
     */
    async publishServiceCommand({ cmd, data, ...desired }) {
        const body = {
            state: {
                desired: {
                    cmd,
                    ...(data === undefined ? {} : { data }),
                    ...desired,
                },
            },
        };
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
            if (result.status !== 403) {
                break;
            }
        }
        throw new AnthbotGenieError(
            `Command '${cmd}' failed (${last?.status || 0}) at endpoint '${this.iotEndpoint}' (region '${this.signingRegion}', errortype '${last?.headers?.errortype || ''}', requestid '${last?.headers?.requestid || ''}'): ${(last?.bodyText || '').slice(0, 300)}`,
        );
    }

    /**
     * Request that the device reports all current property values.
     *
     * @returns {Promise<void>}
     */
    async requestAllProperties() {
        await this.publishServiceCommand({ cmd: 'get_all_props', data: 1 });
    }
}

function listOfDicts(value) {
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function getAreaDefinition(data) {
    return data && typeof data._area_definition === 'object' && !Array.isArray(data._area_definition)
        ? data._area_definition
        : {};
}

/**
 * Extract manual mowing zones from area definition data.
 *
 * @param {object} data - Device payload or area definition data
 * @returns {Array<object>} - Manual zone definitions
 */
function manualZones(data) {
    const areaDefinition = getAreaDefinition(data || {});
    for (const key of ['custom_areas', 'zones', 'customAreas']) {
        const zones = listOfDicts(areaDefinition[key]);
        if (zones.length) {
            return zones;
        }
    }
    return listOfDicts(data?.custom_areas);
}

/**
 * Extract automatic mowing zones from area definition data.
 *
 * @param {object} data - Device payload or area definition data
 * @returns {Array<object>} - Auto zone definitions
 */
function autoZones(data) {
    const areaDefinition = getAreaDefinition(data || {});
    for (const key of [
        'region_areas',
        'regionAreas',
        'auto_regions',
        'autoRegions',
        'auto_zones',
        'autoZones',
        'regions',
    ]) {
        const zones = listOfDicts(areaDefinition[key]);
        if (zones.length) {
            return zones;
        }
    }
    return listOfDicts(data?.region_areas);
}

/**
 * Get active manual zone identifiers from device payload.
 *
 * @param {object} data - Device payload data
 * @returns {Array<number>} - Active manual zone IDs
 */
function activeManualZoneIds(data) {
    const ids = data?.active_area?.id;
    return Array.isArray(ids) ? ids.filter(id => Number.isInteger(id)) : [];
}

/**
 * Coerce a mixed-type value into a boolean enabled state.
 *
 * @param {unknown} value - Input value
 * @returns {boolean} - Normalized enabled state
 */
function coerceEnabledValue(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    if (typeof value === 'string') {
        return ['1', 'true', 'on', 'enabled', 'enable'].includes(value.trim().toLowerCase());
    }
    return false;
}

/**
 * Determine whether custom direction is enabled from device parameters.
 *
 * @param {object} data - Device payload data
 * @returns {boolean} - True when custom direction is enabled
 */
function isCustomDirectionEnabled(data) {
    const raw = data?.param_set?.enable_adaptive_head;
    return !coerceEnabledValue(raw);
}

/**
 * Parse the raw robot status from device data.
 *
 * @param {object} data - Device payload data
 * @returns {string|null} - Raw robot status string or null
 */
function rawRobotStatus(data) {
    const value = data?.robot_sta?.value;
    if (typeof value === 'string') {
        return value.toLowerCase();
    }
    if (Number.isInteger(value)) {
        return ROBOT_STATUS_BY_CODE[value] || String(value);
    }
    return null;
}

/**
 * Determine general mower status from raw robot status.
 *
 * @param {object} data - Device payload data
 * @returns {string} - General mower status label
 */
function generalMowerStatus(data) {
    const raw = rawRobotStatus(data);
    if (raw == null) {
        return 'unknown';
    }
    if (
        [
            'globalmowing',
            'zonemowing',
            'pointmowing',
            'bordermowing',
            'regionmowing',
            'nestmowing',
            'wastelandmowing',
        ].includes(raw)
    ) {
        return 'mowing';
    }
    if (['charge', 'charging', 'charge_start'].includes(raw)) {
        return 'charging';
    }
    if (raw === 'backtodock') {
        return 'returning_to_dock';
    }
    if (raw === 'idle') {
        return 'standby';
    }
    if (raw === 'pause') {
        return 'paused';
    }
    if (raw === 'mapping') {
        return 'mapping';
    }
    if (raw === 'position') {
        return 'positioning';
    }
    if (raw === 'resume_point') {
        return 'resuming';
    }
    if (raw === 'sleep') {
        return 'sleeping';
    }
    if (raw === 'ota') {
        return 'ota_updating';
    }
    if (raw === 'remotectrl') {
        return 'remote_control';
    }
    if (raw === 'factory') {
        return 'factory_mode';
    }
    if (raw === 'camera_cleaning') {
        return 'camera_cleaning';
    }
    if (raw === 'gototarget') {
        return 'going_to_target';
    }
    if (raw === 'shutdown') {
        return 'shutdown';
    }
    return 'unknown';
}

/**
 * Check whether the mower is currently charging.
 *
 * @param {object} data - Device payload data
 * @returns {boolean} - True when charging
 */
function isCharging(data) {
    return generalMowerStatus(data) === 'charging';
}

/**
 * Compact zone payload objects by filtering empty values.
 *
 * @param {Array<object>} zones - Zone objects to compact
 * @returns {Array<object>} - Compacted zone objects
 */
function compactZonePayload(zones) {
    return zones.map(zone => {
        const item = {};
        for (const key of [
            'id',
            'name',
            'mow_count',
            'mow_mode',
            'mow_order',
            'cutter_height',
            'enable_adaptive_head',
            'mow_head',
            'visual_ignore_obstacle_switch',
            'obstacle_avoid_level',
            'x',
            'y',
            'vertexs',
            'points',
        ]) {
            if (zone[key] !== undefined && zone[key] !== null) {
                item[key] = zone[key];
            }
        }
        return item;
    });
}

/**
 * Extract consumable lifetime values from device payload.
 *
 * @param {object} data - Device payload data
 * @returns {object} - Consumable lifetime values
 */
function consumableLifetimes(data) {
    const maintenance = data?.robot_maintenance || {};

    return {
        blades: typeof maintenance.rc_pecent === 'number' ? maintenance.rc_pecent : null,
        cameras: typeof maintenance.cl_pecent === 'number' ? maintenance.cl_pecent : null,
        chargingPort: typeof maintenance.ccp_pecent === 'number' ? maintenance.ccp_pecent : null,
    };
}

/**
 * Parse a command selection value into an array of items.
 *
 * @param {unknown} value - Command selection input
 * @returns {Array<*>} - Parsed selection values
 */
function parseCommandSelection(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'number') {
        return [value];
    }
    if (typeof value !== 'string') {
        return [];
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            return [trimmed];
        }
    }
    return trimmed
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
}

module.exports = {
    AnthbotCloudApiClient,
    AnthbotShadowApiClient,
    AnthbotGenieError,
    activeManualZoneIds,
    asInteger,
    asIsoTimestamp,
    autoZones,
    compactZonePayload,
    coerceEnabledValue,
    consumableLifetimes,
    errorDescription,
    generalMowerStatus,
    isLikelyAuthenticationError,
    isCharging,
    isCustomDirectionEnabled,
    isNonZero,
    manualZones,
    parseCommandSelection,
    rawRobotStatus,
    rtkBaseStateLabel,
    rtkStateLabel,
    safeGet,
};
