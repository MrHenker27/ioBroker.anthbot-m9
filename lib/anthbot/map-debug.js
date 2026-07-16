'use strict';

function mapDebugInfo({ mapData, areaDefinition, position, dockPose, mowerStatus, activeZoneIds }) {
    const mapInfo = mapData?.mapInfo || {};
    const contours = Array.isArray(mapData?.contours) ? mapData.contours : [];
    return {
        enabled: true,
        mowerStatus: mowerStatus || 'unknown',
        positionSource: position?.source || 'none',
        position: position?.pose || null,
        dockPose: dockPose || null,
        pathPointCount: Array.isArray(position?.path?.points) ? position.path.points.length : 0,
        pathFresh: Boolean(position?.pathHealth?.fresh),
        pathReason: position?.pathHealth?.reason || '',
        mapId: mapInfo.mapId || '',
        mapWidth: mapInfo.width ?? null,
        mapHeight: mapInfo.height ?? null,
        mapResolution: mapInfo.resolution ?? null,
        contourCount: contours.length,
        areaDefinitionKeys:
            areaDefinition && typeof areaDefinition === 'object'
                ? Object.keys(areaDefinition).sort()
                : [],
        activeZoneIds: Array.isArray(activeZoneIds) ? activeZoneIds : [],
    };
}

module.exports = {
    mapDebugInfo,
};
