'use strict';

/**
 * Decodes the Anthbot M9 curpath Base64 payload.
 *
 * Coordinates are stored in centimetres.
 *
 * @param {string} base64
 * @returns {{
 *   headerLength: number,
 *   declaredPointCount: number,
 *   points: Array<{
 *     x: number,
 *     y: number,
 *     xMetres: number,
 *     yMetres: number,
 *     meta: number
 *   }>,
 *   lastPoint: object|null
 * }}
 */
function decodeCurpath(base64) {
    if (typeof base64 !== 'string' || !base64) {
        return {
            headerLength: 0,
            declaredPointCount: 0,
            points: [],
            lastPoint: null,
        };
    }

    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length < 22) {
        throw new Error(`Curpath payload is too small: ${buffer.length} bytes`);
    }

    const headerLength = buffer.readUInt8(0);
    const declaredPointCount = buffer.readUInt32LE(6);

    if (headerLength < 1 || headerLength > buffer.length) {
        throw new Error(`Invalid curpath header length: ${headerLength}`);
    }

    const points = [];

    for (
        let offset = headerLength;
        offset + 5 < buffer.length;
        offset += 6
    ) {
        const x = buffer.readInt16LE(offset);
        const y = buffer.readInt16LE(offset + 2);
        const meta = buffer.readUInt16LE(offset + 4);

        points.push({
            x,
            y,
            xMetres: x / 100,
            yMetres: y / 100,
            meta,
        });
    }

    return {
        headerLength,
        declaredPointCount,
        points,
        lastPoint: points.length > 0 ? points[points.length - 1] : null,
    };
}

module.exports = {
    decodeCurpath,
};
