'use strict';

const { MODEL_NAME_BY_CATEGORY, RTK_BASE_STATE_OPTIONS, RTK_STATE_OPTIONS } = require('./constants');
const {
    asInteger,
    asNumber,
    coerceEnabledValue,
    firstNonEmptyString,
    firstPresent,
    getAreaDefinition,
    isMSeriesModel,
    listOfDicts,
    normalizeRobotStatusValue,
    safeGet,
} = require('./utils');

/**
 * @param {object} data
 * @returns {Record<string, number>}
 */
function paramSetSettings(data) {
    const settings = data?.param_set && typeof data.param_set === 'object' ? data.param_set : {};
    const result = /** @type {Record<string, number>} */ ({});
    for (const key of ['cutter_height', 'mow_count', 'mow_head', 'enable_adaptive_head', 'rid_switch', 'nest_switch']) {
        if (typeof settings[key] === 'number') {
            result[key] = settings[key];
        }
    }
    return result;
}

/**
 * @param {string|null|undefined} deviceModel
 * @param {object} data
 * @param {Record<string, number>} patch
 * @returns {Record<string, number>}
 */
function buildParamSetPayload(deviceModel, data, patch) {
    const current = paramSetSettings(data);
    if (isMSeriesModel(deviceModel)) {
        return {
            ...current,
            ...patch,
        };
    }
    const legacyBase = /** @type {Record<string, number>} */ ({
        cutter_height: typeof current.cutter_height === 'number' ? current.cutter_height : 30,
        mow_count: typeof current.mow_count === 'number' ? current.mow_count : 1,
        mow_head: typeof current.mow_head === 'number' ? current.mow_head : 0,
        enable_adaptive_head: typeof current.enable_adaptive_head === 'number' ? current.enable_adaptive_head : 1,
    });
    if (typeof current.rid_switch === 'number') {
        legacyBase.rid_switch = current.rid_switch;
    }
    if (typeof current.nest_switch === 'number') {
        legacyBase.nest_switch = current.nest_switch;
    }
    return {
        ...legacyBase,
        ...patch,
    };
}

/**
 * @param {object} data
 * @returns {Record<string, number>}
 */
function nestMowParams(data) {
    const legacySettings = data?.nest_param_set && typeof data.nest_param_set === 'object' ? data.nest_param_set : {};
    const result = /** @type {Record<string, number>} */ ({});
    const valueMap = {
        nest_switch: firstPresent(data?.nest_switch, safeGet(data, 'param_set', 'nest_switch')),
        nest_mow_count: firstPresent(data?.nest_mow_count, legacySettings.mow_count),
        nest_cutter_height: firstPresent(
            data?.nest_cutter_height,
            legacySettings.cutter_height,
            safeGet(data, 'param_set', 'cutter_height'),
        ),
        nest_pobctl_switch: firstPresent(data?.nest_pobctl_switch, legacySettings.pobctl_switch),
        nest_pobctl_level: firstPresent(data?.nest_pobctl_level, legacySettings.pobctl_level),
    };
    for (const [key, value] of Object.entries(valueMap)) {
        const intValue = asInteger(/** @type {string|number|boolean|null|undefined} */ (value));
        if (intValue != null) {
            result[key] = intValue;
        }
    }
    return result;
}

/**
 * @param {object} data
 * @param {Record<string, number>} patch
 * @returns {Record<string, number>}
 */
function buildNestMowParamsPayload(data, patch) {
    const current = nestMowParams(data);
    const payload = /** @type {Record<string, number>} */ ({
        nest_switch: typeof current.nest_switch === 'number' ? current.nest_switch : 0,
        nest_mow_count: typeof current.nest_mow_count === 'number' ? current.nest_mow_count : 1,
        nest_cutter_height: typeof current.nest_cutter_height === 'number' ? current.nest_cutter_height : 35,
        nest_pobctl_switch: typeof current.nest_pobctl_switch === 'number' ? current.nest_pobctl_switch : 0,
        nest_pobctl_level: typeof current.nest_pobctl_level === 'number' ? current.nest_pobctl_level : 1,
    });
    return {
        ...payload,
        ...patch,
    };
}

/**
 * @param {object} data
 * @param {boolean} [withDefaults]
 * @returns {{ cutter_height: number|null, mow_count: number|null, pobctl_level: number|null, pobctl_switch: number|null }}
 */
function nearChargerMowingSettings(data, withDefaults = false) {
    const settings = data?.nest_param_set && typeof data.nest_param_set === 'object' ? data.nest_param_set : {};
    return {
        cutter_height:
            typeof data?.nest_cutter_height === 'number'
                ? data.nest_cutter_height
                : typeof settings.cutter_height === 'number'
                  ? settings.cutter_height
                  : withDefaults
                    ? 30
                    : null,
        mow_count:
            typeof data?.nest_mow_count === 'number'
                ? data.nest_mow_count
                : typeof settings.mow_count === 'number'
                  ? settings.mow_count
                  : withDefaults
                    ? 2
                    : null,
        pobctl_level:
            typeof data?.nest_pobctl_level === 'number'
                ? data.nest_pobctl_level
                : typeof settings.pobctl_level === 'number'
                  ? settings.pobctl_level
                  : withDefaults
                    ? 0
                    : null,
        pobctl_switch:
            typeof data?.nest_pobctl_switch === 'number'
                ? data.nest_pobctl_switch
                : typeof settings.pobctl_switch === 'number'
                  ? settings.pobctl_switch
                  : withDefaults
                    ? 1
                    : null,
    };
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function rawModeStatus(data) {
    return normalizeRobotStatusValue(safeGet(data, 'mode', 'value'));
}

/**
 * @param {object} data
 * @returns {number|null}
 */
function batteryLevel(data) {
    return asInteger(
        /** @type {string|number|boolean|null|undefined} */ (firstPresent(safeGet(data, 'elec', 'value'), data?.elec)),
    );
}

/**
 * @param {object} data
 * @returns {number|null}
 */
function errorCode(data) {
    return asInteger(
        /** @type {string|number|boolean|null|undefined} */ (
            firstPresent(data?.err_code, safeGet(data, 'error', 'value'))
        ),
    );
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function wifiSsid(data) {
    return firstNonEmptyString(data?.sta_ssid, safeGet(data, 'net_config', 'ssid'));
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function ipAddress(data) {
    return firstNonEmptyString(data?.sta_ip_addr, safeGet(data, 'net_config', 'ip'));
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function simCcid(data) {
    return firstNonEmptyString(data?.['4g_ccid'], safeGet(data, 'net_config', '4g_ccid'));
}

/**
 * @param {object} data
 * @returns {boolean}
 */
function simPresent(data) {
    if (safeGet(data, 'sim_status', 'status') !== undefined) {
        return coerceEnabledValue(safeGet(data, 'sim_status', 'status'));
    }
    return Boolean(simCcid(data));
}

/**
 * @param {object} data
 * @returns {number|null}
 */
function mapArea(data) {
    return asNumber(
        /** @type {string|number|null|undefined} */ (firstPresent(data?.map_area, safeGet(data, 'map', 'map_area'))),
    );
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function mappingTaskState(data) {
    const value = safeGet(data, 'mapping_task', 'state');
    if (typeof value === 'string' && value.trim()) {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

/**
 * @param {object} data
 * @returns {number|null}
 */
function totalMowingTime(data) {
    return asNumber(safeGet(data, 'mowing_time', 'value'));
}

/**
 * @param {object} data
 * @returns {number|null}
 */
function totalMowingArea(data) {
    return asNumber(safeGet(data, 'mowing_area', 'value'));
}

/**
 * @param {string|number|null|undefined} categoryId
 * @returns {string}
 */
function modelNameByCategory(categoryId) {
    const raw = categoryId != null ? String(categoryId) : '';
    return MODEL_NAME_BY_CATEGORY[raw] || (raw ? `Anthbot ${raw}` : 'Anthbot mower');
}

/**
 * @param {object|*} cacheOrPayload
 * @returns {Record<string, any>}
 */
function eventCodeTranslationsFromCache(cacheOrPayload) {
    const payload =
        cacheOrPayload?.payload && typeof cacheOrPayload.payload === 'object' ? cacheOrPayload.payload : cacheOrPayload;
    return payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
}

/**
 * @param {object} data
 * @param {object|*} [cacheOrPayload]
 * @param {string} [language]
 * @returns {string|null}
 */
function errorDescription(data, cacheOrPayload = null, language = 'English') {
    const code = errorCode(data);
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
 * @param {object} data
 * @returns {string|null}
 */
function rtkStateLabel(data) {
    const rawState = safeGet(data, 'rtk', 'state');
    if (typeof rawState === 'string' && rawState.trim()) {
        return rawState.trim().toLowerCase();
    }
    const code = asInteger(
        /** @type {string|number|boolean|null|undefined} */ (firstPresent(rawState, data?.rtk_state)),
    );
    return code == null ? null : RTK_STATE_OPTIONS[code] || 'unknown';
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function rtkBaseStateLabel(data) {
    const code = asInteger(safeGet(data, 'ctl_rtk_base', 'rtk_base_state'));
    return code == null ? null : RTK_BASE_STATE_OPTIONS[code] || 'unknown';
}

/**
 * @param {object} data
 * @returns {Array<object>}
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
 * @param {object} data
 * @returns {Array<object>}
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
 * @param {object} data
 * @returns {Array<number>}
 */
function activeManualZoneIds(data) {
    const ids = data?.active_area?.id;
    return Array.isArray(ids) ? ids.filter(id => Number.isInteger(id)) : [];
}

/**
 * @param {object} data
 * @returns {boolean}
 */
function isCustomDirectionEnabled(data) {
    const raw = data?.param_set?.enable_adaptive_head;
    return !coerceEnabledValue(raw);
}

/**
 * @param {object} data
 * @returns {string|null}
 */
function rawRobotStatus(data) {
    return normalizeRobotStatusValue(safeGet(data, 'robot_sta', 'value')) || rawModeStatus(data);
}

/**
 * @param {object} data
 * @returns {string}
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
 * @param {object} data
 * @returns {boolean}
 */
function isCharging(data) {
    return generalMowerStatus(data) === 'charging';
}

/**
 * @param {Array<object>} zones
 * @returns {Array<object>}
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
 * @param {object} data
 * @returns {{ blades: number|null, cameras: number|null, chargingPort: number|null }}
 */
function consumableLifetimes(data) {
    const maintenance = data?.robot_maintenance || {};

    return {
        blades: typeof maintenance.rc_pecent === 'number' ? maintenance.rc_pecent : null,
        cameras: typeof maintenance.cl_pecent === 'number' ? maintenance.cl_pecent : null,
        chargingPort: typeof maintenance.ccp_pecent === 'number' ? maintenance.ccp_pecent : null,
    };
}

module.exports = {
    activeManualZoneIds,
    autoZones,
    batteryLevel,
    buildNestMowParamsPayload,
    buildParamSetPayload,
    compactZonePayload,
    consumableLifetimes,
    errorCode,
    errorDescription,
    generalMowerStatus,
    ipAddress,
    isCharging,
    isCustomDirectionEnabled,
    manualZones,
    mapArea,
    mappingTaskState,
    modelNameByCategory,
    nearChargerMowingSettings,
    rawModeStatus,
    rawRobotStatus,
    rtkBaseStateLabel,
    rtkStateLabel,
    simCcid,
    simPresent,
    totalMowingArea,
    totalMowingTime,
    wifiSsid,
};
