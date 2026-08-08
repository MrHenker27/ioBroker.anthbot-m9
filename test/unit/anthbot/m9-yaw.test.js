'use strict';
const assert = require('node:assert/strict');
const { propertyPose, yawMilliRadiansToDegrees } = require('../../../lib/anthbot/m9-position');

describe('M9 pose yaw', () => {
    it('converts firmware milliradians to SVG degrees', () => {
        assert.ok(Math.abs(yawMilliRadiansToDegrees(Math.PI * 1000) - 180) < 1e-9);
        const pose = propertyPose({ pose: { x: 1, y: 2, yaw: Math.PI * 500 } });
        assert.ok(Math.abs(pose.yaw - 90) < 1e-9);
    });
});
