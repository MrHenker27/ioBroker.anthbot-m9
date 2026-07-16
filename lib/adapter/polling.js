'use strict';

const { generalMowerStatus, isCharging } = require('../anthbot/payload');

const ACTIVE_STATUSES = new Set([
    'mowing',
    'returning_to_dock',
    'mapping',
    'positioning',
    'resuming',
    'remote_control',
    'going_to_target',
]);

const DEFAULTS = Object.freeze({
    activeSeconds: 30,
    chargingSeconds: 60,
    idleRecentSeconds: 60,
    idleLongSeconds: 180,
    idleLongAfterMinutes: 10,
    nightSeconds: 300,
    nightStartHour: 22,
    nightEndHour: 6,
});

const MIN_POLL_INTERVAL_SECONDS = 15;
const MAX_POLL_INTERVAL_SECONDS = 3600;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} [minimum]
 * @param {number} [maximum]
 * @returns {number}
 */
function normalizeNumber(value, fallback, minimum = MIN_POLL_INTERVAL_SECONDS, maximum = MAX_POLL_INTERVAL_SECONDS) {
    const parsed = Number(value);
    const result = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(maximum, Math.max(minimum, result));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function asBoolean(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * @param {number} hour
 * @param {number} startHour
 * @param {number} endHour
 * @returns {boolean}
 */
function isHourInWindow(hour, startHour, endHour) {
    if (startHour === endHour) {
        return false;
    }
    if (startHour < endHour) {
        return hour >= startHour && hour < endHour;
    }
    return hour >= startHour || hour < endHour;
}

/**
 * @param {object} reported
 * @returns {'active'|'charging'|'idle'}
 */
function pollingCategory(reported) {
    if (ACTIVE_STATUSES.has(generalMowerStatus(reported || {}))) {
        return 'active';
    }
    if (isCharging(reported || {})) {
        return 'charging';
    }
    return 'idle';
}

/**
 * Store when the current polling category began.
 *
 * @param {object} context
 * @param {number} [now]
 * @returns {'active'|'charging'|'idle'}
 */
function updatePollingCategory(context, now = Date.now()) {
    const category = pollingCategory(context?.lastReported || {});
    if (context.pollingCategory !== category) {
        context.pollingCategory = category;
        context.pollingCategorySince = now;
    } else if (!Number.isFinite(context.pollingCategorySince)) {
        context.pollingCategorySince = now;
    }
    return category;
}

/**
 * @param {object} config
 * @returns {object}
 */
function normalizedPollingConfig(config = {}) {
    return {
        activeSeconds: normalizeNumber(config.pollIntervalActive, DEFAULTS.activeSeconds),
        chargingSeconds: normalizeNumber(config.pollIntervalCharging, DEFAULTS.chargingSeconds),
        idleRecentSeconds: normalizeNumber(config.pollIntervalIdle, DEFAULTS.idleRecentSeconds),
        idleLongSeconds: normalizeNumber(config.pollIntervalIdleLong, DEFAULTS.idleLongSeconds),
        idleLongAfterMinutes: normalizeNumber(
            config.idleLongAfterMinutes,
            DEFAULTS.idleLongAfterMinutes,
            1,
            1440,
        ),
        nightEnabled: asBoolean(config.nightPollingEnabled),
        nightSeconds: normalizeNumber(config.pollIntervalNight, DEFAULTS.nightSeconds),
        nightStartHour: normalizeNumber(config.nightStartHour, DEFAULTS.nightStartHour, 0, 23),
        nightEndHour: normalizeNumber(config.nightEndHour, DEFAULTS.nightEndHour, 0, 23),
    };
}

/**
 * Resolve the next polling interval for all known devices.
 *
 * Priority:
 * 1. At least one active mower -> active interval.
 * 2. Optional night window and no active mower -> night interval.
 * 3. At least one charging mower -> charging interval.
 * 4. Recently idle -> short idle interval.
 * 5. Long idle -> reduced polling frequency.
 *
 * @param {object} options
 * @param {object[]} options.contexts
 * @param {object} options.config
 * @param {number} [options.now]
 * @param {Date} [options.localDate]
 * @returns {{seconds:number, reason:string}}
 */
function resolvePollingInterval({ contexts, config, now = Date.now(), localDate = new Date(now) }) {
    const normalized = normalizedPollingConfig(config);
    const deviceContexts = Array.isArray(contexts) ? contexts : [];
    const categories = deviceContexts.map(context => updatePollingCategory(context, now));

    if (categories.includes('active')) {
        return { seconds: normalized.activeSeconds, reason: 'active' };
    }

    if (
        normalized.nightEnabled &&
        isHourInWindow(localDate.getHours(), normalized.nightStartHour, normalized.nightEndHour)
    ) {
        return { seconds: normalized.nightSeconds, reason: 'night' };
    }

    if (categories.includes('charging')) {
        return { seconds: normalized.chargingSeconds, reason: 'charging' };
    }

    const idleThresholdMs = normalized.idleLongAfterMinutes * 60 * 1000;
    const mostRecentIdleStart = deviceContexts.reduce((latest, context) => {
        const since = Number(context.pollingCategorySince);
        return Number.isFinite(since) ? Math.max(latest, since) : now;
    }, 0);
    const idleDurationMs = Math.max(0, now - mostRecentIdleStart);

    if (idleDurationMs < idleThresholdMs) {
        return { seconds: normalized.idleRecentSeconds, reason: 'idle-recent' };
    }

    return { seconds: normalized.idleLongSeconds, reason: 'idle-long' };
}

module.exports = {
    ACTIVE_STATUSES,
    DEFAULTS,
    MAX_POLL_INTERVAL_SECONDS,
    MIN_POLL_INTERVAL_SECONDS,
    asBoolean,
    isHourInWindow,
    normalizedPollingConfig,
    normalizeNumber,
    pollingCategory,
    resolvePollingInterval,
    updatePollingCategory,
};
