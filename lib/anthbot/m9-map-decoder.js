'use strict';

/**
 * Decodes the Anthbot M9 iot_map.bin format.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   headerLength:number,
 *   contourCount:number,
 *   mapInfo:{width:number,height:number,resolution:number,minX:number,minY:number,mapId:string},
 *   contours:Array<{index:number,type:number,pointCount:number,points:Array<{x:number,y:number}>}>,
 *   bytesRead:number,
 *   fileSize:number,
 *   bridgeData?: object|null
 * }}
 */
function decodeM9Map(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('M9 map decoder expects a Buffer');
    }
    if (buffer.length < 35) {
        throw new Error(`M9 map file is too small: ${buffer.length} bytes`);
    }

    const headerLength = buffer.readUInt8(0);
    const contourCount = buffer.readUInt8(2);
    let offset = 7;

    const width = buffer.readInt32LE(offset); offset += 4;
    const height = buffer.readInt32LE(offset); offset += 4;
    const resolution = buffer.readFloatLE(offset); offset += 4;
    const minX = buffer.readFloatLE(offset); offset += 4;
    const minY = buffer.readFloatLE(offset); offset += 4;
    const mapId = buffer.readBigInt64LE(offset).toString(); offset += 8;

    if (headerLength < offset || headerLength > buffer.length) {
        throw new Error(`Invalid M9 map header length ${headerLength} for file size ${buffer.length}`);
    }

    offset = headerLength;
    const contours = [];

    for (let contourIndex = 0; contourIndex < contourCount; contourIndex++) {
        if (offset + 4 > buffer.length) {
            throw new Error(`Unexpected end of M9 map before contour ${contourIndex}`);
        }

        const pointCount = buffer.readInt16LE(offset); offset += 2;
        const type = buffer.readInt16LE(offset); offset += 2;

        if (pointCount < 0) {
            throw new Error(`Invalid negative point count ${pointCount} in contour ${contourIndex}`);
        }
        if (offset + pointCount * 8 > buffer.length) {
            throw new Error(`Unexpected end of M9 map in contour ${contourIndex}`);
        }

        const points = [];
        for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
            const x = buffer.readInt32LE(offset); offset += 4;
            const y = buffer.readInt32LE(offset); offset += 4;
            points.push({ x, y });
        }

        contours.push({ index: contourIndex, type, pointCount, points });
    }

    return {
        headerLength,
        contourCount,
        mapInfo: { width, height, resolution, minX, minY, mapId },
        contours,
        bytesRead: offset,
        fileSize: buffer.length,
    };
}

module.exports = { decodeM9Map };
