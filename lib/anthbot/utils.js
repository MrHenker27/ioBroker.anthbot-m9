'use strict';

const { M_SERIES_MODEL_PATTERN, ROBOT_STATUS_BY_CODE } = require('./constants');

/** Anthbot-specific error wrapper. */
class AnthbotGenieError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = 'AnthbotGenieError';
        /** @type {number|null} */
        this.status = null;
    }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isLikelyAuthenticationError(error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /(401|403|auth|authorization|unauthori[sz]ed|token|bearer token|login rejected)/i.test(message);
}

/**
 * @param {object|*} data
 * @param {...(string|number)} path
 * @returns {*|undefined}
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
 * @param {string|number|boolean|null|undefined} value
 * @returns {number|null}
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
 * @param {string|number|null|undefined} value
 * @returns {string|null}
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
 * @param {string|number|boolean|null|undefined} value
 * @returns {boolean}
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

/**
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * @param {...unknown} values
 * @returns {unknown}
 */
function firstPresent(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return null;
}

/**
 * @param {...unknown} values
 * @returns {string|null}
 */
function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return null;
}

/**
 * @param {string|number|null|undefined} value
 * @returns {string|null}
 */
function normalizeRobotStatusValue(value) {
    if (typeof value === 'string') {
        return value.toLowerCase();
    }
    if (Number.isInteger(value)) {
        return ROBOT_STATUS_BY_CODE[/** @type {number} */ (value)] || String(value);
    }
    return null;
}

/**
 * @param {string|null|undefined} deviceModel
 * @returns {boolean}
 */
function isMSeriesModel(deviceModel) {
    return typeof deviceModel === 'string' && M_SERIES_MODEL_PATTERN.test(deviceModel);
}

/**
 * @param {*} value
 * @returns {Array<object>}
 */
function listOfDicts(value) {
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
}

/**
 * @param {object} data
 * @returns {object}
 */
function getAreaDefinition(data) {
    return data && typeof data._area_definition === 'object' && !Array.isArray(data._area_definition)
        ? data._area_definition
        : {};
}

/**
 * @param {string|number|boolean|null|undefined} value
 * @returns {boolean}
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
 * @param {Array<*>|string|number|null|undefined} value
 * @returns {Array<*>}
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

/**
 * Derive a stable ioBroker object root from an external mower serial.
 * Unsafe characters are normalized so cloud-provided serials cannot create
 * invalid object ids or unexpected nested paths.
 *
 * @param {string|number|null|undefined} serialNumber
 * @param {RegExp} forbiddenChars
 * @returns {string}
 */
function deviceObjectIdFromSerial(serialNumber, forbiddenChars) {
    const sn = typeof serialNumber === 'string' ? serialNumber.trim() : String(serialNumber ?? '').trim();
    return sn ? sn.replace(/\s+/g, '_').replace(forbiddenChars, '_') : 'device';
}

module.exports = {
    AnthbotGenieError,
    asInteger,
    asIsoTimestamp,
    asNumber,
    coerceEnabledValue,
    deviceObjectIdFromSerial,
    firstNonEmptyString,
    firstPresent,
    getAreaDefinition,
    isLikelyAuthenticationError,
    isMSeriesModel,
    isNonZero,
    listOfDicts,
    normalizeRobotStatusValue,
    parseCommandSelection,
    safeGet,
};
