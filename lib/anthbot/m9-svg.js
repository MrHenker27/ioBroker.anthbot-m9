'use strict';

/**
 * Creates an SVG from decoded Anthbot M9 map data.
 *
 * @param {object} mapData
 * @returns {string}
 */
function buildM9Svg(mapData) {
    const contours = Array.isArray(mapData?.contours) ? mapData.contours : [];

    const allPoints = contours.flatMap(contour =>
        Array.isArray(contour.points) ? contour.points : [],
    );

    if (allPoints.length === 0) {
        return '';
    }

    const minX = Math.min(...allPoints.map(point => point.x));
    const maxX = Math.max(...allPoints.map(point => point.x));
    const minY = Math.min(...allPoints.map(point => point.y));
    const maxY = Math.max(...allPoints.map(point => point.y));

    const padding = 500;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    const transformPoint = point => ({
        x: point.x - minX + padding,
        y: maxY - point.y + padding,
    });

    const parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
        '<rect width="100%" height="100%" fill="white"/>',
    ];
    
    for (const contour of contours) {
    const points = contour.points
        .map(transformPoint)
        .map(point => `${point.x},${point.y}`)
        .join(' ');

    let fill = 'none';
    let stroke = 'black';

    if (contour.type === 1) {
        fill = '#90ee90';
        stroke = '#228b22';
    } else if (contour.type === 2) {
        fill = '#ffcccc';
        stroke = '#cc0000';
    }

    parts.push(
        `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="40"/>`,
    );
}

    parts.push('</svg>');

    return parts.join('\n');
}

module.exports = {
    buildM9Svg,
};
