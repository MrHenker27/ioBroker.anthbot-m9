'use strict';

const { expect } = require('chai');
const { buildRtkSkyplotHtml } = require('../../lib/anthbot/rtk-skyplot-html');

describe('RTK skyplot HTML', () => {
    it('embeds a visible SVG image and satellite count without a sendTo request', () => {
        const html = buildRtkSkyplotHtml([
            { azimuth: 45, elevation: 60, signal: 42, satelliteId: 1 },
            { azimuth: 210, elevation: 25, signal: 20, satelliteId: 2 },
        ], { german: true });
        expect(html).to.include('RTK-Satellitenkarte');
        expect(html).to.include('2 Satelliten der RTK-Basis');
        const match = html.match(/data:image\/svg\+xml;base64,([^"]+)/);
        expect(match).to.not.equal(null);
        const svg = Buffer.from(match[1], 'base64').toString('utf8');
        expect(svg).to.include('<svg');
        expect(svg).to.include('</svg>');
    });

    it('renders a visible empty-state map', () => {
        const html = buildRtkSkyplotHtml([], { german: true });
        const match = html.match(/data:image\/svg\+xml;base64,([^"]+)/);
        const svg = Buffer.from(match[1], 'base64').toString('utf8');
        expect(svg).to.include('Keine Satellitendaten verfügbar');
    });
});
