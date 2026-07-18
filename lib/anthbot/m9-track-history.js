'use strict';

const { createHash } = require('node:crypto');

const DEFAULT_MAX_TRACK_POINTS = 50000;

const MODE_TASK_KEYS = {
    bordermowing: 'mow_border',
    border_mowing: 'mow_border',
    fullmowing: 'mow_full',
    globalmowing: 'mow_full',
    global_mowing: 'mow_full',
    nestmowing: 'mow_nest',
    near_charger_mowing: 'mow_nest',
    pointmowing: 'mow_point',
    point_mowing: 'mow_point',
    regionmowing: 'mow_region',
    region_mowing: 'mow_region',
    remotemowing: 'mow_remote',
    remote_control: 'mow_remote',
    zonemowing: 'mow_zone',
    zone_mowing: 'mow_zone',
};

function pointKey(point) {
    return `${point.x}:${point.y}`;
}

function packetSignature(path) {
    const hash = createHash('sha1');
    hash.update(String(path?.header?.pathId || ''));
    for (const point of path?.points || []) {
        hash.update(`|${point?.x ?? ''}:${point?.y ?? ''}:${point?.xMetres ?? ''}:${point?.yMetres ?? ''}`);
    }
    return hash.digest('hex');
}

function positivePathId(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(Math.trunc(number)) : null;
}

/**
 * Resolves the long-lived mowing-task id from the property shadow.
 *
 * The id inside the small `curpath` packet is a packet/path fragment id and
 * must not be used to reset the whole rendered track. The task ids below stay
 * stable for the complete mowing operation and change when a new operation is
 * started.
 *
 * @param {object|null|undefined} data
 * @returns {string|null}
 */
function currentMowingTaskId(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const task = data.mow_task && typeof data.mow_task === 'object'
        ? data.mow_task
        : {};
    const mode = String(data?.mode?.value || data?.mode || '').trim().toLowerCase();
    const preferredKey = MODE_TASK_KEYS[mode];

    if (preferredKey) {
        const pathId = positivePathId(task?.[preferredKey]?.path_id);
        if (pathId) {
            return `${preferredKey}:${pathId}`;
        }
    }

    // When the firmware reports an active state, prefer that task even if the
    // mode label is new or unknown to this adapter version.
    for (const key of [
        'mow_border',
        'mow_full',
        'mow_nest',
        'mow_point',
        'mow_region',
        'mow_remote',
        'mow_zone',
    ]) {
        const entry = task?.[key];
        const state = Number(entry?.state);
        const pathId = positivePathId(entry?.path_id);
        if (pathId && Number.isFinite(state) && state !== 0) {
            return `${key}:${pathId}`;
        }
    }

    return null;
}

/**
 * Appends every new curpath packet to the track of the current mowing task.
 * Pause, standby and charging never clear the track. It is reset only when a
 * different non-empty mowing task id is observed or by the explicit clear
 * command.
 *
 * @param {object} context
 * @param {object|null|undefined} path
 * @param {object|null|undefined} data
 * @param {number} [maximumPoints]
 */
function updateTrackHistory(
    context,
    path,
    data,
    maximumPoints = DEFAULT_MAX_TRACK_POINTS,
) {
    context.pathHistory = context.pathHistory || {
        taskId: null,
        packetPathId: null,
        lastPacketSignature: null,
        points: [],
    };

    const taskId = currentMowingTaskId(data);
    if (
        taskId &&
        context.pathHistory.taskId &&
        taskId !== context.pathHistory.taskId
    ) {
        context.pathHistory = {
            taskId,
            packetPathId: null,
            lastPacketSignature: null,
            points: [],
        };
    } else if (taskId && !context.pathHistory.taskId) {
        context.pathHistory.taskId = taskId;
    }

    if (!path || !Array.isArray(path.points) || path.points.length === 0) {
        return context.pathHistory;
    }

    const signature = packetSignature(path);
    if (context.pathHistory.lastPacketSignature === signature) {
        return context.pathHistory;
    }

    context.pathHistory.packetPathId = path?.header?.pathId || null;
    context.pathHistory.lastPacketSignature = signature;

    const target = context.pathHistory.points;
    let previousKey = target.length ? pointKey(target[target.length - 1]) : null;

    for (const point of path.points) {
        if (
            typeof point?.x !== 'number' ||
            typeof point?.y !== 'number' ||
            typeof point?.xMetres !== 'number' ||
            typeof point?.yMetres !== 'number'
        ) {
            continue;
        }

        const key = pointKey(point);
        if (key === previousKey) {
            continue;
        }

        target.push({ ...point });
        previousKey = key;
    }

    if (target.length > maximumPoints) {
        target.splice(0, target.length - maximumPoints);
    }

    return context.pathHistory;
}

function clearTrackHistory(context) {
    context.pathHistory = {
        taskId: null,
        packetPathId: null,
        lastPacketSignature: null,
        points: [],
    };
    return context.pathHistory;
}

module.exports = {
    DEFAULT_MAX_TRACK_POINTS,
    clearTrackHistory,
    currentMowingTaskId,
    updateTrackHistory,
};
