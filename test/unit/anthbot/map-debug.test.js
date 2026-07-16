'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mapDebugInfo } = require('../../../lib/anthbot/map-debug');
const { asDebugRows } = require('../../../lib/anthbot/m9-svg');

test('mapDebugInfo summarizes map and position data', () => {
    const info = mapDebugInfo({
        mapData: {
            mapInfo: { mapId: '42', width: 10, height: 20, resolution: 0.05 },
            contours: [{ points: [] }, { points: [] }],
        },
        areaDefinition: { areas: [] },
        position: {
            source: 'curpath',
            pose: { x: 1.5, y: -2.25, yaw: 90 },
            path: { points: [{}, {}] },
            pathHealth: { fresh: true, reason: 'fresh' },
        },
        dockPose: { x: 0, y: 0 },
        mowerStatus: 'mowing',
        activeZoneIds: [1, 3],
    });

    assert.equal(info.positionSource, 'curpath');
    assert.equal(info.pathPointCount, 2);
    assert.equal(info.contourCount, 2);
    assert.deepEqual(info.activeZoneIds, [1, 3]);
    assert.ok(asDebugRows(info).some(row => row.includes('Quelle: curpath')));
});
