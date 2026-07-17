'use strict';

const { parseAreaGeometry } = require('./m9-area-geometry');
const { symbolDefinitions } = require('./m9-map-symbols');

function escapeXml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function asDebugRows(debugInfo) {
    if (!debugInfo || typeof debugInfo !== 'object') return [];
    const position = debugInfo.position || {};
    return [
        `Status: ${debugInfo.mowerStatus || 'unknown'}`,
        `Quelle: ${debugInfo.positionSource || 'none'}`,
        `Position: ${typeof position.x === 'number' ? position.x.toFixed(3) : '-'} / ${typeof position.y === 'number' ? position.y.toFixed(3) : '-'}`,
        `Richtung: ${typeof position.yaw === 'number' ? position.yaw.toFixed(1) : '-'}°`,
        `Pfadpunkte: ${debugInfo.pathPointCount ?? 0}`,
        `Pfad frisch: ${debugInfo.pathFresh ? 'ja' : 'nein'}${debugInfo.pathReason ? ` (${debugInfo.pathReason})` : ''}`,
        `Karte: ${debugInfo.mapId || '-'} / Konturen: ${debugInfo.contourCount ?? 0}`,
        `Aktive Zonen: ${Array.isArray(debugInfo.activeZoneIds) && debugInfo.activeZoneIds.length ? debugInfo.activeZoneIds.join(', ') : '-'}`,
    ];
}

function buildM9Svg(mapData, options = {}) {
    const contours = Array.isArray(mapData?.contours) ? mapData.contours : [];
    const contourPoints = contours.flatMap(contour =>
        Array.isArray(contour.points) ? contour.points : [],
    );
    if (contourPoints.length === 0) return '';

    const geometry = parseAreaGeometry(options.areaDefinition);
    const layers = {
        showManualZones: false,
        showAutoZones: false,
        showNoGoZones: true,
        showPaths: true,
        showCurrentTrack: true,
        showLegend: false,
        ...(options.layers || {}),
    };
    const areaPoints = Object.values(geometry)
        .flat()
        .flatMap(polygon => polygon.points);
    const pathPoints = Array.isArray(options.path?.points)
        ? options.path.points
            .filter(point => typeof point?.xMetres === 'number' && typeof point?.yMetres === 'number')
            .map(point => ({ x: point.xMetres * 1000, y: point.yMetres * 1000 }))
        : [];

    const allPoints = [...contourPoints, ...areaPoints];
    const minX = Math.min(...allPoints.map(point => point.x));
    const maxX = Math.max(...allPoints.map(point => point.x));
    const minY = Math.min(...allPoints.map(point => point.y));
    const maxY = Math.max(...allPoints.map(point => point.y));

    const padding = 650;
    const width = Math.max(1, maxX - minX + padding * 2);
    const height = Math.max(1, maxY - minY + padding * 2);

    const transform = point => ({
        x: point.x - minX + padding,
        y: maxY - point.y + padding,
    });
    const posePoint = pose => (
        pose && typeof pose.x === 'number' && typeof pose.y === 'number'
            ? transform({ x: pose.x * 1000, y: pose.y * 1000 })
            : null
    );
    const pointString = points => points.map(transform).map(point => `${point.x},${point.y}`).join(' ');

    const parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
        '<rect width="100%" height="100%" fill="#f8faf7"/>',
        symbolDefinitions(),
    ];

    for (const contour of contours) {
        if (!Array.isArray(contour.points) || contour.points.length < 3) continue;
        parts.push(`<polygon points="${pointString(contour.points)}" fill="#dcefd5" stroke="#263429" stroke-width="42" stroke-linejoin="round"/>`);
    }

    const drawAreas = (areas, fill, stroke, dash = '') => {
        for (const area of areas) {
            const label = area.name || area.id;

            if (area.points.length >= 3) {
                parts.push(`<polygon points="${pointString(area.points)}" fill="${fill}" stroke="${stroke}" stroke-width="45" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}><title>${escapeXml(label)}</title></polygon>`);
                continue;
            }

            if (area.points.length === 1) {
                const point = transform(area.points[0]);
                parts.push(`<g><circle cx="${point.x}" cy="${point.y}" r="230" fill="${fill}" stroke="${stroke}" stroke-width="45"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="${point.x + 300}" y="${point.y + 70}" font-family="Arial, sans-serif" font-size="210" font-weight="600" fill="${stroke}">${escapeXml(label)}</text></g>`);
            }
        }
    };

    if (layers.showAutoZones) {
        drawAreas(geometry.automatic, 'rgba(87,181,74,0.22)', '#3a8d35');
    }
    if (layers.showManualZones) {
        drawAreas(geometry.manual, 'rgba(55,139,220,0.13)', '#2477bc', '130 70');
    }
    if (layers.showPaths) {
        drawAreas(geometry.bridges, 'rgba(153,133,96,0.20)', '#8c7753');

        const bridgeRecords = Array.isArray(mapData?.bridgeData?.records)
            ? mapData.bridgeData.records
            : [];

        for (const bridge of bridgeRecords) {
            if (!Array.isArray(bridge.points) || bridge.points.length < 2) {
                continue;
            }

            const bridgePoints = pointString(bridge.points);
            parts.push(
                `<polyline points="${bridgePoints}" fill="none" ` +
                `stroke="#9a7445" stroke-width="115" stroke-linecap="round" ` +
                `stroke-linejoin="round" opacity="0.88">` +
                `<title>Fahrweg ${escapeXml(bridge.type)}</title></polyline>`,
            );
        }
    }
    if (layers.showNoGoZones) {
        drawAreas(geometry.noGo, 'rgba(235,76,76,0.30)', '#c92525', '120 55');
    }

    if (layers.showCurrentTrack && pathPoints.length >= 2) {
        parts.push(`<polyline clip-path="url(#m9-map-clip)" points="${pointString(pathPoints)}" fill="none" stroke="#3887d6" stroke-width="210" stroke-linecap="round" stroke-linejoin="round" opacity="0.90"/>`);
    }

    const dockPoint = posePoint(options.dockPose);
    if (dockPoint) {
        const yaw = typeof options.dockPose.yaw === 'number' ? options.dockPose.yaw : 0;
        parts.push(`<use clip-path="url(#m9-map-clip)" href="#m9-symbol-dock" transform="translate(${dockPoint.x} ${dockPoint.y}) rotate(${yaw}) scale(1.25)"/>`);
    }

    const robotPoint = posePoint(options.pose);
    if (robotPoint) {
        const yaw = typeof options.pose.yaw === 'number' ? options.pose.yaw : 0;
        parts.push(`<use clip-path="url(#m9-map-clip)" href="#m9-symbol-robot" transform="translate(${robotPoint.x} ${robotPoint.y}) rotate(${yaw}) scale(1.8)"><title>Kevin</title></use>`);
    }

    if (layers.showLegend) {
        // Font-independent vector legend, scaled to a stable fraction of the map width.
        const legendBaseWidth = 3050;
        const legendScale = Math.max(0.9, Math.min(2.3, (width * 0.30) / legendBaseWidth));
        const legendWidth = legendBaseWidth * legendScale;
        const legendX = Math.max(220, width - legendWidth - 220);
        const legendY = 500 * legendScale;
        parts.push(`<g transform="translate(${legendX} ${legendY}) scale(${legendScale})">`);
        parts.push('<rect x="-140" y="-340" width="3050" height="570" rx="100" fill="rgba(255,255,255,0.94)" stroke="#c8d0c8" stroke-width="18"/>');
        parts.push('<use href="#m9-symbol-rtk" transform="translate(170 -55) scale(0.34)"/>');
        parts.push('<use href="#m9-symbol-robot" transform="translate(1170 -55) scale(0.31)"/>');
        parts.push('<use href="#m9-symbol-dock" transform="translate(2190 -55) scale(0.31)"/>');
        parts.push('<g font-family="Arial, sans-serif" font-size="205" font-weight="600" fill="#20242a">');
        parts.push('<text x="370" y="10">RTK</text>');
        parts.push('<text x="1380" y="10">Kevin</text>');
        parts.push('<text x="2390" y="10">Ladestation</text>');
        parts.push('</g></g>');

    }

    if (options.debug) {
        const origin = transform({ x: 0, y: 0 });
        parts.push(`<g id="m9-debug" font-family="monospace" font-size="190">`);
        parts.push(`<rect x="${padding}" y="${padding}" width="${maxX - minX}" height="${maxY - minY}" fill="none" stroke="#ff7a00" stroke-width="30" stroke-dasharray="110 55"/>`);
        parts.push(`<line x1="${origin.x - 180}" y1="${origin.y}" x2="${origin.x + 180}" y2="${origin.y}" stroke="#9d00ff" stroke-width="32"/>`);
        parts.push(`<line x1="${origin.x}" y1="${origin.y - 180}" x2="${origin.x}" y2="${origin.y + 180}" stroke="#9d00ff" stroke-width="32"/>`);
        parts.push(`<text x="${origin.x + 210}" y="${origin.y - 35}" fill="#7100b5">0/0</text>`);

        const rows = asDebugRows(options.debugInfo);
        const panelWidth = Math.min(6700, Math.max(4300, width - 400));
        const panelHeight = 330 + rows.length * 245;
        const panelX = 200;
        const panelY = Math.max(500, height - panelHeight - 200);
        parts.push(`<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="80" fill="rgba(20,26,24,0.90)" stroke="#efb000" stroke-width="24"/>`);
        parts.push(`<text x="${panelX + 160}" y="${panelY + 260}" fill="#ffd54a" font-family="Arial, sans-serif" font-weight="bold" font-size="230">DEBUG = EIN</text>`);
        rows.forEach((row, index) => {
            parts.push(`<text x="${panelX + 160}" y="${panelY + 570 + index * 245}" fill="#f5f7f5">${escapeXml(row)}</text>`);
        });
        parts.push('</g>');
    }

    parts.push('</svg>');
    return parts.join('\n');
}

module.exports = {
    asDebugRows,
    buildM9Svg,
    escapeXml,
};
