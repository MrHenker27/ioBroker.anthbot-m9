'use strict';

/**
 * Creates an SVG from decoded Anthbot M9 map data.
 *
 * Pose coordinates are supplied in metres and converted to millimetres.
 *
 * @param {object} mapData
 * @param {{x?: number, y?: number, yaw?: number}|null} pose
 * @param {{x?: number, y?: number, yaw?: number}|null} dockPose
 * @returns {string}
 */
function buildM9Svg(mapData, pose = null, dockPose = null) {
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
    
        const transformPose = sourcePose => {
        if (
            !sourcePose ||
            typeof sourcePose.x !== 'number' ||
            typeof sourcePose.y !== 'number'
        ) {
            return null;
        }

        const mapInfo = mapData?.mapInfo || {};
        const originX = typeof mapInfo.minX === 'number' ? mapInfo.minX : 0;
        const originY = typeof mapInfo.minY === 'number' ? mapInfo.minY : 0;

        return transformPoint({
            x: (sourcePose.x - originX) * 1000,
            y: (sourcePose.y - originY) * 1000,
        });
    };

    const robotPoint = transformPose(pose);
    const dockPoint = transformPose(dockPose);

    const robotYaw =
        pose && typeof pose.yaw === 'number'
            ? pose.yaw
            : 0;

    const dockYaw =
        dockPose && typeof dockPose.yaw === 'number'
            ? dockPose.yaw
            : 0;

    const parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
        '<rect width="100%" height="100%" fill="white"/>',

        '<defs>',

        // Kevin
        '<g id="m9-robot">',
        '<ellipse cx="0" cy="0" rx="240" ry="320" fill="#54b948" stroke="#202020" stroke-width="35"/>',
        '<rect x="-270" y="-170" width="55" height="340" rx="25" fill="#3d3d3d"/>',
        '<rect x="215" y="-170" width="55" height="340" rx="25" fill="#3d3d3d"/>',
        '<path d="M 0,-410 L -115,-230 L 115,-230 Z" fill="#2d7d2a" stroke="#202020" stroke-width="30"/>',
        '<circle cx="0" cy="-125" r="48" fill="#202020"/>',
        '<rect x="-95" y="30" width="190" height="70" rx="25" fill="#ffffff" opacity="0.9"/>',
        '<path d="M 0,-465 L -45,-380 L 45,-380 Z" fill="#ff3030"/>',
        '</g>',

        // Ladestation
        '<g id="m9-dock">',
        '<rect x="-310" y="-70" width="620" height="220" rx="35" fill="#686868" stroke="#202020" stroke-width="35"/>',
        '<path d="M -340,-60 L 0,-285 L 340,-60 Z" fill="#414141" stroke="#202020" stroke-width="35"/>',
        '<rect x="-145" y="-65" width="290" height="210" rx="25" fill="#f5f5f5" stroke="#202020" stroke-width="25"/>',
        '<path d="M 25,-215 L -25,-115 L 50,-115 L -35,20 L 5,-75 L -65,-75 Z" fill="#ffd400"/>',
        '</g>',

        '</defs>',
    ];

    // Grundkonturen
    for (const contour of contours) {
        if (!Array.isArray(contour.points) || contour.points.length < 3) {
            continue;
        }

        const points = contour.points
            .map(transformPoint)
            .map(point => `${point.x},${point.y}`)
            .join(' ');

        parts.push(
            `<polygon points="${points}" fill="#eef7ea" stroke="#202020" stroke-width="40"/>`,
        );
    }

    // Ladestation, sobald Koordinaten vorhanden sind
    if (dockPoint) {
        parts.push(
            `<use href="#m9-dock" transform="translate(${dockPoint.x} ${dockPoint.y}) rotate(${dockYaw}) scale(0.8)"/>`,
        );
    }

    // Kevin immer zuletzt, damit er oben sichtbar bleibt
    if (robotPoint) {
        parts.push(
            `<use href="#m9-robot" transform="translate(${robotPoint.x} ${robotPoint.y}) rotate(${robotYaw}) scale(0.75)"/>`,
        );
    }

    parts.push('</svg>');

    return parts.join('\n');
}

module.exports = {
    buildM9Svg,
};
