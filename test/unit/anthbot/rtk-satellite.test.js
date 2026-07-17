'use strict';
const assert = require('node:assert/strict');
const { decodeRtkSatelliteInfo } = require('../../../lib/anthbot/rtk-satellite');
const { renderRtkSkyplot } = require('../../../lib/anthbot/rtk-skyplot');
describe('RTK satellite decoder', () => {
    it('decodes the app satellite binary format', () => {
        const b = Buffer.alloc(20); b[0]=13; b[1]=1; b[2]=1; b.writeUInt16LE(20,3); b.writeBigInt64LE(123n,5);
        b[13]=2; b[14]=1; b[15]=17; b[16]=45; b.writeUInt16LE(90,17); b[19]=42;
        const result=decodeRtkSatelliteInfo(b);
        assert.equal(result.satelliteCount,1); assert.deepEqual(result.satellites[0],{systemId:2,frequencyId:1,satelliteId:17,elevation:45,azimuth:90,signalStrength:42});
        assert.match(renderRtkSkyplot(result.satellites), /Sat 17/);
    });
});
