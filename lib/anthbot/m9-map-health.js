'use strict';

const DEFAULT_PATH_MAX_AGE_MS = 120000;

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function asTimestamp(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * @param {number|null} timestamp
 * @param {number} now
 * @returns {number|null}
 */
function ageMs(timestamp, now = Date.now()) {
    return timestamp == null ? null : Math.max(0, now - timestamp);
}

/**
 * @param {{lastPoint?: object|null, points?: object[]}|null|undefined} path
 * @returns {boolean}
 */
function hasUsablePath(path) {
    return Boolean(
        path &&
        path.lastPoint &&
        typeof path.lastPoint.xMetres === 'number' &&
        typeof path.lastPoint.yMetres === 'number' &&
        Array.isArray(path.points) &&
        path.points.length > 0,
    );
}

/**
 * @param {object} data
 * @param {{lastPoint?: object|null, points?: object[]}|null|undefined} path
 * @param {number} [now]
 * @param {number} [maxAgeMs]
 */
function evaluatePathHealth(data, path, now = Date.now(), maxAgeMs = DEFAULT_PATH_MAX_AGE_MS) {
    const timestamp = asTimestamp(data?.curpath?.time);
    const currentAgeMs = ageMs(timestamp, now);
    const usable = hasUsablePath(path);
    const fresh = usable && currentAgeMs != null && currentAgeMs <= maxAgeMs;

    return {
        timestamp,
        ageMs: currentAgeMs,
        usable,
        fresh,
        pointCount: Array.isArray(path?.points) ? path.points.length : 0,
        reason: !usable
            ? 'missing-or-invalid'
            : timestamp == null
              ? 'missing-timestamp'
              : fresh
                ? 'fresh'
                : 'stale',
    };
}

/**
 * @param {object|null|undefined} mapData
 */
function evaluateMapHealth(mapData) {
    const contours = Array.isArray(mapData?.contours) ? mapData.contours : [];
    const validContours = contours.filter(
        contour => Array.isArray(contour?.points) && contour.points.length >= 3,
    );

    return {
        available: validContours.length > 0,
        contourCount: contours.length,
        validContourCount: validContours.length,
        fileSize: Number.isFinite(mapData?.fileSize) ? mapData.fileSize : null,
        bytesRead: Number.isFinite(mapData?.bytesRead) ? mapData.bytesRead : null,
        mapId: typeof mapData?.mapInfo?.mapId === 'string' ? mapData.mapInfo.mapId : '',
    };
}

module.exports = {
    DEFAULT_PATH_MAX_AGE_MS,
    ageMs,
    asTimestamp,
    evaluateMapHealth,
    evaluatePathHealth,
    hasUsablePath,
};
