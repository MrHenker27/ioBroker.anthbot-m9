'use strict';
const assert = require('node:assert/strict');
const { decodeHistoryPath, findHistoryPathUrl } = require('../../../lib/anthbot/history-path');

describe('M9 history path helpers', () => {
    it('decodes MGS v3 points', () => {
        const headerLength = 22;
        const pointLength = 6;
        const buffer = Buffer.alloc(headerLength + pointLength * 2);
        buffer.writeUInt8(headerLength, 0);
        buffer.writeUInt8(3, 1);
        buffer.writeUInt8(pointLength, 2);
        buffer.writeUInt8(4, 3);
        buffer.writeInt16LE(900, 4);
        buffer.writeInt32LE(2, 6);
        buffer.writeInt32LE(0, 10);
        buffer.writeBigUInt64LE(1234n, 14);
        buffer.writeInt16LE(100, 22);
        buffer.writeInt16LE(-50, 24);
        buffer.writeUInt8(7, 26);
        buffer.writeUInt8(10, 27);
        buffer.writeInt16LE(110, 28);
        buffer.writeInt16LE(-40, 30);
        buffer.writeUInt8(8, 32);
        buffer.writeUInt8(11, 33);
        const decoded = decodeHistoryPath(buffer);
        assert.equal(decoded.protocolVersion, 3);
        assert.equal(decoded.pathId, '1234');
        assert.equal(decoded.points[0].x, 1000);
        assert.equal(decoded.points[0].y, -500);
        assert.equal(decoded.points[0].cleanTime, 10);
    });

    it('finds app-style history URLs only in known history data', () => {
        assert.equal(findHistoryPathUrl({ history_path_info: { path_url: 'https://example/path_1.txt' } }), 'https://example/path_1.txt');
        assert.equal(findHistoryPathUrl({ unrelated: 'https://example/foo.txt' }), null);
    });
});
