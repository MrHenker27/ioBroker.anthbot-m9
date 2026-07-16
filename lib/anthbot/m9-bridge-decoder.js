'use strict';

/**
 * Decodes ANTHBOT M9 `iot_bridge.bin`.
 *
 * Format verified against a real M9 bridge file:
 *
 * Header (15 bytes):
 *   uint8   headerLength
 *   uint8   version
 *   uint8   bridgeCount
 *   uint32  payloadLengthOrRevision
 *   int64   mapId
 *
 * Each bridge record:
 *   uint8   type
 *   uint32  pointCount
 *   repeated pointCount times:
 *     int32 x  (millimetres)
 *     int32 y  (millimetres)
 *
 * @param {Buffer} buffer
 * @returns {{
 *   headerLength:number,
 *   version:number,
 *   bridgeCount:number,
 *   headerValue:number,
 *   mapId:string,
 *   records:Array<{
 *     index:number,
 *     type:number,
 *     pointCount:number,
 *     points:Array<{x:number,y:number}>
 *   }>,
 *   bytesRead:number,
 *   fileSize:number
 * }}
 */
function decodeM9Bridge(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('M9 bridge decoder expects a Buffer');
    }
    if (buffer.length < 15) {
        throw new Error(`M9 bridge file is too small: ${buffer.length} bytes`);
    }

    const headerLength = buffer.readUInt8(0);
    const version = buffer.readUInt8(1);
    const bridgeCount = buffer.readUInt8(2);
    const headerValue = buffer.readUInt32LE(3);
    const mapId = buffer.readBigInt64LE(7).toString();

    if (headerLength < 15 || headerLength > buffer.length) {
        throw new Error(
            `Invalid M9 bridge header length ${headerLength} for file size ${buffer.length}`,
        );
    }

    let offset = headerLength;
    const records = [];

    for (let index = 0; index < bridgeCount; index++) {
        if (offset + 5 > buffer.length) {
            throw new Error(`Unexpected end of bridge file before record ${index}`);
        }

        const type = buffer.readUInt8(offset);
        const pointCount = buffer.readUInt32LE(offset + 1);
        offset += 5;

        const requiredBytes = pointCount * 8;
        if (offset + requiredBytes > buffer.length) {
            throw new Error(
                `Unexpected end of bridge file in record ${index}: ` +
                `${pointCount} points require ${requiredBytes} bytes`,
            );
        }

        const points = [];
        for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
            const x = buffer.readInt32LE(offset);
            const y = buffer.readInt32LE(offset + 4);
            offset += 8;
            points.push({ x, y });
        }

        records.push({
            index,
            type,
            pointCount,
            points,
        });
    }

    return {
        headerLength,
        version,
        bridgeCount,
        headerValue,
        mapId,
        records,
        bytesRead: offset,
        fileSize: buffer.length,
    };
}

module.exports = {
    decodeM9Bridge,
};
