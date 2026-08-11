'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    ACTIVE_AREA_MAX_AGE_MS,
    MAP_UNITS_PER_METRE,
    findManualZoneAtPose,
    findReportedManualZone,
    resolveCurrentManualZone,
    pointInPolygon,
} = require('../../../lib/anthbot/m9-area-geometry');

const areaDefinition = {
    custom_areas: [
        {
            id: 100,
            name: 'Zone 1',
            vertexs: [
                [-3498, -1161],
                [1438, -1161],
                [1438, 8818],
                [-3498, 8818],
            ],
        },
        {
            id: 101,
            name: 'Zone 2',
            vertexs: [
                [-15545, -230],
                [-3243, -230],
                [-3243, 9928],
                [-15545, 9928],
            ],
        },
    ],
};

test('uses 1000 area map units per metre', () => {
    assert.equal(MAP_UNITS_PER_METRE, 1000);
});

test('resolves the observed live Zone 1 position', () => {
    const zone = findManualZoneAtPose(areaDefinition, { x: -0.84, y: 3.39 }, {
        source: 'curpath-current',
        charging: false,
    });

    assert.deepEqual(zone, { id: 100, name: 'Zone 1', index: 0, kind: 'manual' });
});

test('resolves a Zone 2 position', () => {
    const zone = findManualZoneAtPose(areaDefinition, { x: -8, y: 4 }, {
        source: 'curpath-current',
        charging: false,
    });

    assert.equal(zone?.id, 101);
    assert.equal(zone?.name, 'Zone 2');
});

test('returns no zone outside all manual polygons', () => {
    assert.equal(
        findManualZoneAtPose(areaDefinition, { x: 5, y: 5 }, { source: 'curpath-current' }),
        null,
    );
});

test('treats polygon boundary points as inside', () => {
    assert.equal(
        pointInPolygon(
            { x: -3498, y: 1000 },
            [
                { x: -3498, y: -1161 },
                { x: 1438, y: -1161 },
                { x: 1438, y: 8818 },
                { x: -3498, y: 8818 },
            ],
        ),
        true,
    );
});

test('never resolves the fixed dock pose as a manual zone', () => {
    assert.equal(
        findManualZoneAtPose(areaDefinition, { x: 0, y: 0 }, {
            source: 'dock-position-charging',
            charging: true,
        }),
        null,
    );
});

test('prefers fresh mower-reported active_area over geometric fallback', () => {
    const now = 1_800_000_000_000;
    const zone = resolveCurrentManualZone(
        areaDefinition,
        { active_area: { id: [101], time: now - 30_000 } },
        { x: -0.84, y: 3.39 },
        { source: 'curpath-live', charging: false, now },
    );
    assert.equal(zone?.id, 101);
    assert.equal(zone?.name, 'Zone 2');
    assert.equal(zone?.source, 'active_area');
});

test('falls back to geometry when active_area is absent', () => {
    const zone = resolveCurrentManualZone(
        areaDefinition,
        {},
        { x: -0.84, y: 3.39 },
        { source: 'curpath-live', charging: false },
    );
    assert.equal(zone?.id, 100);
    assert.equal(zone?.source, 'geometry');
});

test('charging suppresses even a stale mower-reported active_area', () => {
    assert.equal(
        resolveCurrentManualZone(
            areaDefinition,
            { active_area: { id: [100] } },
            { x: 0, y: 0 },
            { source: 'dock-position-charging', charging: true },
        ),
        null,
    );
});

test('falls back to geometry when mower-reported active_area is stale', () => {
    const now = 1_800_000_000_000;
    const zone = resolveCurrentManualZone(
        areaDefinition,
        { active_area: { id: [101], time: now - ACTIVE_AREA_MAX_AGE_MS - 1 } },
        { x: -0.84, y: 3.39 },
        { source: 'curpath-live', charging: false, now },
    );
    assert.equal(zone?.id, 100);
    assert.equal(zone?.source, 'geometry');
});

test('rejects active_area without a timestamp', () => {
    assert.equal(
        findReportedManualZone(areaDefinition, { active_area: { id: [101] } }, { now: 1_800_000_000_000 }),
        null,
    );
});

