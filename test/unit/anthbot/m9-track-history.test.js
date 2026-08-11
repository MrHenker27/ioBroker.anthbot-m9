'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    clearTrackHistory,
    collapseAdjacentReplaySequences,
    currentMowingTaskId,
    findOverlapLength,
    findReplayPrefixLength,
    findReplaySkipLength,
    removeEmbeddedKnownReplaySequences,
    updateTrackHistory,
} = require('../../../lib/anthbot/m9-track-history');

function packet(pathId, startX) {
    return {
        header: { pathId },
        points: [
            { x: startX, y: 0, xMetres: startX / 100, yMetres: 0 },
            { x: startX + 10, y: 0, xMetres: (startX + 10) / 100, yMetres: 0 },
        ],
    };
}

test('resolves the stable task id for region mowing', () => {
    const data = {
        mode: { value: 'regionmowing' },
        mow_task: { mow_region: { path_id: 1234, state: 1 } },
    };

    assert.equal(currentMowingTaskId(data), 'mow_region:1234');
});

test('keeps all packets of the same mowing task even when packet ids change', () => {
    const context = {};
    const data = {
        mode: { value: 'regionmowing' },
        mow_task: { mow_region: { path_id: 1234, state: 1 } },
    };

    updateTrackHistory(context, packet('packet-a', 0), data);
    updateTrackHistory(context, packet('packet-b', 20), data);

    assert.equal(context.pathHistory.taskId, 'mow_region:1234');
    assert.equal(context.pathHistory.packetPathId, 'packet-b');
    assert.deepEqual(
        context.pathHistory.points.map(point => point.x),
        [0, 10, 20, 30],
    );
});


test('ignores an identical curpath packet received repeatedly', () => {
    const context = {};
    const data = {
        mode: { value: 'regionmowing' },
        mow_task: { mow_region: { path_id: 1234, state: 1 } },
    };
    const repeatedPacket = packet('packet-a', 0);

    updateTrackHistory(context, repeatedPacket, data);
    updateTrackHistory(context, repeatedPacket, data);
    updateTrackHistory(context, repeatedPacket, data);

    assert.deepEqual(context.pathHistory.points.map(point => point.x), [0, 10]);
});

test('keeps the task track through standby and resets only for a new task id', () => {
    const context = {};
    const firstTask = {
        mode: { value: 'regionmowing' },
        mow_task: { mow_region: { path_id: 1234, state: 1 } },
    };
    const standby = {
        mode: { value: 'standby' },
        mow_task: { mow_region: { path_id: 1234, state: 0 } },
    };
    const secondTask = {
        mode: { value: 'regionmowing' },
        mow_task: { mow_region: { path_id: 5678, state: 1 } },
    };

    updateTrackHistory(context, packet('packet-a', 0), firstTask);
    updateTrackHistory(context, null, standby);
    assert.equal(context.pathHistory.points.length, 2);

    updateTrackHistory(context, packet('packet-c', 100), secondTask);
    assert.equal(context.pathHistory.taskId, 'mow_region:5678');
    assert.deepEqual(context.pathHistory.points.map(point => point.x), [100, 110]);
});

test('clear command removes task id and all points', () => {
    const context = {
        pathHistory: {
            taskId: 'mow_region:1234',
            packetPathId: 'packet-a',
            points: [{ x: 1, y: 2 }],
        },
    };

    clearTrackHistory(context);
    assert.deepEqual(context.pathHistory, {
        taskId: null,
        packetPathId: null,
        lastPacketSignature: null,
        points: [],
    });
});


test('detects the largest suffix/prefix overlap between curpath fragments', () => {
    const existing = [0, 10, 20, 30].map((x, index) => ({ x, y: 0, index }));
    const incoming = [20, 30, 40, 50].map((x, index) => ({ x, y: 0, index }));

    assert.equal(findOverlapLength(existing, incoming), 2);
});

test('appends only the non-overlapping tail of a curpath fragment', () => {
    const context = {};
    const data = {
        mode: { value: 'zonemowing' },
        mow_task: { mow_zone: { path_id: 4321, state: 1 } },
    };
    const first = {
        header: { pathId: 'fragment-a' },
        points: [0, 10, 20, 30].map((x, index) => ({
            index,
            x,
            y: 0,
            xMetres: x / 100,
            yMetres: 0,
        })),
    };
    const second = {
        header: { pathId: 'fragment-b' },
        points: [20, 30, 40, 50].map((x, index) => ({
            index,
            x,
            y: 0,
            xMetres: x / 100,
            yMetres: 0,
        })),
    };

    updateTrackHistory(context, first, data);
    updateTrackHistory(context, second, data);

    assert.deepEqual(context.pathHistory.points.map(point => point.x), [0, 10, 20, 30, 40, 50]);
    assert.deepEqual(context.pathHistory.points.map(point => point.index), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(context.pathHistory.points.map(point => point.packetIndex), [0, 1, 2, 3, 2, 3]);
});


test('detects a replayed packet prefix anywhere in the existing track', () => {
    const existing = [10, 20, 30, 40, 50, 60, 70].map((x, index) => ({ x, y: 0, index }));
    const incoming = [30, 40, 50, 80, 90].map((x, index) => ({ x, y: 0, index }));

    assert.equal(findReplayPrefixLength(existing, incoming), 3);
});

test('drops a fully replayed point sequence that is already inside the track', () => {
    const context = {};
    const data = {
        mode: { value: 'zonemowing' },
        mow_task: { mow_zone: { path_id: 4321, state: 1 } },
    };
    const makePath = (pathId, values) => ({
        header: { pathId },
        points: values.map((x, index) => ({
            index, x, y: x + 1, xMetres: x / 100, yMetres: (x + 1) / 100,
        })),
    });

    updateTrackHistory(context, makePath('a', [0, 1, 2, 3, 4, 5, 6]), data);
    updateTrackHistory(context, makePath('b', [2, 3, 4]), data);

    assert.deepEqual(context.pathHistory.points.map(point => point.x), [0, 1, 2, 3, 4, 5, 6]);
});

test('appends only the new tail after a replayed prefix found inside the track', () => {
    const context = {};
    const data = {
        mode: { value: 'zonemowing' },
        mow_task: { mow_zone: { path_id: 4321, state: 1 } },
    };
    const makePath = (pathId, values) => ({
        header: { pathId },
        points: values.map((x, index) => ({
            index, x, y: x + 1, xMetres: x / 100, yMetres: (x + 1) / 100,
        })),
    });

    updateTrackHistory(context, makePath('a', [0, 1, 2, 3, 4, 5, 6]), data);
    updateTrackHistory(context, makePath('b', [2, 3, 4, 7, 8]), data);

    assert.deepEqual(context.pathHistory.points.map(point => point.x), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(context.pathHistory.points.map(point => point.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(context.pathHistory.points.slice(-2).map(point => point.packetIndex), [3, 4]);
});

test('does not treat a one- or two-point revisit as replay', () => {
    const existing = [10, 20, 30, 40].map((x, index) => ({ x, y: 0, index }));
    const incoming = [20, 30, 99].map((x, index) => ({ x, y: index === 2 ? 1 : 0, index }));

    assert.equal(findReplayPrefixLength(existing, incoming), 0);
});


test('collapses an adjacent internal replay sequence of three points', () => {
    const values = [
        [-86, 73], [-81, 73],
        [-85, 73], [-86, 73], [-87, 73],
        [-85, 73], [-86, 73], [-87, 73],
        [-87, 74], [-88, 74],
    ];
    const points = values.map(([x, y], index) => ({
        index, x, y, xMetres: x / 100, yMetres: y / 100,
    }));

    const collapsed = collapseAdjacentReplaySequences(points);
    assert.deepEqual(
        collapsed.map(point => [point.x, point.y]),
        [
            [-86, 73], [-81, 73],
            [-85, 73], [-86, 73], [-87, 73],
            [-87, 74], [-88, 74],
        ],
    );
});

test('updateTrackHistory removes an internal tandem replay but keeps later divergent revisit', () => {
    const context = {};
    const data = {
        mode: { value: 'zonemowing' },
        mow_task: { mow_zone: { path_id: 4321, state: 1 } },
    };
    const values = [
        [-86, 73], [-81, 73],
        [-85, 73], [-86, 73], [-87, 73],
        [-85, 73], [-86, 73], [-87, 73],
        [-87, 74], [-88, 74],
        [-85, 73], [-88, 84], [-88, 96],
    ];
    const path = {
        header: { pathId: 'fragment-internal-replay' },
        points: values.map(([x, y], index) => ({
            index, x, y, xMetres: x / 100, yMetres: y / 100,
        })),
    };

    updateTrackHistory(context, path, data);

    assert.deepEqual(
        context.pathHistory.points.map(point => [point.x, point.y]),
        [
            [-86, 73], [-81, 73],
            [-85, 73], [-86, 73], [-87, 73],
            [-87, 74], [-88, 74],
            [-85, 73], [-88, 84], [-88, 96],
        ],
    );
    assert.deepEqual(
        context.pathHistory.points.map(point => point.index),
        [0,1,2,3,4,5,6,7,8,9],
    );
});

test('does not collapse separated equal sequences that are not adjacent', () => {
    const values = [1,2,3,9,1,2,3].map((x, index) => ({
        index, x, y: 0, xMetres: x / 100, yMetres: 0,
    }));
    const collapsed = collapseAdjacentReplaySequences(values);
    assert.equal(collapsed.length, values.length);
});


test('iteratively consumes a short overlap followed by multiple replay blocks', () => {
    const existing = [1,2,3,4,5,6,7,8].map((x, index) => ({ x, y: 0, index }));
    const incoming = [7,8,3,4,5,6,7,8,9,10].map((x, index) => ({ x, y: 0, index }));

    assert.equal(findReplaySkipLength(existing, incoming), 8);
});

test('live replay pattern keeps only the genuinely new packet tail', () => {
    const context = {};
    const data = {
        mode: { value: 'zonemowing' },
        mow_task: { mow_zone: { path_id: 4321, state: 1 } },
    };
    const makePoint = (x, y, index) => ({
        index, x, y, xMetres: x / 100, yMetres: y / 100, metadata: 258, type: 2, flags: 1,
    });

    updateTrackHistory(context, {
        header: { pathId: 'a' },
        points: [
            makePoint(-117,569,0), makePoint(-120,582,1), makePoint(-125,592,2),
            makePoint(-130,602,3), makePoint(-136,611,4),
            makePoint(-143,620,5), makePoint(-142,619,6), makePoint(-139,618,7), makePoint(-136,614,8),
        ],
    }, data);

    updateTrackHistory(context, {
        header: { pathId: 'b' },
        points: [
            makePoint(-136,611,0),
            makePoint(-143,620,1), makePoint(-142,619,2), makePoint(-139,618,3), makePoint(-136,614,4),
            makePoint(-143,620,5), makePoint(-142,619,6), makePoint(-139,618,7), makePoint(-136,614,8),
            makePoint(-136,612,9), makePoint(-137,602,10),
        ],
    }, data);

    const coords = context.pathHistory.points.map(point => [point.x, point.y]);
    const repeated = coords.filter((point, index) => index > 0 && point[0] === coords[index - 1][0] && point[1] === coords[index - 1][1]);
    assert.deepEqual(repeated, []);
    assert.deepEqual(coords.slice(-3), [[-136,614],[-136,612],[-137,602]]);
    assert.equal(coords.filter(([x,y]) => x === -143 && y === 620).length, 1);
});


test('removes an embedded known replay after packet index resets inside incoming packet', () => {
    const existing = [
        [-27,571],[-41,570],[-52,571],[-63,571],[-78,571],[-89,571],[-101,571],[-114,572],
    ].map(([x,y], index) => ({ index: index + 4, x, y, xMetres:x/100, yMetres:y/100 }));
    const incoming = [
        { index: 9, x:-120, y:580, xMetres:-1.20, yMetres:5.80 },
        { index: 10, x:-121, y:579, xMetres:-1.21, yMetres:5.79 },
        ...existing.map((p,index) => ({...p, index:index+1})),
        { index: 9, x:-125, y:560, xMetres:-1.25, yMetres:5.60 },
    ];
    // Force the replay to begin after a packet-index reset (10 -> 1).
    const filtered = removeEmbeddedKnownReplaySequences(existing, incoming);
    assert.deepEqual(filtered.map(p => [p.x,p.y]), [[-120,580],[-121,579],[-125,560]]);
});

test('keeps divergent movement after packet index reset when it is not a known replay', () => {
    const existing = [1,2,3,4].map((x,index) => ({index,x,y:0,xMetres:x/100,yMetres:0}));
    const incoming = [
        {index:9,x:9,y:0,xMetres:.09,yMetres:0},
        {index:1,x:1,y:0,xMetres:.01,yMetres:0},
        {index:2,x:7,y:0,xMetres:.07,yMetres:0},
        {index:3,x:8,y:0,xMetres:.08,yMetres:0},
    ];
    const filtered = removeEmbeddedKnownReplaySequences(existing,incoming);
    assert.deepEqual(filtered.map(p=>p.x), [9,1,7,8]);
});


test('collapses the observed adjacent replay sequence across a curpath packet boundary', () => {
    const context = {};
    const data = {
        mode: { value: 'zonemowing' },
        mow_task: { mow_zone: { path_id: 1786468858618, state: 1 } },
    };
    const makePoint = (x, y, index) => ({
        index,
        x,
        y,
        xMetres: x / 100,
        yMetres: y / 100,
        metadata: 257,
        type: 1,
        flags: 1,
    });

    // Real live sequence observed on 2026-08-11. The first packet ends with
    // A-B-C-D and the next packet repeats A-B-C-D verbatim before continuing.
    const replay = [
        [-74, 221],
        [-73, 218],
        [-73, 219],
        [-73, 218],
    ];

    updateTrackHistory(context, {
        header: { pathId: 'packet-a' },
        points: [
            makePoint(-80, 250, 0),
            makePoint(-78, 238, 1),
            ...replay.map(([x, y], index) => makePoint(x, y, index + 2)),
        ],
    }, data);

    updateTrackHistory(context, {
        header: { pathId: 'packet-b' },
        points: [
            ...replay.map(([x, y], index) => makePoint(x, y, index)),
            makePoint(-72, 230, 4),
            makePoint(-71, 242, 5),
        ],
    }, data);

    const points = context.pathHistory.points;
    const coords = points.map(point => [point.x, point.y]);

    assert.deepEqual(coords, [
        [-80, 250],
        [-78, 238],
        ...replay,
        [-72, 230],
        [-71, 242],
    ]);
    assert.deepEqual(points.map(point => point.index), points.map((_, index) => index));
});
