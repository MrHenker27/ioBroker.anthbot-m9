'use strict';

const assert = require('node:assert/strict');
const { parseAreaGeometry } = require('../../../lib/anthbot/m9-area-geometry');

describe('M9 area geometry', () => {
    it('normalizes zones and no-go polygons', () => {
        const geometry = parseAreaGeometry({
            custom_areas: [{ id: 7, name: 'Zone 7', points: [[0, 0], [10, 0], [10, 10]] }],
            forbid_areas: [{ area_id: 9, vertices: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }] }],
        });
        assert.equal(geometry.manual.length, 1);
        assert.equal(geometry.manual[0].name, 'Zone 7');
        assert.equal(geometry.noGo.length, 1);
        assert.equal(geometry.noGo[0].id, 9);
    });
});
