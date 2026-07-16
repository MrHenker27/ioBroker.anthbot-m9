'use strict';

const GROUP_KEYS = {
    noGo: [
        'forbid_areas',
        'remote_forbid_areas',
        'forbidden_areas',
        'no_go_areas',
        'noGoAreas',
        'obstacle_areas',
    ],
    manual: ['custom_areas', 'customAreas', 'zones', 'ridable_areas'],
    automatic: [
        'region_areas',
        'regionAreas',
        'auto_regions',
        'autoRegions',
        'auto_zones',
        'autoZones',
        'regions',
    ],
    bridges: ['bridge_areas', 'bridges', 'channels', 'passages'],
};

function asPoint(value) {
    if (Array.isArray(value) && value.length >= 2) {
        const x = Number(value[0]);
        const y = Number(value[1]);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    if (value && typeof value === 'object') {
        const x = Number(value.x ?? value.lng ?? value.lon ?? value[0]);
        const y = Number(value.y ?? value.lat ?? value[1]);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    return null;
}

function extractPointList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const direct = value.map(asPoint).filter(Boolean);
    if (direct.length >= 1) {
        return direct;
    }

    for (const item of value) {
        if (!Array.isArray(item)) {
            continue;
        }

        const nested = item.map(asPoint).filter(Boolean);
        if (nested.length >= 1) {
            return nested;
        }
    }

    return [];
}

function findPoints(object) {
    if (!object || typeof object !== 'object') {
        return [];
    }

    for (const key of [
        'vertexs',
        'vertices',
        'points',
        'point_list',
        'pointList',
        'polygon',
        'boundary',
        'coordinates',
    ]) {
        const points = extractPointList(object[key]);
        if (points.length >= 1) {
            return points;
        }
    }

    const singlePoint = asPoint(object);
    return singlePoint ? [singlePoint] : [];
}

function listsFromKeys(areaDefinition, keys) {
    const result = [];

    for (const key of keys) {
        if (Array.isArray(areaDefinition?.[key])) {
            result.push(...areaDefinition[key]);
        }
    }

    return result;
}

function normalizeArea(item, index, kind) {
    const points = findPoints(item);
    if (points.length === 0) {
        return null;
    }

    return {
        kind,
        index,
        id: item?.id ?? item?.area_id ?? item?.areaId ?? item?.region_id ?? index,
        name: item?.name ?? item?.area_name ?? item?.areaName ?? '',
        points,
        raw: item,
    };
}

/**
 * Converts area_setting.json into renderer-friendly geometry.
 *
 * Real M9 keys currently observed:
 * - custom_areas[].vertexs
 * - forbid_areas[].vertexs
 * - remote_forbid_areas[].vertexs
 * - region_areas[].x / .y
 * - ridable_areas[].vertexs
 *
 * @param {object|null|undefined} areaDefinition
 * @returns {{noGo: object[], manual: object[], automatic: object[], bridges: object[]}}
 */
function parseAreaGeometry(areaDefinition) {
    const source = areaDefinition && typeof areaDefinition === 'object' ? areaDefinition : {};
    const result = { noGo: [], manual: [], automatic: [], bridges: [] };

    for (const [kind, keys] of Object.entries(GROUP_KEYS)) {
        result[kind] = listsFromKeys(source, keys)
            .map((item, index) => normalizeArea(item, index, kind))
            .filter(Boolean);
    }

    return result;
}

module.exports = {
    GROUP_KEYS,
    asPoint,
    extractPointList,
    findPoints,
    parseAreaGeometry,
};
