'use strict';

const assert = require('node:assert/strict');
const { buildM9Svg } = require('../../../lib/anthbot/m9-svg');

const mapData = {
    contours: [{ points: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 0, y: 10000 }] }],
};

describe('M9 SVG renderer', () => {
    it('renders no-go zones, path, robot and dock', () => {
        const svg = buildM9Svg(mapData, {
            areaDefinition: {
                forbid_areas: [{ id: 1, points: [[1000, 1000], [2000, 1000], [2000, 2000]] }],
            },
            path: {
                points: [
                    { xMetres: 1, yMetres: 1 },
                    { xMetres: 2, yMetres: 2 },
                ],
            },
            pose: { x: 2, y: 2, yaw: 90 },
            dockPose: { x: 1, y: 1 },
        });
        assert.match(svg, /m9-robot/);
        assert.match(svg, /m9-dock/);
        assert.match(svg, /stroke="#c92525"/);
        assert.match(svg, /stroke="#3887d6"/);
        assert.match(svg, /rotate\(90\)/);
    });

    it('keeps the viewBox stable when a bad pose is far outside the map', () => {
        const normal = buildM9Svg(mapData, { pose: { x: 2, y: 2 } });
        const bad = buildM9Svg(mapData, { pose: { x: 9999, y: 9999 } });
        const extract = svg => svg.match(/viewBox="([^"]+)"/)[1];
        assert.equal(extract(normal), extract(bad));
    });
});
