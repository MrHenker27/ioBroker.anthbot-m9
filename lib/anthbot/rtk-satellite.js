'use strict';

/**
 * Decode the rtk_base_info.bin format used by Anthbot Genie 2.15.3.
 * Header: u8 headerLen, u8 version, u8 satelliteCount, u16 totalSize LE,
 * i64 rtkTargetTime LE. Each satellite record is seven bytes:
 * systemId, frequencyId, satelliteId, elevation, azimuth u16 LE, signalStrength.
 * @param {Buffer|Uint8Array} input
 */
function decodeRtkSatelliteInfo(input) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
    if (buffer.length < 13) throw new Error('RTK satellite buffer is too small');
    const headerLength = buffer.readUInt8(0);
    const version = buffer.readUInt8(1);
    const satelliteCount = buffer.readUInt8(2);
    const totalSize = buffer.readUInt16LE(3);
    const rtkTargetTime = buffer.readBigInt64LE(5).toString();
    if (version > 1) throw new Error(`Unsupported RTK satellite format version ${version}`);
    const required = headerLength + satelliteCount * 7;
    if (required > buffer.length) throw new Error(`RTK satellite buffer needs ${required} bytes, has ${buffer.length}`);
    const satellites = [];
    for (let index = 0; index < satelliteCount; index++) {
        const offset = headerLength + index * 7;
        satellites.push({
            systemId: buffer.readUInt8(offset),
            frequencyId: buffer.readUInt8(offset + 1),
            satelliteId: buffer.readUInt8(offset + 2),
            elevation: buffer.readUInt8(offset + 3),
            azimuth: buffer.readUInt16LE(offset + 4),
            signalStrength: buffer.readUInt8(offset + 6),
        });
    }
    return { headerLength, version, satelliteCount, totalSize, rtkTargetTime, satellites };
}

module.exports = { decodeRtkSatelliteInfo };
