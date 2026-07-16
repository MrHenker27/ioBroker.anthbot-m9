'use strict';

/**
 * Shared vector symbols for the M9 map and standalone SVG assets.
 * The symbols intentionally avoid emoji fonts so VIS, browser exports and PNG
 * rendering look identical on every platform.
 */

const SYMBOL_VIEWBOX = '-512 -512 1024 1024';

function robotSymbol(id = 'm9-symbol-robot') {
    return [
        `<g id="${id}">`,
        '<rect x="-318" y="-300" width="636" height="610" rx="178" fill="#b9a2dc"/>',
        '<rect x="-318" y="-300" width="636" height="610" rx="178" fill="url(#m9-purple-gloss)" opacity="0.55"/>',
        '<rect x="-250" y="-170" width="500" height="230" rx="88" fill="#151b45" stroke="#38345d" stroke-width="24"/>',
        '<rect x="-213" y="-125" width="74" height="95" rx="20" fill="#2d83ff"/>',
        '<rect x="139" y="-125" width="74" height="95" rx="20" fill="#49a0ff"/>',
        '<rect x="-112" y="140" width="224" height="76" rx="28" fill="#22204e"/>',
        '<rect x="-73" y="163" width="146" height="28" rx="14" fill="#8c56ff"/>',
        '<rect x="-360" y="-190" width="62" height="300" rx="31" fill="#ed174d"/>',
        '<rect x="298" y="-190" width="62" height="300" rx="31" fill="#ed174d"/>',
        '<rect x="-357" y="-398" width="24" height="212" rx="12" fill="#ed174d"/>',
        '<rect x="333" y="-398" width="24" height="212" rx="12" fill="#ed174d"/>',
        '<circle cx="-345" cy="-414" r="34" fill="#ff2a5d"/>',
        '<circle cx="345" cy="-414" r="34" fill="#ff2a5d"/>',
        '<rect x="-110" y="-350" width="220" height="64" rx="32" fill="#ffc400"/>',
        '<path d="M0,-460 L-65,-360 H65 Z" fill="#ff6a4d" opacity="0.0"/>',
        '</g>',
    ].join('');
}

function dockSymbol(id = 'm9-symbol-dock') {
    return [
        `<g id="${id}">`,
        '<path d="M80,-460 L-285,70 H-85 L-185,455 L300,-145 H80 Z" fill="url(#m9-dock-gradient)" stroke="#ff7d25" stroke-width="12" stroke-linejoin="round"/>',
        '<path d="M70,-420 L-225,35 H-40 L-120,350 L235,-105 H55 Z" fill="#fff4a8" opacity="0.22"/>',
        '</g>',
    ].join('');
}

function rtkSymbol(id = 'm9-symbol-rtk') {
    return [
        `<g id="${id}">`,
        '<rect x="-260" y="350" width="520" height="86" rx="26" fill="#9f99af"/>',
        '<circle cx="-90" cy="260" r="128" fill="url(#m9-rtk-base)"/>',
        '<circle cx="-122" cy="225" r="29" fill="#ffffff" opacity="0.85"/>',
        '<path d="M-92,65 L-330,-170 A350,350 0 0 0 -70,145 Z" fill="#aaa3bb" stroke="#928b9f" stroke-width="15"/>',
        '<path d="M-60,80 L85,-235" stroke="#8f8b98" stroke-width="34" stroke-linecap="round"/>',
        '<path d="M55,-182 L145,-87" stroke="#8f8b98" stroke-width="28" stroke-linecap="round"/>',
        '<circle cx="108" cy="-218" r="62" fill="#9b97a6"/>',
        '<path d="M190,-350 A175,175 0 0 1 355,-185" fill="none" stroke="#2786f5" stroke-width="48" stroke-linecap="round"/>',
        '<path d="M205,-255 A90,90 0 0 1 285,-175" fill="none" stroke="#2786f5" stroke-width="42" stroke-linecap="round"/>',
        '</g>',
    ].join('');
}

function commonDefs() {
    return [
        '<linearGradient id="m9-purple-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.62"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.08"/><stop offset="1" stop-color="#70549f" stop-opacity="0.36"/></linearGradient>',
        '<linearGradient id="m9-dock-gradient" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#ffd33d"/><stop offset="0.5" stop-color="#ff9f27"/><stop offset="1" stop-color="#ff4237"/></linearGradient>',
        '<radialGradient id="m9-rtk-base" cx="0.35" cy="0.25" r="0.9"><stop offset="0" stop-color="#d9d5e7"/><stop offset="1" stop-color="#a39caf"/></radialGradient>',
        '<filter id="m9-symbol-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="34" stdDeviation="30" flood-color="#101522" flood-opacity="0.24"/></filter>',
    ].join('');
}

function symbolDefinitions() {
    return `<defs>${commonDefs()}${rtkSymbol()}${robotSymbol()}${dockSymbol()}</defs>`;
}

function standaloneSvg(kind, title) {
    const renderers = { rtk: rtkSymbol, robot: robotSymbol, dock: dockSymbol };
    const renderer = renderers[kind];
    if (!renderer) throw new Error(`Unknown map symbol: ${kind}`);
    const id = `standalone-${kind}`;
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SYMBOL_VIEWBOX}" width="512" height="512" role="img" aria-label="${title}">`,
        `<title>${title}</title><defs>${commonDefs()}</defs>`,
        `<g filter="url(#m9-symbol-shadow)">${renderer(id)}</g>`,
        '</svg>',
    ].join('');
}

module.exports = { SYMBOL_VIEWBOX, commonDefs, dockSymbol, robotSymbol, rtkSymbol, standaloneSvg, symbolDefinitions };
