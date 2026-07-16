'use strict';

const assert = require('node:assert/strict');
const {
    evaluateMapHealth,
    evaluatePathHealth,
} = require('../../../lib/anthbot/m9-map-health');

describe('M9 map health', () => {
    it('marks a recent valid path as fresh', () => {
        const now = 1_000_000;
        const result = evaluatePathHealth(
            { curpath: { time: now - 30_000 } },
            { points: [{ xMetres: 1, yMetres: 2 }], lastPoint: { xMetres: 1, yMetres: 2 } },
            now,
        );
        assert.equal(result.usable, true);
        assert.equal(result.fresh, true);
        assert.equal(result.reason, 'fresh');
    });

    it('marks an old path as stale', () => {
        const now = 1_000_000;
        const result = evaluatePathHealth(
            { curpath: { time: now - 500_000 } },
            { points: [{ xMetres: 1, yMetres: 2 }], lastPoint: { xMetres: 1, yMetres: 2 } },
            now,
        );
        assert.equal(result.usable, true);
        assert.equal(result.fresh, false);
        assert.equal(result.reason, 'stale');
    });

    it('reports valid map contours', () => {
        const result = evaluateMapHealth({
            mapInfo: { mapId: '42' },
            contours: [
                { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
                { points: [] },
            ],
        });
        assert.equal(result.available, true);
        assert.equal(result.contourCount, 2);
        assert.equal(result.validContourCount, 1);
        assert.equal(result.mapId, '42');
    });
});
