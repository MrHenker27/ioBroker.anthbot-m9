'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    clearTrackHistory,
    currentMowingTaskId,
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
