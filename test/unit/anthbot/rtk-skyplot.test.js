'use strict';

const assert = require('node:assert/strict');
const { renderRtkSkyplot } = require('../../../lib/anthbot/rtk-skyplot');

describe('RTK sky plot renderer', () => {
    it('renders satellites and German empty text', () => {
        const svg = renderRtkSkyplot([
            { satelliteId: 3, elevation: 45, azimuth: 90, signalStrength: 42 },
            { satelliteId: 8, elevation: 20, azimuth: 180, signalStrength: 18 },
        ]);
        assert.match(svg, /Sat 3/);
        assert.match(svg, /#4d58ff/);
        assert.match(svg, /#fe9a05/);

        const empty = renderRtkSkyplot([], { emptyText: 'Keine Satellitendaten verfügbar' });
        assert.match(empty, /Keine Satellitendaten verfügbar/);
    });
});
