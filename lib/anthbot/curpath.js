'use strict';

const HEADER_LENGTH_MINIMUM = 22;
const POINT_LENGTH = 6;
const CENTIMETRES_PER_METRE = 100;

function normalizeDegrees(value) {
    let result = value % 360;
    if (result < 0) result += 360;
    return result;
}

function calculateHeading(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const last = points[points.length - 1];

    for (let index = points.length - 2; index >= 0; index--) {
        const previous = points[index];
        const dx = last.x - previous.x;
        const dy = last.y - previous.y;
        if (dx !== 0 || dy !== 0) {
            // SVG symbol points upwards at 0 degrees.
            return normalizeDegrees(Math.atan2(dx, dy) * 180 / Math.PI);
        }
    }
    return null;
}

/**
 * Decodes the M9 property-shadow curpath payload.
 *
 * Observed M9 payload:
 * - byte 0: header length (22)
 * - UInt32LE at byte 6: point count
 * - points: Int16LE x, Int16LE y, UInt16LE metadata
 * - x/y are centimetres in the map coordinate system
 *
 * @param {string|null|undefined} base64
 */
function decodeCurpath(base64) {
    if (typeof base64 !== 'string' || !base64) {
        return {
            header: {},
            points: [],
            firstPoint: null,
            lastPoint: null,
            heading: null,
        };
    }

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < HEADER_LENGTH_MINIMUM) {
        throw new Error(`Curpath payload is too small: ${buffer.length} bytes`);
    }

    const headerLength = buffer.readUInt8(0);
    if (headerLength < HEADER_LENGTH_MINIMUM || headerLength > buffer.length) {
        throw new Error(`Invalid curpath header length ${headerLength}`);
    }

    const declaredPointCount = buffer.readUInt32LE(6);
    const availablePointCount = Math.floor((buffer.length - headerLength) / POINT_LENGTH);
    const pointCount = Math.min(declaredPointCount, availablePointCount);
    const points = [];

    for (let index = 0; index < pointCount; index++) {
        const offset = headerLength + index * POINT_LENGTH;
        const x = buffer.readInt16LE(offset);
        const y = buffer.readInt16LE(offset + 2);
        const metadata = buffer.readUInt16LE(offset + 4);
        points.push({
            index,
            x,
            y,
            xMetres: x / CENTIMETRES_PER_METRE,
            yMetres: y / CENTIMETRES_PER_METRE,
            metadata,
            type: metadata & 0xff,
            flags: metadata >>> 8,
        });
    }

    return {
        header: {
            headerLength,
            protocolVersion: buffer.readUInt8(1),
            taskType: buffer.readUInt8(2),
            pointLength: buffer.readUInt8(3),
            dataLength: buffer.readUInt16LE(4),
            declaredPointCount,
            startIndex: buffer.readUInt32LE(10),
            pathId: buffer.readBigUInt64LE(14).toString(),
            bufferLength: buffer.length,
        },
        points,
        firstPoint: points[0] || null,
        lastPoint: points[points.length - 1] || null,
        heading: calculateHeading(points),
    };
}

module.exports = {
    CENTIMETRES_PER_METRE,
    HEADER_LENGTH_MINIMUM,
    POINT_LENGTH,
    calculateHeading,
    decodeCurpath,
    normalizeDegrees,
};
