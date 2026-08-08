'use strict';

function readPathId(buffer, offset) {
    return buffer.readBigUInt64LE(offset).toString();
}

/** Decode the Genie/MGS historical path formats used by app path downloads. */
function decodeHistoryPath(buffer) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('History path decoder expects a Buffer');
    if (buffer.length < 2) throw new Error(`History path is too small: ${buffer.length} bytes`);

    const headerLength = buffer.readUInt8(0);
    const protocolVersion = buffer.readUInt8(1);
    if (protocolVersion === 0) {
        return { format: 'mgs-v0', protocolVersion, headerLength, pointCount: 0, points: [] };
    }
    if (![1, 2, 3].includes(protocolVersion)) {
        throw new Error(`Unsupported MGS history path protocol ${protocolVersion}`);
    }

    let format = `mgs-v${protocolVersion}`;
    let pointLength;
    let taskType;
    let angle;
    let declaredSize;
    let start;
    let pathId;
    let coordinateScale = 10;

    if (protocolVersion === 1) {
        if (headerLength < 21 || buffer.length < headerLength) throw new Error('Invalid MGS v1 history header');
        const shiftedPointLength = buffer.length > 3 ? buffer.readUInt8(3) : 0;
        const shiftedDeclaredSize = buffer.length >= 8 ? buffer.readInt32LE(4) : -1;
        const shiftedAvailable = shiftedPointLength > 0
            ? Math.floor((buffer.length - headerLength) / shiftedPointLength)
            : -1;
        if (headerLength >= 22 && shiftedPointLength >= 5 && shiftedDeclaredSize >= 0 && shiftedDeclaredSize <= shiftedAvailable && buffer.length >= 22) {
            pointLength = shiftedPointLength;
            taskType = buffer.readUInt8(2);
            declaredSize = shiftedDeclaredSize;
            start = buffer.readInt32LE(8);
            angle = buffer.readInt16LE(12);
            pathId = readPathId(buffer, 14);
            coordinateScale = 1;
            format = 'mgs-v1-history';
        } else {
            pointLength = buffer.readUInt8(2);
            taskType = -1;
            angle = buffer.readInt16LE(3);
            declaredSize = buffer.readInt32LE(5);
            start = buffer.readInt32LE(9);
            pathId = readPathId(buffer, 13);
        }
    } else {
        if (headerLength < 22 || buffer.length < headerLength) throw new Error(`Invalid MGS v${protocolVersion} history header`);
        pointLength = buffer.readUInt8(2);
        taskType = buffer.readUInt8(3);
        angle = buffer.readInt16LE(4);
        declaredSize = buffer.readInt32LE(6);
        start = buffer.readInt32LE(10);
        pathId = readPathId(buffer, 14);
    }

    const minimumPointLength = protocolVersion === 3 ? 6 : 5;
    if (pointLength < minimumPointLength || declaredSize < 0) {
        throw new Error(`Invalid MGS history point layout: pointLength=${pointLength}, size=${declaredSize}`);
    }

    const available = Math.floor((buffer.length - headerLength) / pointLength);
    const pointCount = Math.min(declaredSize, available);
    const points = [];
    for (let index = 0; index < pointCount; index++) {
        const offset = headerLength + index * pointLength;
        const x = buffer.readInt16LE(offset) * coordinateScale;
        const y = buffer.readInt16LE(offset + 2) * coordinateScale;
        const point = {
            x,
            y,
            xMetres: x / 1000,
            yMetres: y / 1000,
            angle,
            type: buffer.readUInt8(offset + 4),
        };
        if (protocolVersion === 3) point.cleanTime = buffer.readUInt8(offset + 5);
        points.push(point);
    }

    return { format, protocolVersion, headerLength, pointLength, taskType, angle, declaredSize, start, pathId, coordinateScale, pointCount: points.length, points };
}

const HISTORY_URL_KEYS = new Set([
    'hisPathUrl', 'his_path_url', 'recordPathUrl', 'record_path_url',
    'historyPathUrl', 'history_path_url', 'pathUrl', 'path_url',
]);
const HISTORY_INFO_KEYS = new Set(['history_path_info', 'historyPathInfo', 'hisPathUrl', 'recordPathUrl', 'cleanedCode', 'CleanedCode', 'cleanCode']);

function walkHistoryUrl(value, insideHistoryInfo = false) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = walkHistoryUrl(item, insideHistoryInfo);
            if (found) return found;
        }
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    for (const [key, item] of Object.entries(value)) {
        if (HISTORY_URL_KEYS.has(key) && typeof item === 'string' && /^https?:\/\//i.test(item)) return item;
        if (HISTORY_INFO_KEYS.has(key)) {
            const found = walkHistoryUrl(item, true);
            if (found) return found;
        }
    }
    if (insideHistoryInfo) {
        for (const item of Object.values(value)) {
            if (typeof item === 'string' && /^https?:\/\//i.test(item) && /(path|history|record)/i.test(item)) return item;
            const found = walkHistoryUrl(item, true);
            if (found) return found;
        }
    }
    return null;
}

function findHistoryPathUrl(...values) {
    for (const value of values) {
        const found = walkHistoryUrl(value);
        if (found) return found;
    }
    return null;
}

module.exports = { decodeHistoryPath, findHistoryPathUrl };
