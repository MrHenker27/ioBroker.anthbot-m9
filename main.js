'use strict';

/** @type {typeof import('@iobroker/adapter-core')} */
const utils = require('@iobroker/adapter-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const axios = /** @type {import('axios').AxiosStatic} */ (/** @type {unknown} */ (require('axios')));
const sharp = require('sharp');
const { AnthbotCloudApiClient } = require('./lib/anthbot/cloud-client');
const { AnthbotShadowApiClient } = require('./lib/anthbot/shadow-client');
const { AnthbotMqttShadowClient } = require('./lib/anthbot/mqtt-shadow-client');
const {
    AnthbotGenieError,
    asInteger,
    deviceObjectIdFromSerial,
    isLikelyAuthenticationError,
} = require('./lib/anthbot/utils');
const {
    BOOLEAN_COMMANDS,
    MAINTENANCE_RESET_TYPES,
    STRING_COMMANDS,
    getDeviceChannelDefinitions,
    getDeviceStateDefinitions,
} = require('./lib/adapter/definitions');
const { buildDeviceStateUpdates, getControlFallbackValue } = require('./lib/adapter/state-updates');
const { executeCommand, executeConsumableCommand, executeControl } = require('./lib/adapter/actions');
const { resolvePollingInterval, updatePollingCategory } = require('./lib/adapter/polling');
const { renderRtkSkyplot } = require('./lib/anthbot/rtk-skyplot');
const { buildRtkSkyplotHtml } = require('./lib/anthbot/rtk-skyplot-html');

/**
 * @typedef {object} AnthbotAdapterConfig
 * @property {string} username
 * @property {string} password
 * @property {string} areaCode
 * @property {string} apiHost
 * @property {number} pollIntervalActive
 * @property {number} pollIntervalCharging
 * @property {number} pollIntervalIdle
 * @property {number} pollIntervalIdleLong
 * @property {number} idleLongAfterMinutes
 * @property {boolean} nightPollingEnabled
 * @property {number} pollIntervalNight
 * @property {number} nightStartHour
 * @property {number} nightEndHour
 * @property {boolean} mqttEnabled
 * @property {number} mqttFallbackPollInterval
 * @property {string} errorDescriptionLanguage
 */

/** @typedef {ioBroker.Adapter} IoBrokerAdapter */
/** @typedef {new (options: ioBroker.AdapterOptions | string) => IoBrokerAdapter} AdapterCtor */

const AdapterBase = /** @type {AdapterCtor} */ (utils.Adapter);
const { I18n } = utils;

function t(en) {
    return I18n.getTranslatedObject(en);
}

class AnthbotGenieAdapter extends AdapterBase {
    constructor(options = {}) {
        super({
            ...options,
            name: 'anthbot-m9',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.http = null;
        this.cloudClient = null;
        this.authToken = null;
        this.deviceContexts = new Map();
        this.deviceContextsByObjectRoot = new Map();
        this.eventCodeCache = null;
        this.eventCodeCacheInitialized = false;
        this.stateValueCache = new Map();
        this.pollTimer = null;
        this.refreshInFlight = null;
        this.unloaded = false;
        this.httpRateLimitCount = 0;
        this.httpBackoffUntil = 0;
    }

    /**
     * @returns {AnthbotAdapterConfig}
     */
    get anthbotConfig() {
        return /** @type {AnthbotAdapterConfig} */ (this.config);
    }

    isGermanAdmin() {
        return String(this.anthbotConfig.errorDescriptionLanguage || '').toLowerCase() === 'german';
    }

    localizeAdminValue(value) {
        const text = value == null || value === '' ? '' : String(value);
        if (!this.isGermanAdmin()) return text;
        const direct = {
            connected: 'verbunden',
            disconnected: 'getrennt',
            unknown: 'unbekannt',
            'not transmitted': 'nicht übertragen',
            online: 'online',
            offline: 'offline',
            fixed: 'Fix',
            float: 'Float',
            lost: 'kein Fix',
            'disabled while MQTT connected': 'deaktiviert, solange MQTT verbunden ist',
            'waiting for MQTT': 'warte auf MQTT',
            true: 'Ja',
            false: 'Nein',
            'positioning active (code 1)': 'RTK-Positionierung aktiv (Code 1)',
        };
        if (direct[text] !== undefined) return direct[text];
        if (/^unknown \((.+)\)$/.test(text)) return text.replace(/^unknown/, 'unbekannt');
        if (/^status code (.+)$/.test(text)) return text.replace(/^status code/, 'Statuscode');
        return text;
    }

    localizeAssessment(value) {
        const text = value == null ? '' : String(value);
        if (!this.isGermanAdmin()) return text;
        const translations = {
            'No separate GNSS quality values for Kevin were found in the current payload.': 'Im aktuellen Datenpaket wurden keine separaten GNSS-Qualitätswerte für Kevin gefunden.',
            'Kevin reports an RTK/GNSS fix.': 'Kevin meldet einen RTK-/GNSS-Fix.',
            'Kevin reports RTK float or reduced positioning quality.': 'Kevin meldet RTK-Float beziehungsweise eine verringerte Positionierungsqualität.',
            'Kevin reports a weak RTK signal. The app only distinguishes state 1 from all weaker states.': 'Kevin meldet ein schwaches RTK-Signal. Die App unterscheidet lediglich Status 1 von allen schwächeren Zuständen.',
            'Kevin has no GNSS fix, but fresh movement data suggests temporary navigation by sensors/odometry.': 'Kevin hat keinen GNSS-Fix; aktuelle Bewegungsdaten sprechen jedoch für eine vorübergehende Navigation über Sensoren beziehungsweise Odometrie.',
            'Kevin reports no GNSS fix.': 'Kevin meldet keinen GNSS-Fix.',
            'Kevin does not expose an unambiguous GNSS fix in this payload. Numeric RTK status codes are shown raw and are not guessed.': 'Dieses Datenpaket enthält keinen eindeutigen GNSS-Fix von Kevin. Numerische RTK-Statuscodes werden unverändert angezeigt und nicht geraten.',
            'Kevin reports active RTK positioning (raw code 1). A separate satellite count is not transmitted in this data stream.': 'Kevin meldet eine aktive RTK-Positionierung (Rohcode 1). Eine separate Satellitenzahl von Kevin wird in diesem Datenstrom nicht übertragen.',
            'Kevin provides only a numeric RTK status in this payload. The raw code is shown without guessing a GNSS fix.': 'Kevin überträgt in diesem Datenpaket nur einen numerischen RTK-Status. Der Rohcode wird angezeigt, ohne daraus einen GNSS-Fix zu erraten.',
            'The RTK base reports a good state, but Kevin does not expose a confirmed GNSS fix in this payload.': 'Die RTK-Basis meldet einen guten Zustand; dieses Datenpaket enthält jedoch keinen bestätigten GNSS-Fix von Kevin.',
        };
        return translations[text] || text;
    }

    async onReady() {
        this.unloaded = false;
        const config = this.anthbotConfig;
        this.http = axios.create({
            timeout: 15000,
            validateStatus: () => true,
        });

        await I18n.init(__dirname, this);
        await this.ensureBaseObjects();
        await this.setStateAsync('info.connection', false, true);

        if (!config.username || !config.password) {
            this.log.error('Username and password must be configured.');
            return;
        }

        this.subscribeStates('*.commands.*');
        this.subscribeStates('*.controls.*');
        this.subscribeStates('*.consumable.*.reset');

        await this.bootstrap();
        this.schedulePoll();
    }


    async bootstrap() {
        try {
            await this.ensureSession(true);
            await this.discoverDevices(true);
            await this.ensureEventCodeCache();
            await this.setStateAsync('info.connection', this.deviceContexts.size > 0, true);
        } catch (error) {
            this.log.error(`Adapter startup failed: ${error?.message || String(error)}`);
            await this.setStateAsync('info.connection', false, true);
        }
    }

    async ensureBaseObjects() {
        await this.extendObjectAsync('info', {
            type: 'channel',
            common: {
                name: t('Info'),
            },
            native: {},
        });

        await this.extendObjectAsync('info.connection', {
            type: 'state',
            common: {
                name: t('Cloud connection'),
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });

        await this.extendObjectAsync('diagnostics', { type: 'channel', common: { name: t('Diagnostics') }, native: {} });
        await this.extendObjectAsync('diagnostics.admin', { type: 'channel', common: { name: t('Admin diagnostics') }, native: {} });
        const adminStates = /** @type {Record<string, any>} */ ({
            device: { type: 'string', role: 'text', def: '' },
            mqtt: { type: 'string', role: 'text', def: 'unknown' },
            robotFix: { type: 'string', role: 'text', def: 'unknown' },
            robotRawStatus: { type: 'string', role: 'text', def: '' },
            robotSatellites: { type: 'string', role: 'text', def: this.isGermanAdmin() ? 'nicht übertragen' : 'not transmitted' },
            baseState: { type: 'string', role: 'text', def: 'unknown' },
            baseSatellites: { type: 'string', role: 'text', def: this.isGermanAdmin() ? 'nicht übertragen' : 'not transmitted' },
            antennaMoved: { type: 'boolean', role: 'indicator', def: false },
            assessment: { type: 'string', role: 'text', def: 'unknown' },
            lastUpdate: { type: 'string', role: 'date', def: '' },
            httpPolling: { type: 'string', role: 'text', def: 'waiting for MQTT' },
            httpBackoffUntil: { type: 'string', role: 'date', def: '' },
            skyplotHtml: { type: 'string', role: 'html', def: '' },
        });
        for (const [id, common] of Object.entries(adminStates)) {
            await this.extendObjectAsync(`diagnostics.admin.${id}`, {
                type: 'state', common: { name: id, read: true, write: false, ...common }, native: {},
            });
        }
    }

    async onMessage(obj) {
        if (!obj || !obj.callback) return;
        if (obj.command !== 'getRtkSkyplot') return;

        this.log.debug(`RTK sky plot requested by ${obj.from || 'Admin'}.`);
        try {
            const context = this.deviceContexts.values().next().value;
            const satellites = context?.rtkSatelliteInfo?.satellites || [];
            const svg = renderRtkSkyplot(satellites, {
                emptyText: this.isGermanAdmin() ? 'Keine Satellitendaten verfügbar' : 'No satellite data available',
            });
            const png = await sharp(Buffer.from(svg, 'utf8'), { density: 144 })
                .png()
                .toBuffer();
            const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
            const title = this.isGermanAdmin() ? 'RTK-Satellitenkarte' : 'RTK satellite map';
            const summary = this.isGermanAdmin()
                ? `${satellites.length} Satelliten der RTK-Basis`
                : `${satellites.length} RTK base satellites`;
            const html = `<div style="width:100%;min-height:420px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow:hidden"><div style="font-size:18px;margin:0 0 8px 0">${title}</div><img src="${dataUrl}" alt="${title}" style="display:block;width:100%;max-width:520px;height:auto;object-fit:contain"/><div style="margin-top:6px;font-size:13px;opacity:.75">${summary}</div></div>`;
            this.log.debug(`RTK sky plot delivered to Admin (${satellites.length} satellites, ${png.length} bytes PNG, HTML response).`);
            this.sendTo(obj.from, obj.command, html, obj.callback);
        } catch (error) {
            const nested = error instanceof AggregateError && Array.isArray(error.errors)
                ? error.errors.map(item => item?.message || String(item)).filter(Boolean).join(' | ')
                : '';
            const detail = nested || error?.cause?.message || error?.message || String(error);
            const message = this.isGermanAdmin()
                ? `Satellitenkarte konnte nicht erzeugt werden: ${detail}`
                : `Satellite map could not be generated: ${detail}`;
            this.log.warn(`RTK sky plot request failed: ${detail}`);
            this.sendTo(obj.from, obj.command, `<div style="padding:16px;border:1px solid #c66;border-radius:4px">${message}</div>`, obj.callback);
        }
    }

    onUnload(callback) {
        try {
            this.unloaded = true;
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }
            for (const context of this.deviceContexts.values()) {
                context.mqttClient?.stop().catch(() => {});
            }
            callback();
        } catch {
            callback();
        }
    }

    schedulePoll() {
        if (this.unloaded) return;
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }

        const contexts = Array.from(this.deviceContexts.values());
        const mqttConnected = this.anthbotConfig.mqttEnabled !== false &&
            contexts.length > 0 && contexts.every(context => context.mqttClient?.connected);
        if (mqttConnected) {
            this.log.debug('HTTP shadow polling disabled while MQTT is connected.');
            this.setStateAsync('diagnostics.admin.httpPolling', { val: this.localizeAdminValue('disabled while MQTT connected'), ack: true });
            return;
        }

        const polling = resolvePollingInterval({ contexts, config: this.anthbotConfig });
        let intervalSeconds = polling.seconds;
        let reason = polling.reason;

        const backoffMs = Math.max(0, this.httpBackoffUntil - Date.now());
        if (backoffMs > 0) {
            intervalSeconds = Math.max(intervalSeconds, Math.ceil(backoffMs / 1000));
            reason = `rate-limit-backoff/${reason}`;
        }

        this.log.debug(`Next poll in ${intervalSeconds}s (${reason}).`);
        this.setStateAsync('diagnostics.admin.httpPolling', { val: `${intervalSeconds}s (${reason})`, ack: true });
        this.setStateAsync('diagnostics.admin.httpBackoffUntil', {
            val: this.httpBackoffUntil ? new Date(this.httpBackoffUntil).toISOString() : '', ack: true,
        });

        this.pollTimer = this.setTimeout(async () => {
            this.pollTimer = null;
            try { await this.refreshAll(); }
            finally { if (!this.unloaded) this.schedulePoll(); }
        }, intervalSeconds * 1000);
    }

    async refreshAll(forceLogin = false) {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }
        this.refreshInFlight = this.doRefreshAll(forceLogin).finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }

    async doRefreshAll(forceLogin = false) {
        return this.runRefreshCycle(forceLogin, false);
    }

    async runRefreshCycle(forceLogin, retriedAfterAuthFailure) {
        let successful = 0;
        try {
            await this.ensureSession(forceLogin);
            await this.discoverDevices(forceLogin);
            await this.ensureEventCodeCache();
            for (const context of this.deviceContexts.values()) {
                try {
                    await this.refreshDevice(context);
                    successful += 1;
                } catch (error) {
                    if (this.isRateLimitError(error)) {
                        this.httpRateLimitCount += 1;
                        const minutes = Math.min(120, 15 * (2 ** Math.min(3, this.httpRateLimitCount - 1)));
                        this.httpBackoffUntil = Date.now() + minutes * 60 * 1000;
                        this.log.warn(`Anthbot cloud rate limit (429) for ${context.device.serialNumber}; HTTP shadow polling paused for ${minutes} minutes.`);
                    } else {
                        this.log.warn(`Refresh failed for ${context.device.serialNumber}: ${error?.stack || error?.message || String(error)}`);
                    }
                }
            }
        } catch (error) {
            if (!retriedAfterAuthFailure && !forceLogin && isLikelyAuthenticationError(error)) {
                this.log.info('Anthbot cloud session expired, retrying refresh with a new login.');
                return this.runRefreshCycle(true, true);
            }
            this.log.error(`Global refresh failed: ${error.message}`);
        }

        await this.setStateAsync('info.connection', successful > 0, true);
    }

    getEventCodeCacheFilePath() {
        return path.join(
            utils.getAbsoluteDefaultDataDir(),
            `${this.name}.${this.instance}`,
            'event-code-cache.json',
        );
    }

    async ensureEventCodeCache() {
        if (this.eventCodeCacheInitialized) {
            return;
        }
        this.eventCodeCacheInitialized = true;

        let cached = await this.readEventCodeCacheFile();
        if (!cached) {
            cached = await this.migrateLegacyEventCodeState();
        } else {
            await this.removeLegacyEventCodeStates();
        }
        this.eventCodeCache = cached;

        let cloudVersion = null;
        try {
            cloudVersion = await this.cloudClient.getEventCodeVersion();
        } catch (error) {
            if (cached) {
                this.log.warn(`Failed to fetch event code version, using cached translations: ${error.message}`);
            } else {
                this.log.warn(
                    `Failed to fetch event code version and no cached translations are available: ${error.message}`,
                );
            }
            return;
        }

        if (cached && asInteger(cached.version) === cloudVersion) {
            this.eventCodeCache = cached;
            return;
        }

        try {
            const payload = await this.cloudClient.getEventCodeTranslations(cloudVersion);
            this.eventCodeCache = {
                version: cloudVersion,
                fetchedAt: new Date().toISOString(),
                payload,
            };
            await this.writeEventCodeCacheFile(this.eventCodeCache);
        } catch (error) {
            if (cached) {
                this.log.warn(`Failed to fetch event code translations, using cached translations: ${error.message}`);
                this.eventCodeCache = cached;
            } else {
                this.log.warn(
                    `Failed to fetch event code translations and no cached translations are available: ${error.message}`,
                );
            }
        }
    }

    async readEventCodeCacheFile() {
        const cacheFile = this.getEventCodeCacheFilePath();
        try {
            const raw = await fs.readFile(cacheFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (this.isValidEventCodeCache(parsed)) {
                return parsed;
            }
            this.log.warn(`Ignoring invalid event code cache file: ${cacheFile}`);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                this.log.warn(`Event code cache file could not be read: ${error.message}`);
            }
        }
        return null;
    }

    async writeEventCodeCacheFile(cache) {
        if (!this.isValidEventCodeCache(cache)) {
            return;
        }

        const cacheFile = this.getEventCodeCacheFilePath();
        const cacheDirectory = path.dirname(cacheFile);
        const temporaryFile = `${cacheFile}.tmp`;
        await fs.mkdir(cacheDirectory, { recursive: true });
        await fs.writeFile(temporaryFile, `${JSON.stringify(cache)}\n`, 'utf8');
        await fs.rename(temporaryFile, cacheFile);
    }

    async migrateLegacyEventCodeState() {
        let migratedCache = null;

        for (const context of this.deviceContexts.values()) {
            const stateId = `${context.objectRoot}.raw.shadow.event-code`;
            try {
                const state = await this.getStateAsync(stateId);
                const raw = typeof state?.val === 'string' ? state.val : '';
                if (!migratedCache && raw) {
                    const parsed = JSON.parse(raw);
                    if (this.isValidEventCodeCache(parsed)) {
                        migratedCache = parsed;
                    }
                }
            } catch (error) {
                this.log.debug(`Legacy event code state could not be read for ${context.device.serialNumber}: ${error.message}`);
            }
        }

        if (migratedCache) {
            await this.writeEventCodeCacheFile(migratedCache);
            this.log.info('Migrated event code translations from ioBroker state storage to the local cache file.');
        }

        await this.removeLegacyEventCodeStates();
        return migratedCache;
    }

    async removeLegacyEventCodeStates() {
        for (const context of this.deviceContexts.values()) {
            const stateId = `${context.objectRoot}.raw.shadow.event-code`;
            try {
                await this.delObjectAsync(stateId);
            } catch (error) {
                this.log.debug(`Legacy event code state could not be removed for ${context.device.serialNumber}: ${error.message}`);
            }
        }
    }

    isValidEventCodeCache(cache) {
        return Boolean(
            cache &&
            typeof cache === 'object' &&
            asInteger(cache.version) != null &&
            cache.payload &&
            typeof cache.payload === 'object' &&
            !Array.isArray(cache.payload),
        );
    }

    async ensureSession(force = false) {
        const config = this.anthbotConfig;
        if (!this.cloudClient || force) {
            this.cloudClient = new AnthbotCloudApiClient({
                http: this.http,
                host: config.apiHost || 'api.anthbot.com',
                bearerToken: force ? null : this.authToken,
            });
        }
        if (!this.authToken || force) {
            this.authToken = await this.cloudClient.login({
                username: config.username,
                password: config.password,
                areaCode: String(config.areaCode || '49'),
            });
        }
    }

    async discoverDevices(force = false) {
        if (this.deviceContexts.size > 0 && !force) {
            return;
        }

        const devices = await this.cloudClient.getBoundDevices();
        if (!devices.length) {
            throw new AnthbotGenieError('No Anthbot devices found for this account');
        }

        const seenSerials = new Set(devices.map(device => device.serialNumber));
        await this.removeStaleDeviceContexts(seenSerials);

        for (const device of devices) {
            const region = await this.resolveDeviceRegion(device);
            const existing = this.deviceContexts.get(device.serialNumber);
            if (existing?.mqttClient) {
                await existing.mqttClient.stop();
            }
            const objectRoot = deviceObjectIdFromSerial(device.serialNumber, this.FORBIDDEN_CHARS);
            const context = {
                device,
                objectRoot,
                region,
                shadowClient: region.iotCredentials
                    ? this.buildShadowClient(device, region, region.iotCredentials)
                    : null,
                iotCredentials: region.iotCredentials,
                areaDefinition: existing?.areaDefinition || {},
                mapData: existing?.mapData || {},
                lastAreaTime: existing?.lastAreaTime || null,
                lastMapSignature: existing?.lastMapSignature || null,
                rtkSatelliteInfo: existing?.rtkSatelliteInfo || null,
                lastRtkSatelliteKey: existing?.lastRtkSatelliteKey || null,
                rtkSatelliteRefreshAt: existing?.rtkSatelliteRefreshAt || 0,
                lastReported: existing?.lastReported || {},
                lastService: existing?.lastService || {},
                pollingCategory: existing?.pollingCategory || null,
                pollingCategorySince: existing?.pollingCategorySince || Date.now(),
                lastMapSvg: existing?.lastMapSvg || '',
                dockPose: existing?.dockPose || null,
                mapDebug: Boolean(existing?.mapDebug),
                mapLayers: existing?.mapLayers || {
                    showManualZones: false,
                    showAutoZones: false,
                    showNoGoZones: true,
                    showPaths: true,
                    showCurrentTrack: true,
                    showLegend: false,
                },
                pathHistory: existing?.pathHistory || { taskId: null, packetPathId: null, points: [] },
                mapExport: existing?.mapExport || {},
                mapExportDirectory: this.getMapExportDirectory(device.serialNumber),
                zoneSelection: existing?.zoneSelection || { selected: '', lastResult: {} },
                mqttClient: null,
                mqttStatus: existing?.mqttStatus || {
                    state: 'disabled',
                    connected: false,
                    reconnectCount: 0,
                    lastMessageAt: null,
                    lastError: '',
                },
            };
            this.deviceContexts.set(device.serialNumber, context);
            this.deviceContextsByObjectRoot.set(objectRoot, context);
            await this.ensureDeviceObjects(context);
            await this.ensureDeviceMqtt(context);
        }
    }

    getMapExportDirectory(serialNumber) {
        const instanceDataDirectory =
            typeof /** @type {any} */ (this).getAbsoluteInstanceDataDir === 'function'
                ? /** @type {any} */ (this).getAbsoluteInstanceDataDir()
                : path.join(__dirname, 'data');
        return path.join(instanceDataDirectory, 'map-exports', String(serialNumber));
    }

    async resolveDeviceRegion(device) {
        let regionName = null;
        let iotEndpoint = null;
        let iotCredentials = null;

        try {
            const deviceRegion = await this.cloudClient.getDeviceRegion(device.serialNumber);
            regionName = deviceRegion.regionName;
            iotEndpoint = deviceRegion.iotEndpoint;
        } catch (error) {
            this.log.warn(
                `Failed to fetch region metadata for ${device.serialNumber}, using fallback discovery: ${error.message}`,
            );
        }

        try {
            const fallbackRegion = await this.cloudClient.getDevicePresignedRegion(device.serialNumber);
            if (fallbackRegion) {
                if (!regionName) {
                    regionName = fallbackRegion;
                }
                if (!iotEndpoint && !fallbackRegion.startsWith('cn')) {
                    iotEndpoint = AnthbotShadowApiClient.buildDefaultIotEndpointForRegion(fallbackRegion);
                } else if (iotEndpoint && !fallbackRegion.startsWith('cn')) {
                    const endpointRegion = AnthbotShadowApiClient.guessRegionFromEndpoint(iotEndpoint);
                    if (endpointRegion && endpointRegion !== fallbackRegion) {
                        regionName = fallbackRegion;
                        iotEndpoint = AnthbotShadowApiClient.buildDefaultIotEndpointForRegion(fallbackRegion);
                        this.log.debug(
                            `Overriding mismatched region metadata for ${device.serialNumber}: region=${regionName}, endpoint=${iotEndpoint}`,
                        );
                    }
                }
            }
        } catch (error) {
            this.log.debug(`Presigned region fallback failed for ${device.serialNumber}: ${error.message}`);
        }

        try {
            iotCredentials = await this.cloudClient.getDeviceIotCredentials(device.serialNumber);
            regionName = iotCredentials.regionName || regionName;
            iotEndpoint = iotCredentials.endpoint || iotEndpoint;
        } catch (error) {
            this.log.warn(
                `Failed to fetch temporary IoT credentials for ${device.serialNumber}; shadow access is unavailable until STS succeeds again: ${error.message}`,
            );
        }

        return {
            serialNumber: device.serialNumber,
            regionName: regionName || AnthbotShadowApiClient.guessRegionFromEndpoint(iotEndpoint) || 'unknown',
            iotEndpoint,
            iotCredentials,
        };
    }

    async removeStaleDeviceContexts(seenSerials) {
        for (const serial of this.deviceContexts.keys()) {
            if (seenSerials.has(serial)) {
                continue;
            }
            const context = this.deviceContexts.get(serial);
            await context?.mqttClient?.stop().catch(() => {});
            this.deviceContexts.delete(serial);
            if (context?.objectRoot) {
                this.deviceContextsByObjectRoot.delete(context.objectRoot);
            }
            try {
                await this.delObjectAsync(
                    context?.objectRoot || deviceObjectIdFromSerial(serial, this.FORBIDDEN_CHARS),
                    { recursive: true },
                );
                this.log.info(`Removed stale device objects for ${serial}.`);
            } catch (error) {
                this.log.warn(`Failed to remove stale device objects for ${serial}: ${error.message}`);
            }
        }
    }

    async ensureDeviceObjects(context) {
        const serial = context.device.serialNumber;
        const root = context.objectRoot;

        await this.extendObjectAsync(root, {
            type: 'device',
            common: {
                name: context.device.alias,
            },
            native: {
                serialNumber: serial,
            },
        });

        for (const [id, type, name] of getDeviceChannelDefinitions(t)) {
            await this.extendObjectAsync(`${root}.${id}`, {
                type,
                common: { name },
                native: {},
            });
        }

        for (const [suffix, common] of Object.entries(getDeviceStateDefinitions(t))) {
            await this.extendObjectAsync(`${root}.${suffix}`, {
                type: 'state',
                common,
                native: {},
            });
        }
    }

    async refreshDevice(context) {
        if (context.mqttClient?.connected) {
            return;
        }
        if (this.httpBackoffUntil > Date.now()) {
            return;
        }
        await this.ensureDeviceIotCredentials(context);
        if (!context.shadowClient) {
            throw new AnthbotGenieError(
                `Skipping ${context.device.serialNumber}: temporary IoT credentials are unavailable for shadow access`,
            );
        }

        const propertyState = await context.shadowClient.getShadowReportedState();
        await this.applyPropertyState(context, propertyState, 'http');
        this.httpRateLimitCount = 0;
        this.httpBackoffUntil = 0;
    }

    async applyPropertyState(context, propertyState, source) {
        const mergedPropertyState = {
            ...(context.lastReported || {}),
            ...(propertyState || {}),
        };
        const areaTime = mergedPropertyState.area_time ?? null;
        const mapObject = mergedPropertyState.map && typeof mergedPropertyState.map === 'object' ? mergedPropertyState.map : {};
        const mapSignature = JSON.stringify({
            areaTime,
            mapTime: mergedPropertyState.map_time ?? mapObject.time ?? null,
            mapId: mergedPropertyState.map_tar_time ?? mapObject.map_id ?? null,
            areaId: mapObject.area_id ?? null,
            planId: mapObject.plan_id ?? null,
            state: mapObject.state ?? null,
        });
        const shouldRefreshArea =
            !context.areaDefinition ||
            Object.keys(context.areaDefinition).length === 0 ||
            !context.mapData ||
            Object.keys(context.mapData).length === 0 ||
            mapSignature !== context.lastMapSignature;

        if (shouldRefreshArea) {
            try {
                const map = await this.cloudClient.getDeviceMap(context.device.serialNumber);
                context.areaDefinition = map.areaDefinition;
                context.mapData = map.mapData;
                context.lastAreaTime = areaTime;
                context.lastMapSignature = mapSignature;
            } catch (error) {
                if (isLikelyAuthenticationError(error)) {
                    await this.ensureSession(true);
                    const map = await this.cloudClient.getDeviceMap(context.device.serialNumber);
                    context.areaDefinition = map.areaDefinition;
                    context.mapData = map.mapData;
                    context.lastAreaTime = areaTime;
                    context.lastMapSignature = mapSignature;
                } else {
                    this.log.debug(
                        `Area definition refresh failed for ${context.device.serialNumber}: ${error.message}`,
                    );
                }
            }
        }

        await this.refreshRtkSatelliteInfo(context, mergedPropertyState);

        context.lastReported = mergedPropertyState;
        context.lastPropertySource = source;
        updatePollingCategory(context);

        await this.updateStates(context, {
            ...mergedPropertyState,
            _service_reported: context.lastService || {},
            _area_definition: context.areaDefinition || {},
            _rtk_satellite_info: context.rtkSatelliteInfo || null,
        });

    }

    async applyServiceState(context, serviceState, source) {
        context.lastService = {
            ...(context.lastService || {}),
            ...(serviceState || {}),
        };
        context.lastServiceSource = source;

        // The official app listens for area_time on generic shadow messages,
        // not only on the named property shadow. Some map edits therefore
        // arrive through the service shadow. Forward only the map freshness
        // fields into the property processing path so zones/no-go areas reload.
        const mapObject = serviceState?.map && typeof serviceState.map === 'object' ? serviceState.map : null;
        const hasMapFreshnessHint = Boolean(
            serviceState && (
                serviceState.area_time != null ||
                serviceState.map_time != null ||
                serviceState.map_tar_time != null ||
                mapObject?.time != null ||
                mapObject?.map_id != null ||
                mapObject?.area_id != null ||
                mapObject?.plan_id != null ||
                mapObject?.state != null
            )
        );
        if (hasMapFreshnessHint) {
            const propertyHint = {
                ...(serviceState.area_time != null ? { area_time: serviceState.area_time } : {}),
                ...(serviceState.map_time != null ? { map_time: serviceState.map_time } : {}),
                ...(serviceState.map_tar_time != null ? { map_tar_time: serviceState.map_tar_time } : {}),
                ...(mapObject ? { map: mapObject } : {}),
            };
            await this.applyPropertyState(context, propertyHint, `${source}-map-hint`);
            return;
        }

        await this.updateStates(context, {
            ...(context.lastReported || {}),
            _service_reported: context.lastService,
            _area_definition: context.areaDefinition || {},
            _rtk_satellite_info: context.rtkSatelliteInfo || null,
        });
    }

    async refreshRtkSatelliteInfo(context, propertyState) {
        const rtkBase = propertyState?.rtk_base && typeof propertyState.rtk_base === 'object' ? propertyState.rtk_base : {};
        const rtkId = rtkBase.rtk_id ?? null;
        if (!rtkId) return;

        const now = Date.now();
        const explicitSatelliteTime = propertyState?.bt_satellite_time ?? null;
        const key = `${rtkId}:${explicitSatelliteTime ?? ''}`;
        const lastAttemptAt = Number(context.rtkSatelliteRefreshAt || 0);
        const cooldownMs = 300000;
        const due = now - lastAttemptAt >= cooldownMs;
        const keyChanged = key !== context.lastRtkSatelliteKey;
        const rtkIdChanged = String(rtkId) !== String(context.lastRtkSatelliteRtkId ?? '');

        // Ignore the frequently changing generic RTK/base timestamps here. They caused
        // several archive downloads per minute although the satellite file had not changed.
        if (!rtkIdChanged && !keyChanged && !due) return;
        if (context.rtkSatelliteRefreshPromise) return context.rtkSatelliteRefreshPromise;

        context.lastRtkSatelliteKey = key;
        context.lastRtkSatelliteRtkId = rtkId;
        context.rtkSatelliteRefreshAt = now;

        context.rtkSatelliteRefreshPromise = (async () => {
            try {
                if (context.shadowClient) {
                    await context.shadowClient.publishServiceCommand({ cmd: 'req_rtk_base_info', data: {} });
                    await new Promise(resolve => setTimeout(resolve, 1200));
                }
                const satelliteInfo = await this.cloudClient.getRtkSatelliteInfo(context.device.serialNumber, rtkId);
                context.rtkSatelliteInfo = satelliteInfo;
            } catch (error) {
                const nested = error instanceof AggregateError && Array.isArray(error.errors)
                    ? error.errors.map(item => item?.message || String(item)).filter(Boolean).join(' | ')
                    : '';
                const detail = nested || error?.cause?.message || error?.message || String(error);
                const retryAt = new Date(context.rtkSatelliteRefreshAt + cooldownMs).toISOString();
                this.log.debug(`RTK satellite refresh failed for ${context.device.serialNumber}: ${detail}; next retry not before ${retryAt}`);
            } finally {
                context.rtkSatelliteRefreshPromise = null;
            }
        })();

        return context.rtkSatelliteRefreshPromise;
    }

    async ensureDeviceMqtt(context) {
        if (this.anthbotConfig.mqttEnabled === false) {
            if (context.mqttClient) {
                await context.mqttClient.stop();
                context.mqttClient = null;
            }
            context.mqttStatus = { state: 'disabled', connected: false, reconnectCount: 0, lastMessageAt: null, lastError: '' };
            return;
        }
        if (context.mqttClient) {
            return;
        }

        context.mqttClient = new AnthbotMqttShadowClient({
            serialNumber: context.device.serialNumber,
            credentialsProvider: async () => {
                const credentials = await this.cloudClient.getDeviceIotCredentials(context.device.serialNumber);
                context.iotCredentials = credentials;
                context.region = {
                    ...context.region,
                    regionName: credentials.regionName || context.region.regionName,
                    iotEndpoint: credentials.endpoint || context.region.iotEndpoint,
                    iotCredentials: credentials,
                };
                context.shadowClient = this.buildShadowClient(context.device, context.region, credentials);
                return credentials;
            },
            onPropertyState: async state => this.applyPropertyState(context, state, 'mqtt'),
            onServiceState: async state => this.applyServiceState(context, state, 'mqtt'),
            onStatus: async status => {
                const wasConnected = Boolean(context.mqttStatus?.connected);
                context.mqttStatus = status;
                await this.updateMqttStatusStates(context);
                if (wasConnected !== Boolean(status.connected)) {
                    this.schedulePoll();
                }
            },
            log: (level, message) => {
                const logger = this.log[level] || this.log.debug;
                logger.call(this.log, message);
            },
        });
        context.mqttClient.start().catch(error => {
            this.log.debug(`MQTT start failed for ${context.device.serialNumber}: ${error.message}`);
        });
    }

    async updateMqttStatusStates(context) {
        const root = context.objectRoot;
        const status = context.mqttStatus || {};
        await this.setStateIfChanged(`${root}.diagnostics.mqtt.connected`, Boolean(status.connected));
        await this.setStateIfChanged(`${root}.diagnostics.mqtt.state`, String(status.state || ''));
        await this.setStateIfChanged(`${root}.diagnostics.mqtt.lastMessage`, status.lastMessageAt || '');
        await this.setStateIfChanged(`${root}.diagnostics.mqtt.lastError`, status.lastError || '');
        await this.setStateIfChanged(`${root}.diagnostics.mqtt.reconnectCount`, Number(status.reconnectCount) || 0);
    }

    async ensureDeviceIotCredentials(context) {
        if (
            context.shadowClient &&
            context.iotCredentials &&
            (!context.iotCredentials.expiresAt || context.iotCredentials.expiresAt - Date.now() > 60000)
        ) {
            return;
        }
        try {
            const iotCredentials = await this.cloudClient.getDeviceIotCredentials(context.device.serialNumber);
            context.iotCredentials = iotCredentials;
            context.region = {
                ...context.region,
                regionName: iotCredentials.regionName || context.region.regionName,
                iotEndpoint: iotCredentials.endpoint || context.region.iotEndpoint,
                iotCredentials,
            };
            context.shadowClient = this.buildShadowClient(context.device, context.region, iotCredentials);
        } catch (error) {
            context.iotCredentials = null;
            context.shadowClient = null;
            throw new AnthbotGenieError(
                `Temporary IoT credentials are unavailable for ${context.device.serialNumber}; shadow access is disabled until the STS endpoint recovers: ${error.message}`,
            );
        }
    }

    buildShadowClient(device, region, iotCredentials) {
        return new AnthbotShadowApiClient({
            http: this.http,
            serialNumber: device.serialNumber,
            regionName: region.regionName,
            iotEndpoint: region.iotEndpoint,
            accountClient: this.cloudClient,
            iotCredentials,
            deviceModel: device.model,
        });
    }

    async setStateIfChanged(id, value) {
        if (this.stateValueCache.has(id) && Object.is(this.stateValueCache.get(id), value)) {
            return false;
        }

        if (!this.stateValueCache.has(id)) {
            const current = await this.getStateAsync(id);
            if (current && Object.is(current.val, value)) {
                this.stateValueCache.set(id, value);
                return false;
            }
        }

        await this.setStateAsync(id, { val: value, ack: true });
        this.stateValueCache.set(id, value);
        return true;
    }

    async updateStates(context, data) {
        const root = context.objectRoot;
        const updates = buildDeviceStateUpdates({
            context,
            data,
            eventCodeCache: this.eventCodeCache,
            errorDescriptionLanguage: this.anthbotConfig.errorDescriptionLanguage || 'English',
            now: new Date(),
        });

        for (const [suffix, value] of Object.entries(updates)) {
            await this.setStateIfChanged(`${root}.${suffix}`, value);
        }

        if (context === this.deviceContexts.values().next().value) {
            const shown = value => value === null || value === undefined || value === '' ? 'not transmitted' : String(value);
            const summary = {
                device: context.device.alias || context.device.serialNumber,
                mqtt: this.localizeAdminValue(context.mqttClient?.connected ? 'connected' : String(context.mqttStatus?.state || 'disconnected')),
                robotFix: this.localizeAdminValue(shown(updates['diagnostics.gnss.robot.fix'])),
                robotRawStatus: this.localizeAdminValue(shown(updates['diagnostics.gnss.robot.rawStatus'])),
                robotSatellites: this.localizeAdminValue(shown(updates['diagnostics.gnss.robot.satellites'])),
                baseState: this.localizeAdminValue(shown(updates['diagnostics.rtk.baseState'])),
                baseSatellites: this.localizeAdminValue(shown(updates['diagnostics.gnss.base.satellites'])),
                antennaMoved: Boolean(updates['diagnostics.rtk.antennaMoved']),
                assessment: this.localizeAssessment(shown(updates['diagnostics.gnss.assessment.message'])),
                lastUpdate: shown(updates['diagnostics.gnss.lastUpdate']),
                skyplotHtml: buildRtkSkyplotHtml(context.rtkSatelliteInfo?.satellites || [], { german: this.isGermanAdmin() }),
            };
            for (const [id, value] of Object.entries(summary)) {
                await this.setStateIfChanged(`diagnostics.admin.${id}`, value);
            }
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }

        const parts = id.replace(`${this.namespace}.`, '').split('.');
        if (parts.length < 3) {
            return;
        }

        const [objectRoot, section, ...commandParts] = parts;
        const command = commandParts.join('.');
        const context = this.deviceContextsByObjectRoot.get(objectRoot);
        if (!context) {
            this.log.warn(`No device context for state ${id}`);
            return;
        }

        const localOnly =
            (section === 'controls' &&
                (command.startsWith('map.') || command === 'zoneSelection.selected')) ||
            (section === 'commands' &&
                ['map.clearTrack', 'map.saveSvg', 'map.createPng'].includes(command));

        let commandError = null;
        try {
            if (section === 'commands') {
                await this.handleCommandState(context, command, state.val);
            } else if (section === 'controls') {
                await this.handleControlState(context, command, state.val);
            } else if (section === 'consumable') {
                await this.handleConsumableState(context, command, state.val);
            }
        } catch (error) {
            commandError = error;
            if (section === 'commands' && command === 'mowing.startSelectedZone') {
                context.zoneSelection = context.zoneSelection || {};
                context.zoneSelection.lastResult = {
                    ok: false,
                    message: error?.message || String(error),
                    time: new Date().toISOString(),
                };
            }
        } finally {
            try {
                if (localOnly) {
                    await this.updateStates(context, {
                        ...(context.lastReported || {}),
                        _service_reported: context.lastService || {},
                        _area_definition: context.areaDefinition || {},
                    });
                } else {
                    await this.refreshDevice(context);
                }
            } catch (refreshError) {
                this.log.warn(`Post-command refresh failed for ${id}: ${refreshError.message}`);
            }
            await this.resetWriteState(id, section, command, context);
        }

        if (commandError) {
            this.log.error(`Command failed for ${id}: ${commandError.message}`);
        }
    }

    async resetWriteState(id, section, command, context) {
        if (
            (section === 'commands' && BOOLEAN_COMMANDS.includes(command)) ||
            (section === 'consumable' && Object.hasOwn(MAINTENANCE_RESET_TYPES, command))
        ) {
            await this.setStateAsync(id, { val: false, ack: true });
            return;
        }
        if (section === 'commands' && STRING_COMMANDS.includes(command)) {
            await this.setStateAsync(id, { val: '', ack: true });
            return;
        }
        if (section === 'controls') {
            const fallbackValue = this.getControlFallbackValue(context, command);
            if (fallbackValue !== undefined) {
                await this.setStateAsync(id, { val: fallbackValue, ack: true });
            }
        }
    }

    getControlFallbackValue(context, control) {
        return getControlFallbackValue(context.lastReported || {}, control, context);
    }

    async handleCommandState(context, command, value) {
        const shouldRun =
            value === true || value === 1 || value === 'true' || (typeof value === 'string' && value.trim() !== '');
        if (!shouldRun) {
            return;
        }

        await this.ensureDeviceIotCredentials(context);
        const shouldRequestProperties = await this.executeCommand(context, command, value);
        if (shouldRequestProperties) {
            await context.shadowClient.requestAllProperties();
        }
        await this.delay(1000);
    }

    async handleControlState(context, control, value) {
        if (value === null || value === undefined || value === '') {
            return;
        }

        const localOnly = control.startsWith('map.') || control === 'zoneSelection.selected';
        if (!localOnly) {
            await this.ensureDeviceIotCredentials(context);
        }

        await this.executeControl(context, control, value);

        if (localOnly) {
            await this.updateStates(context, {
                ...context.lastReported,
                _service_reported: context.lastService || {},
                _area_definition: context.areaDefinition || {},
            });
            return;
        }

        await context.shadowClient.requestAllProperties();
        await this.delay(1000);
    }

    async handleConsumableState(context, command, value) {
        const shouldRun = value === true || value === 1 || value === 'true';
        if (!shouldRun) {
            return;
        }

        await this.ensureDeviceIotCredentials(context);
        await this.executeConsumableCommand(context, command);
        await this.delay(1000);
    }

    async executeCommand(context, command, value) {
        return executeCommand({ context, command, value });
    }

    async executeConsumableCommand(context, command) {
        await executeConsumableCommand({ context, command });
    }

    async executeControl(context, control, value) {
        await executeControl({ context, control, value });
    }

    isRateLimitError(error) {
        const text = `${error?.message || ''} ${error?.stack || ''}`;
        return error?.status === 429 || error?.response?.status === 429 || /(?:\b429\b|TOO_MANY_REQUESTS)/i.test(text);
    }

    delay(ms) {
        return new Promise(resolve => this.setTimeout(resolve, ms));
    }
}

if (require.main !== module) {
    module.exports = options => new AnthbotGenieAdapter(options);
} else {
    new AnthbotGenieAdapter();
}
