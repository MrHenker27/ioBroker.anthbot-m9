'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { dockPose, selectM9Position } = require('../../../lib/anthbot/m9-position');

test('official MGS map origin is the fixed dock coordinate', () => {
    assert.deepEqual(dockPose(), { x: 0, y: 0, yaw: 0 });
});

test('charging places Kevin on the fixed map origin', () => {
    const result = selectM9Position(
        {
            mode: { value: 'charge' },
            region_area: { points: [[5491, -4592]] },
        },
        'charging',
        Date.now(),
    );

    assert.equal(result.source, 'dock-position-charging');
    assert.deepEqual(result.pose, { x: 0, y: 0, yaw: 0 });
    assert.deepEqual(result.dockPose, { x: 0, y: 0, yaw: 0 });
});
