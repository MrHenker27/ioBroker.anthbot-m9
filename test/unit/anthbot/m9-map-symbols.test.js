'use strict';
const assert = require('node:assert/strict');
const { standaloneSvg, symbolDefinitions } = require('../../../lib/anthbot/m9-map-symbols');

describe('M9 map symbols', () => {
    it('creates font-independent symbol definitions', () => {
        const svg = symbolDefinitions();
        assert.match(svg, /m9-symbol-rtk/);
        assert.match(svg, /m9-symbol-robot/);
        assert.match(svg, /m9-symbol-dock/);
        assert.doesNotMatch(svg, /📡|🤖|⚡/);
    });

    it('creates standalone SVG files', () => {
        assert.match(standaloneSvg('robot', 'Kevin'), /<svg/);
        assert.match(standaloneSvg('rtk', 'RTK'), /standalone-rtk/);
        assert.match(standaloneSvg('dock', 'Dock'), /standalone-dock/);
    });
});
