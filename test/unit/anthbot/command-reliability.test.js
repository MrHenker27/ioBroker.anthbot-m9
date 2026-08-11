'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isCommandConfirmed,
    isMqttFresh,
    prepareCloudConnection,
} = require('../../../lib/anthbot/command-reliability');

test('recognizes a fresh MQTT connection', () => {
    const now = Date.now();
    const context = { mqttStatus: { connected: true, lastMessageAt: new Date(now - 1000).toISOString() } };
    assert.equal(isMqttFresh(context, 45000, now), true);
});

test('wake handshake is skipped for fresh MQTT', async () => {
    let requests = 0;
    const context = {
        mqttClient: {},
        mqttStatus: { connected: true, lastMessageAt: new Date().toISOString() },
        shadowClient: { requestAllProperties: async () => { requests += 1; } },
    };
    const result = await prepareCloudConnection(context, { freshMs: 45000, waitMs: 10, attempts: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'mqtt-fresh');
    assert.equal(requests, 0);
});

test('legacy command path remains available when MQTT is disabled', async () => {
    const context = { mqttClient: null, mqttStatus: { connected: false, lastMessageAt: null }, shadowClient: {} };
    const result = await prepareCloudConnection(context);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'mqtt-unavailable');
    assert.equal(result.confirmationAvailable, false);
});

test('confirms full-map mowing from mower mode', () => {
    assert.equal(isCommandConfirmed('mowing.startFullMap', { mode: { value: 'globalmowing' } }), true);
});

test('confirms return-to-dock from backtodock mode', () => {
    assert.equal(isCommandConfirmed('docking.startReturn', { mode: { value: 'backtodock' } }), true);
});
