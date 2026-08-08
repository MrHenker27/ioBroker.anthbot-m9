'use strict';
const assert = require('node:assert/strict');
const { decodeMultiMapFiles, selectMultiMapEntry } = require('../../../lib/anthbot/multi-map');

describe('M9 multi-map helpers', () => {
    it('selects active multi-map by map id and includes md5', () => {
        assert.deepEqual(selectMultiMapEntry({
            map_time: 'two',
            multi_maps: { map_list: [
                { map_id: 'one', map_file_name: 'map_sn_0', md5: 'aaa' },
                { map_id: 'two', map_file_name: 'map_sn_1', md5: 'bbb' },
            ] },
        }), { fileName: 'map_sn_1', md5: 'bbb', mapId: 'two' });
    });

    it('decodes navigation raster and RTK mask', () => {
        const decoded = decodeMultiMapFiles(JSON.stringify({
            navi_map: { width: 2, height: 2, resolution: 0.05, x_min: -1, y_min: 2 },
        }), Buffer.from([1, 1, 2, 2]), Buffer.from([0, 1, 1, 0]));
        assert.deepEqual(decoded.runs, [[1, 2], [2, 2]]);
        assert.deepEqual(decoded.rtkMask.runs, [[0, 1], [1, 2], [0, 1]]);
        assert.equal(decoded.bounds.minX, -1000);
        assert.equal(decoded.bounds.minY, 2000);
    });
});
