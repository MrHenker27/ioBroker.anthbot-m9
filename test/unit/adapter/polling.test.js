'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    isHourInWindow,
    resolvePollingInterval,
    updatePollingCategory,
} = require('../../../lib/adapter/polling');

function context(reported, since = 0) {
    return {
        lastReported: reported,
        pollingCategory: null,
        pollingCategorySince: since,
    };
}

const config = {
    pollIntervalActive: 30,
    pollIntervalCharging: 60,
    pollIntervalIdle: 60,
    pollIntervalIdleLong: 180,
    idleLongAfterMinutes: 10,
    nightPollingEnabled: false,
    pollIntervalNight: 300,
    nightStartHour: 22,
    nightEndHour: 6,
};

test('active polling has highest priority', () => {
    const mower = context({ mode: { value: 'regionmowing' } });
    const result = resolvePollingInterval({ contexts: [mower], config, now: 1000 });
    assert.deepEqual(result, { seconds: 30, reason: 'active' });
});

test('charging uses 60 seconds', () => {
    const mower = context({ mode: { value: 'charge' } });
    const result = resolvePollingInterval({ contexts: [mower], config, now: 1000 });
    assert.deepEqual(result, { seconds: 60, reason: 'charging' });
});

test('idle changes from recent to long after ten minutes', () => {
    const mower = context({ mode: { value: 'standby' } });
    updatePollingCategory(mower, 0);

    assert.deepEqual(
        resolvePollingInterval({ contexts: [mower], config, now: 9 * 60 * 1000 }),
        { seconds: 60, reason: 'idle-recent' },
    );
    assert.deepEqual(
        resolvePollingInterval({ contexts: [mower], config, now: 11 * 60 * 1000 }),
        { seconds: 180, reason: 'idle-long' },
    );
});

test('optional overnight window supports crossing midnight', () => {
    assert.equal(isHourInWindow(23, 22, 6), true);
    assert.equal(isHourInWindow(4, 22, 6), true);
    assert.equal(isHourInWindow(12, 22, 6), false);

    const mower = context({ mode: { value: 'charge' } });
    const result = resolvePollingInterval({
        contexts: [mower],
        config: { ...config, nightPollingEnabled: true },
        now: 1000,
        localDate: new Date(2026, 6, 16, 23, 0, 0),
    });
    assert.deepEqual(result, { seconds: 300, reason: 'night' });
});
