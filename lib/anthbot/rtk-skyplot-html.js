'use strict';

const { renderRtkSkyplot } = require('./rtk-skyplot');

/**
 * Build a self-contained HTML fragment for ioBroker Admin's state/control=html component.
 * The SVG is embedded as a data URL so no sendTo call or external web server is required.
 * @param {Array<object>} satellites
 * @param {{ german?: boolean }} [options]
 * @returns {string}
 */
function buildRtkSkyplotHtml(satellites, options = {}) {
    const list = Array.isArray(satellites) ? satellites : [];
    const german = options.german === true;
    const title = german ? 'RTK-Satellitenkarte' : 'RTK satellite map';
    const emptyText = german ? 'Keine Satellitendaten verfügbar' : 'No satellite data available';
    const summary = german ? `${list.length} Satelliten der RTK-Basis` : `${list.length} RTK base satellites`;
    const svg = renderRtkSkyplot(list, { emptyText });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    return `<div style="width:100%;min-height:430px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow:hidden"><div style="font-size:18px;font-weight:500;margin:0 0 8px 0">${title}</div><img src="${dataUrl}" alt="${title}" style="display:block;width:100%;max-width:520px;height:auto;object-fit:contain"/><div style="margin-top:6px;font-size:13px;opacity:.75">${summary}</div></div>`;
}

module.exports = { buildRtkSkyplotHtml };
