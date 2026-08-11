'use strict';

const { generalMowerStatus, rawModeStatus } = require('./payload');

const DEFAULT_FRESH_MS = 45000;
const DEFAULT_WAKE_WAIT_MS = 4000;
const DEFAULT_CONFIRM_WAIT_MS = 10000;

function mqttMessageAgeMs(context, now = Date.now()) {
    const raw = context?.mqttStatus?.lastMessageAt;
    const timestamp = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

function isMqttFresh(context, maxAgeMs = DEFAULT_FRESH_MS, now = Date.now()) {
    const age = mqttMessageAgeMs(context, now);
    return Boolean(context?.mqttStatus?.connected && age != null && age <= maxAgeMs);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFreshMqtt(context, newerThanMs, timeoutMs = DEFAULT_WAKE_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const last = Date.parse(context?.mqttStatus?.lastMessageAt || '');
        if (context?.mqttStatus?.connected && Number.isFinite(last) && last > newerThanMs) {
            return true;
        }
        await delay(250);
    }
    return false;
}

async function prepareCloudConnection(context, options = {}) {
    const freshMs = Number(options.freshMs || DEFAULT_FRESH_MS);
    const waitMs = Number(options.waitMs || DEFAULT_WAKE_WAIT_MS);
    const attempts = Math.max(1, Number(options.attempts || 2));

    if (isMqttFresh(context, freshMs)) {
        return { ok: true, source: 'mqtt-fresh', ageMs: mqttMessageAgeMs(context) };
    }

    // Preserve legacy HTTP/fallback operation when MQTT is intentionally disabled.
    if (!context?.mqttClient) {
        return { ok: true, source: 'mqtt-unavailable', confirmationAvailable: false };
    }

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const before = Date.now();
        await context.shadowClient.requestAllProperties();
        if (await waitForFreshMqtt(context, before, waitMs)) {
            return { ok: true, source: 'wake-confirmed', attempt, ageMs: mqttMessageAgeMs(context) };
        }
    }

    return { ok: false, source: 'wake-timeout', ageMs: mqttMessageAgeMs(context) };
}

function commandConfirmationRule(command) {
    const rules = {
        'mowing.startFullMap': new Set(['mowing', 'globalmowing', 'fullmowing', 'going_to_target', 'gototarget']),
        'mowing.startZone': new Set(['mowing', 'zonemowing', 'zone_mowing', 'going_to_target', 'gototarget']),
        'mowing.startSelectedZone': new Set(['mowing', 'zonemowing', 'zone_mowing', 'regionmowing', 'going_to_target', 'gototarget']),
        'mowing.startAutoZone': new Set(['mowing', 'regionmowing', 'region_mowing', 'going_to_target', 'gototarget']),
        'mowing.startNearCharger': new Set(['mowing', 'nestmowing', 'near_charger_mowing']),
        'mowing.startEdge': new Set(['mowing', 'bordermowing', 'border_mowing']),
        'docking.startReturn': new Set(['returning_to_dock', 'returning', 'backtodock', 'charging', 'charge']),
        'mowing.pause': new Set(['paused', 'pause', 'idle']),
        'mowing.resume': new Set(['mowing', 'zonemowing', 'regionmowing', 'globalmowing', 'fullmowing']),
        'mowing.stop': new Set(['idle', 'charging', 'charge', 'standby']),
        'mowing.end': new Set(['idle', 'charging', 'charge', 'standby']),
    };
    return rules[command] || null;
}

function normalizedStateCandidates(data) {
    return new Set([
        String(generalMowerStatus(data || {}) || '').toLowerCase(),
        String(rawModeStatus(data || {}) || '').toLowerCase(),
        String(data?.robot_sta?.value || '').toLowerCase(),
        String(data?.mode?.value || data?.mode || '').toLowerCase(),
    ].filter(Boolean));
}

function isCommandConfirmed(command, data) {
    const expected = commandConfirmationRule(command);
    if (!expected) return null;
    const actual = normalizedStateCandidates(data);
    for (const value of actual) {
        if (expected.has(value)) return true;
    }
    return false;
}

async function waitForCommandConfirmation(context, command, options = {}) {
    const expected = commandConfirmationRule(command);
    if (!expected) return { supported: false, confirmed: false };
    if (!context?.mqttClient) return { supported: true, confirmed: false, unavailable: true };

    const waitMs = Number(options.waitMs || DEFAULT_CONFIRM_WAIT_MS);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        if (isCommandConfirmed(command, context.lastReported || {})) {
            return { supported: true, confirmed: true };
        }
        await delay(250);
    }
    return { supported: true, confirmed: false };
}

module.exports = {
    DEFAULT_CONFIRM_WAIT_MS,
    DEFAULT_FRESH_MS,
    DEFAULT_WAKE_WAIT_MS,
    commandConfirmationRule,
    isCommandConfirmed,
    isMqttFresh,
    mqttMessageAgeMs,
    prepareCloudConnection,
    waitForCommandConfirmation,
    waitForFreshMqtt,
};
