'use strict';

const assert = require('node:assert/strict');
const { decodeM9Map } = require('../../../lib/anthbot/m9-map-decoder');

describe('M9 binary map decoder', () => {
    it('decodes a synthetic contour', () => {
        const headerLength = 35;
        const points = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }];
        const buffer = Buffer.alloc(headerLength + 4 + points.length * 8);
        buffer.writeUInt8(headerLength, 0);
        buffer.writeUInt8(1, 2);
        let offset = 7;
        buffer.writeInt32LE(100, offset); offset += 4;
        buffer.writeInt32LE(200, offset); offset += 4;
        buffer.writeFloatLE(0.05, offset); offset += 4;
        buffer.writeFloatLE(-1, offset); offset += 4;
        buffer.writeFloatLE(-2, offset); offset += 4;
        buffer.writeBigInt64LE(42n, offset);
        offset = headerLength;
        buffer.writeInt16LE(points.length, offset); offset += 2;
        buffer.writeInt16LE(0, offset); offset += 2;
        for (const point of points) {
            buffer.writeInt32LE(point.x, offset); offset += 4;
            buffer.writeInt32LE(point.y, offset); offset += 4;
        }

        const decoded = decodeM9Map(buffer);
        assert.equal(decoded.contourCount, 1);
        assert.equal(decoded.mapInfo.mapId, '42');
        assert.deepEqual(decoded.contours[0].points, points);
    });
});
