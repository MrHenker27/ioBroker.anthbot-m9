'use strict';

function esc(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
    })[character]);
}

/**
 * Render the RTK base satellite sky plot used in the Admin diagnostics.
 * @param {Array<object>} satellites
 * @param {{emptyText?: string}} [options]
 * @returns {string}
 */
function renderRtkSkyplot(satellites, options = {}) {
    const list = Array.isArray(satellites) ? satellites : [];
    const cx = 180;
    const cy = 180;
    const radius = 145;
    const dots = list.map(satellite => {
        const elevation = Math.max(0, Math.min(90, Number(satellite.elevation) || 0));
        const azimuth = (Number(satellite.azimuth) || 0) * Math.PI / 180;
        const r = radius * (1 - elevation / 90);
        const x = cx + Math.sin(azimuth) * r;
        const y = cy - Math.cos(azimuth) * r;
        const strength = Number(satellite.signalStrength) || 0;
        const fill = strength >= 35 ? '#4d58ff' : '#fe9a05';
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${fill}"><title>Sat ${esc(satellite.satelliteId)} · ${esc(strength)}</title></circle>`;
    }).join('');
    const empty = list.length === 0
        ? `<text x="180" y="185" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#666">${esc(options.emptyText || 'No satellite data available')}</text>`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 390">
<rect width="360" height="390" rx="8" fill="#fff"/>
<circle cx="180" cy="180" r="145" fill="#f3f3ff" stroke="#9ca3ff" stroke-width="3"/>
<circle cx="180" cy="180" r="100" fill="none" stroke="#d8d9ff"/>
<circle cx="180" cy="180" r="55" fill="none" stroke="#d8d9ff"/>
<path d="M180 35V325M35 180H325" stroke="#e3e4ff"/>
<text x="180" y="25" text-anchor="middle" font-family="sans-serif" font-size="16">N</text>
<text x="337" y="186" text-anchor="middle" font-family="sans-serif" font-size="16">E</text>
<text x="180" y="350" text-anchor="middle" font-family="sans-serif" font-size="16">S</text>
<text x="22" y="186" text-anchor="middle" font-family="sans-serif" font-size="16">W</text>
${dots}${empty}
<circle cx="84" cy="374" r="5.5" fill="#fe9a05"/><text x="96" y="379" font-family="sans-serif" font-size="13" fill="#333">schwach</text>
<circle cx="206" cy="374" r="5.5" fill="#4d58ff"/><text x="218" y="379" font-family="sans-serif" font-size="13" fill="#333">stark</text>
</svg>`;
}

module.exports = { renderRtkSkyplot };
