'use strict';

const DEFAULT_ACTIVE_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_CHARGING_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_IDLE_POLL_INTERVAL_SECONDS = 900;

const MIN_POLL_INTERVAL_SECONDS = 15;
const MAX_POLL_INTERVAL_SECONDS = 3600;

/**
 * @param {string|number|null|undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
function normalizePollIntervalSeconds(value, defaultValue) {
    const parsed = Number(value);
    const intervalSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;

    return Math.min(
        MAX_POLL_INTERVAL_SECONDS,
        Math.max(MIN_POLL_INTERVAL_SECONDS, intervalSeconds),
    );
}

module.exports = {
    DEFAULT_ACTIVE_POLL_INTERVAL_SECONDS,
    DEFAULT_CHARGING_POLL_INTERVAL_SECONDS,
    DEFAULT_IDLE_POLL_INTERVAL_SECONDS,
    MAX_POLL_INTERVAL_SECONDS,
    MIN_POLL_INTERVAL_SECONDS,
    normalizePollIntervalSeconds,
};
