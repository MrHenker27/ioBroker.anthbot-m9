'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { decodeM9Bridge } = require('../../../lib/anthbot/m9-bridge-decoder');

test('decodes the supplied real M9 iot_bridge.bin', () => {
    const fixture = path.resolve(__dirname, '../../../../iot_bridge.bin');
    if (!fs.existsSync(fixture)) {
        return;
    }

    const decoded = decodeM9Bridge(fs.readFileSync(fixture));

    assert.equal(decoded.headerLength, 15);
    assert.equal(decoded.version, 1);
    assert.equal(decoded.bridgeCount, 4);
    assert.equal(decoded.mapId, '20260709165429');
    assert.deepEqual(
        decoded.records.map(record => [record.type, record.pointCount]),
        [[1, 5], [2, 9], [4, 12], [5, 12]],
    );
    assert.equal(decoded.bytesRead, decoded.fileSize);
});
