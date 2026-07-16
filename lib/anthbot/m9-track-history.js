'use strict';

const DEFAULT_MAX_TRACK_POINTS = 2000;

function pointKey(point) {
    return `${point.x}:${point.y}`;
}

function updateTrackHistory(context, path, maximumPoints = DEFAULT_MAX_TRACK_POINTS) {
    context.pathHistory = context.pathHistory || { pathId: null, points: [] };
    if (!path || !Array.isArray(path.points) || path.points.length === 0) {
        return context.pathHistory;
    }

    const pathId = path?.header?.pathId || null;
    if (pathId && context.pathHistory.pathId && pathId !== context.pathHistory.pathId) {
        context.pathHistory = { pathId, points: [] };
    } else if (pathId && !context.pathHistory.pathId) {
        context.pathHistory.pathId = pathId;
    }

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
        if (key === previousKey) continue;
        target.push({ ...point });
        previousKey = key;
    }

    if (target.length > maximumPoints) {
        target.splice(0, target.length - maximumPoints);
    }
    return context.pathHistory;
}

function clearTrackHistory(context) {
    context.pathHistory = { pathId: null, points: [] };
    return context.pathHistory;
}

module.exports = {
    DEFAULT_MAX_TRACK_POINTS,
    clearTrackHistory,
    updateTrackHistory,
};
