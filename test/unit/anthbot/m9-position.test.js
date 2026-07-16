'use strict';

const assert = require('node:assert/strict');
const { selectM9Position } = require('../../../lib/anthbot/m9-position');

function buildCurpathBase64(time) {
    const buffer = Buffer.alloc(22 + 12);
    buffer.writeUInt8(22, 0);
    buffer.writeUInt32LE(2, 6);
    buffer.writeInt16LE(100, 22);
    buffer.writeInt16LE(200, 24);
    buffer.writeUInt16LE(257, 26);
    buffer.writeInt16LE(150, 28);
    buffer.writeInt16LE(200, 30);
    buffer.writeUInt16LE(257, 32);
    return { time, value: buffer.toString('base64') };
}

describe('M9 position selection', () => {
    it('uses fresh curpath while mowing', () => {
        const now = 1_000_000;
        const result = selectM9Position(
            {
                curpath: buildCurpathBase64(now - 10_000),
                anti_loss_pose: { pose2d: { x: 99, y: 99 } },
            },
            'mowing',
            now,
        );
        assert.equal(result.source, 'curpath-live');
        assert.equal(result.pose.x, 1.5);
        assert.equal(result.pose.y, 2);
    });

    it('uses property pose when stationary', () => {
        const now = 1_000_000;
        const result = selectM9Position(
            {
                curpath: buildCurpathBase64(now - 10_000),
                anti_loss_pose: { pose2d: { x: 3, y: 4 } },
            },
            'charging',
            now,
        );
        assert.equal(result.source, 'property-pose');
        assert.deepEqual(result.pose, { x: 3, y: 4 });
    });

    it('does not call a stale path live while active', () => {
        const now = 1_000_000;
        const result = selectM9Position(
            {
                curpath: buildCurpathBase64(now - 500_000),
                anti_loss_pose: { pose2d: { x: 3, y: 4 } },
            },
            'mowing',
            now,
        );
        assert.equal(result.source, 'property-pose-active-fallback');
    });
});
