'use strict';

const assert = require('node:assert/strict');
const { calculateHeading, decodeCurpath } = require('../../../lib/anthbot/curpath');

describe('M9 curpath decoder', () => {
    it('decodes the observed 22-byte-header / 6-byte-point payload', () => {
        const base64 = 'FgMGEVkBDAAAACQHAABmYTRdnwEAAH3/vP8FAXf/xP8FAXb/x/8FAYH/zP8FAYr/0f8FAZP/1v8FAZ3/2f8FAaf/3P8FAbH/3/8FAb3/3/8FAcL/4f8FAdr/5/8FAQ==';
        const decoded = decodeCurpath(base64);

        assert.equal(decoded.header.headerLength, 22);
        assert.equal(decoded.header.declaredPointCount, 12);
        assert.equal(decoded.points.length, 12);
        assert.deepEqual(
            { x: decoded.firstPoint.x, y: decoded.firstPoint.y, metadata: decoded.firstPoint.metadata },
            { x: -131, y: -68, metadata: 261 },
        );
        assert.deepEqual(
            { x: decoded.lastPoint.x, y: decoded.lastPoint.y, metadata: decoded.lastPoint.metadata },
            { x: -38, y: -25, metadata: 261 },
        );
    });

    it('returns an empty path for an empty value', () => {
        const decoded = decodeCurpath('');
        assert.equal(decoded.points.length, 0);
        assert.equal(decoded.lastPoint, null);
    });

    it('calculates SVG-compatible heading from movement', () => {
        assert.equal(calculateHeading([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 90);
        assert.equal(calculateHeading([{ x: 0, y: 0 }, { x: 0, y: 10 }]), 0);
    });
});
