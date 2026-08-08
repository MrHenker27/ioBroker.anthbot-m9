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



function collapseAdjacentReplaySequences(points, minimumLength = 3) {
    if (!Array.isArray(points) || points.length < minimumLength * 2) {
        return Array.isArray(points) ? points.slice() : [];
    }

    const result = points.slice();
    let changed = true;

    while (changed) {
        changed = false;

        for (let start = 0; start <= result.length - minimumLength * 2; start++) {
            const maximumLength = Math.floor((result.length - start) / 2);

            for (let length = maximumLength; length >= minimumLength; length--) {
                let matches = true;
                for (let index = 0; index < length; index++) {
                    if (pointKey(result[start + index]) !== pointKey(result[start + length + index])) {
                        matches = false;
                        break;
                    }
                }

                if (matches) {
                    result.splice(start + length, length);
                    changed = true;
                    break;
                }
            }

            if (changed) break;
        }
    }

    return result;
}

function findOverlapLength(existingPoints, incomingPoints) {
    if (!Array.isArray(existingPoints) || !Array.isArray(incomingPoints)) return 0;
    const maximum = Math.min(existingPoints.length, incomingPoints.length);

    for (let length = maximum; length > 0; length--) {
        let matches = true;
        const existingStart = existingPoints.length - length;
        for (let index = 0; index < length; index++) {
            if (pointKey(existingPoints[existingStart + index]) !== pointKey(incomingPoints[index])) {
                matches = false;
                break;
            }
        }
        if (matches) return length;
    }

    return 0;
}

function findReplayPrefixLength(existingPoints, incomingPoints, minimumLength = 3) {
    if (!Array.isArray(existingPoints) || !Array.isArray(incomingPoints)) return 0;
    if (existingPoints.length < minimumLength || incomingPoints.length < minimumLength) return 0;

    const maximum = Math.min(existingPoints.length, incomingPoints.length);
    for (let length = maximum; length >= minimumLength; length--) {
        for (let start = 0; start <= existingPoints.length - length; start++) {
            let matches = true;
            for (let index = 0; index < length; index++) {
                if (pointKey(existingPoints[start + index]) !== pointKey(incomingPoints[index])) {
                    matches = false;
                    break;
                }
            }
            if (matches) return length;
        }
    }

    return 0;
}


function findReplaySkipLength(existingPoints, incomingPoints, minimumLength = 3) {
    if (!Array.isArray(existingPoints) || !Array.isArray(incomingPoints)) return 0;

    let offset = 0;
    let firstPass = true;

    while (offset < incomingPoints.length) {
        const remaining = incomingPoints.slice(offset);
        const overlapLength = firstPass ? findOverlapLength(existingPoints, remaining) : 0;
        const replayLength = findReplayPrefixLength(existingPoints, remaining, minimumLength);
        const consumed = Math.max(overlapLength, replayLength);

        if (consumed <= 0) break;

        offset += consumed;
        firstPass = false;
    }

    return offset;
}

function removeEmbeddedKnownReplaySequences(existingPoints, incomingPoints, minimumLength = 3) {
    if (!Array.isArray(existingPoints) || !Array.isArray(incomingPoints)) return [];
    if (incomingPoints.length < minimumLength) return incomingPoints.slice();

    const result = [];
    let index = 0;

    while (index < incomingPoints.length) {
        const current = incomingPoints[index];
        const previous = index > 0 ? incomingPoints[index - 1] : null;
        const currentPacketIndex = Number(current?.index);
        const previousPacketIndex = Number(previous?.index);
        const packetIndexReset = index > 0 &&
            Number.isFinite(currentPacketIndex) &&
            Number.isFinite(previousPacketIndex) &&
            currentPacketIndex < previousPacketIndex;

        if (packetIndexReset) {
            const replayLength = findReplayPrefixLength(
                existingPoints,
                incomingPoints.slice(index),
                minimumLength,
            );
            if (replayLength >= minimumLength) {
                index += replayLength;
                continue;
            }
        }

        result.push(current);
        index++;
    }

    return result;
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
    const validIncomingPoints = collapseAdjacentReplaySequences(
        path.points.filter(point => (
            typeof point?.x === 'number' &&
            typeof point?.y === 'number' &&
            typeof point?.xMetres === 'number' &&
            typeof point?.yMetres === 'number'
        )),
    );
    // M9 can send several already-known fragments at the beginning of one
    // curpath packet before the genuinely new tail. Consume known prefix blocks
    // iteratively: the first block may be a short suffix overlap, and every block
    // may be a 3+ point replay sequence already present anywhere in the track.
    const skipLength = findReplaySkipLength(target, validIncomingPoints);
    const newTail = removeEmbeddedKnownReplaySequences(
        target,
        validIncomingPoints.slice(skipLength),
    );
    let previousKey = target.length ? pointKey(target[target.length - 1]) : null;

    for (const point of newTail) {
        const key = pointKey(point);
        if (key === previousKey) {
            continue;
        }

        target.push({
            ...point,
            packetIndex: point.index,
            index: target.length,
        });
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
    collapseAdjacentReplaySequences,
    currentMowingTaskId,
    findOverlapLength,
    findReplayPrefixLength,
    findReplaySkipLength,
    removeEmbeddedKnownReplaySequences,
    updateTrackHistory,
};
