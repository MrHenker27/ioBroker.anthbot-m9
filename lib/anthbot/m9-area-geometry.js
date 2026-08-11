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


const MAP_UNITS_PER_METRE = 1000;
const ACTIVE_AREA_MAX_AGE_MS = 5 * 60 * 1000;

function pointOnSegment(point, start, end) {
    const px = Number(point?.x);
    const py = Number(point?.y);
    const ax = Number(start?.x);
    const ay = Number(start?.y);
    const bx = Number(end?.x);
    const by = Number(end?.y);

    if (![px, py, ax, ay, bx, by].every(Number.isFinite)) {
        return false;
    }

    const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    if (Math.abs(cross) > 1e-9) {
        return false;
    }

    return (
        px >= Math.min(ax, bx) - 1e-9 &&
        px <= Math.max(ax, bx) + 1e-9 &&
        py >= Math.min(ay, by) - 1e-9 &&
        py <= Math.max(ay, by) + 1e-9
    );
}

/**
 * Returns true when a map point lies inside or on the boundary of a polygon.
 *
 * @param {{x:number,y:number}} point
 * @param {{x:number,y:number}[]} polygon
 * @returns {boolean}
 */
function pointInPolygon(point, polygon) {
    if (!point || !Array.isArray(polygon) || polygon.length < 3) {
        return false;
    }

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j];
        const b = polygon[i];

        if (pointOnSegment(point, a, b)) {
            return true;
        }

        const intersects =
            (b.y > point.y) !== (a.y > point.y) &&
            point.x < ((a.x - b.x) * (point.y - b.y)) / (a.y - b.y) + b.x;
        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Resolves the manual zone containing an M9 pose.
 * Curpath/pose coordinates are exposed in metres while area_setting vertexs
 * use millimetre-like map units, so the pose is scaled by 1000 before testing.
 * Charging/dock poses intentionally resolve to no zone even though map origin
 * 0/0 may geometrically lie inside a manual polygon.
 *
 * @param {object|null|undefined} areaDefinition
 * @param {{x?:number,y?:number}|null|undefined} pose
 * @param {{source?:string,charging?:boolean}} [options]
 * @returns {{id:any,name:string,index:number,kind:string}|null}
 */
function findManualZoneAtPose(areaDefinition, pose, options = {}) {
    if (
        options.charging === true ||
        String(options.source || '').startsWith('dock-position') ||
        !pose ||
        typeof pose.x !== 'number' ||
        typeof pose.y !== 'number' ||
        !Number.isFinite(pose.x) ||
        !Number.isFinite(pose.y)
    ) {
        return null;
    }

    const mapPoint = {
        x: pose.x * MAP_UNITS_PER_METRE,
        y: pose.y * MAP_UNITS_PER_METRE,
    };

    const zone = parseAreaGeometry(areaDefinition).manual.find(
        candidate => candidate.points.length >= 3 && pointInPolygon(mapPoint, candidate.points),
    );

    if (!zone) {
        return null;
    }

    return {
        id: zone.id,
        name: zone.name || `Zone ${zone.id}`,
        index: zone.index,
        kind: zone.kind,
    };
}

/**
 * Resolves a manual area by authoritative mower-reported active_area.id.
 * Returns null when no matching manual area is currently reported.
 *
 * @param {object|null|undefined} areaDefinition
 * @param {object|null|undefined} data
 * @param {{now?:number,maxAgeMs?:number}} [options]
 * @returns {{id:any,name:string,index:number,kind:string,source:string}|null}
 */
function findReportedManualZone(areaDefinition, data, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
        ? Math.max(0, Number(options.maxAgeMs))
        : ACTIVE_AREA_MAX_AGE_MS;
    const activeAreaTime = Number(data?.active_area?.time);
    if (
        !Number.isFinite(activeAreaTime) ||
        activeAreaTime <= 0 ||
        now - activeAreaTime > maxAgeMs ||
        activeAreaTime - now > 60_000
    ) {
        return null;
    }

    const rawIds = data?.active_area?.id;
    const ids = Array.isArray(rawIds) ? rawIds : (rawIds == null ? [] : [rawIds]);
    const wanted = ids
        .map(value => Number(value))
        .filter(Number.isFinite);
    if (!wanted.length) return null;

    const zone = parseAreaGeometry(areaDefinition).manual.find(candidate =>
        wanted.some(id => Number(candidate.id) === id),
    );
    if (!zone) return null;

    return {
        id: zone.id,
        name: zone.name || `Zone ${zone.id}`,
        index: zone.index,
        kind: zone.kind,
        source: 'active_area',
    };
}

/**
 * Resolves the best current manual zone. The mower-reported active_area.id
 * is authoritative; position geometry is a fallback when that field is absent.
 *
 * @param {object|null|undefined} areaDefinition
 * @param {object|null|undefined} data
 * @param {{x?:number,y?:number}|null|undefined} pose
 * @param {{source?:string,charging?:boolean,now?:number,maxAgeMs?:number}} [options]
 * @returns {{id:any,name:string,index:number,kind:string,source:string}|null}
 */
function resolveCurrentManualZone(areaDefinition, data, pose, options = {}) {
    if (options.charging === true || String(options.source || '').startsWith('dock-position')) {
        return null;
    }
    const reported = findReportedManualZone(areaDefinition, data, options);
    if (reported) return reported;
    const geometric = findManualZoneAtPose(areaDefinition, pose, options);
    return geometric ? { ...geometric, source: 'geometry' } : null;
}

module.exports = {
    GROUP_KEYS,
    MAP_UNITS_PER_METRE,
    ACTIVE_AREA_MAX_AGE_MS,
    findManualZoneAtPose,
    findReportedManualZone,
    resolveCurrentManualZone,
    pointInPolygon,
    pointOnSegment,
    asPoint,
    extractPointList,
    findPoints,
    parseAreaGeometry,
};
