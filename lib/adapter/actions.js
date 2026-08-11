'use strict';

const { MAINTENANCE_RESET_TYPES } = require('./definitions');
const { buildNestMowParamsPayload, buildParamSetPayload, autoZones, manualZones } = require('../anthbot/payload');
const { AnthbotGenieError, coerceEnabledValue, parseCommandSelection, safeGet } = require('../anthbot/utils');
const { startSelectedZone } = require('../anthbot/zone-selection');
const { exportMap } = require('../anthbot/map-export');
const { clearTrackHistory } = require('../anthbot/m9-track-history');

/**
 * @param {unknown} value
 * @returns {{ x: number, y: number }}
 */
function parsePointMowValue(value) {
    /** @type {unknown[]|{ x?: unknown, y?: unknown }|unknown} */
    let parsed = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                parsed = JSON.parse(trimmed);
            } catch (error) {
                throw new AnthbotGenieError(`Point mow value is invalid JSON: ${error.message}`);
            }
        } else {
            parsed = trimmed.split(',').map(part => part.trim());
        }
    }

    const pointObject =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {{ x?: unknown, y?: unknown }} */ (parsed)
            : null;
    const x = Array.isArray(parsed) ? parsed[0] : pointObject?.x;
    const y = Array.isArray(parsed) ? parsed[1] : pointObject?.y;
    const point = {
        x: Math.round(Number(x)),
        y: Math.round(Number(y)),
    };

    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new AnthbotGenieError('Point mow must be "x,y" or {"x":number,"y":number}');
    }
    return point;
}

/**
 * @param {unknown} value
 * @param {{ label: string, min: number, max: number, step?: number, suffix?: string }} options
 * @returns {number}
 */
function parseIntegerControlValue(value, { label, min, max, step = 1, suffix = '' }) {
    const intValue = Math.round(Number(value));
    const invalidStep = step > 1 && intValue % step !== 0;
    if (!Number.isFinite(intValue) || intValue < min || intValue > max || invalidStep) {
        const rangeText = `${min}..${max}`;
        const suffixText = suffix ? ` ${suffix}` : '';
        throw new AnthbotGenieError(`${label} must be ${rangeText}${suffixText}`);
    }
    return intValue;
}

/**
 * @param {{ lastReported?: object, areaDefinition?: object|null }} context
 * @param {unknown} value
 * @returns {number[]}
 */
function resolveManualZoneSelection(context, value) {
    const wanted = parseCommandSelection(/** @type {Array<*>|string|number|null|undefined} */ (value));
    const zones = manualZones({
        ...context.lastReported,
        _area_definition: context.areaDefinition || {},
    });
    const ids = new Set();
    for (const item of wanted) {
        if (typeof item === 'number' || /^\d+$/.test(String(item))) {
            const asNumber = Number(item);
            if (zones.some(zone => zone.id === asNumber)) {
                ids.add(asNumber);
            }
            continue;
        }
        const needle = String(item).trim().toLowerCase();
        for (const zone of zones) {
            if (
                typeof zone.name === 'string' &&
                zone.name.trim().toLowerCase() === needle &&
                Number.isInteger(zone.id)
            ) {
                ids.add(zone.id);
            }
        }
    }
    return [...ids];
}

/**
 * @param {{ lastReported?: object, areaDefinition?: object|null }} context
 * @param {unknown} value
 * @returns {number[][]}
 */
function resolveAutoZoneSelection(context, value) {
    const wanted = parseCommandSelection(/** @type {Array<*>|string|number|null|undefined} */ (value));
    const zones = autoZones({
        ...context.lastReported,
        _area_definition: context.areaDefinition || {},
    });
    const points = [];
    const seen = new Set();
    for (const item of wanted) {
        for (const zone of zones) {
            const idMatch = (typeof item === 'number' || /^\d+$/.test(String(item))) && zone.id === Number(item);
            const nameMatch =
                typeof zone.name === 'string' && zone.name.trim().toLowerCase() === String(item).trim().toLowerCase();
            if ((idMatch || nameMatch) && Number.isInteger(zone.x) && Number.isInteger(zone.y)) {
                const key = `${zone.x}:${zone.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    points.push([zone.x, zone.y]);
                }
            }
        }
    }
    return points;
}

/**
 * @param {{ context: { shadowClient: object, areaDefinition?: object|null, lastReported?: object, lastMapSvg?: string, mapExportDirectory?: string, mapExport?: object, zoneSelection?: object, device: { model?: string|null, serialNumber?: string, alias?: string } }, command: string, value: unknown }} params
 * @returns {Promise<boolean>}
 */
async function executeCommand({ context, command, value }) {
    switch (command) {
        case 'device.find':
            await context.shadowClient.publishServiceCommand({ cmd: 'find_robot' });
            return true;
        case 'mowing.startFullMap':
            await context.shadowClient.publishServiceCommand({ cmd: 'app_state', data: 1 });
            await new Promise(resolve => setTimeout(resolve, 1500));
            await context.shadowClient.publishServiceCommand({ cmd: 'mow_start', data: 1 });
            return true;
        case 'mowing.pause':
            await context.shadowClient.publishServiceCommand({ cmd: 'mow_pause' });
            return true;
        case 'mowing.resume':
            await context.shadowClient.publishServiceCommand({ cmd: 'mow_continue' });
            return true;
        case 'mowing.stop':
        case 'mowing.end':
            await context.shadowClient.publishServiceCommand({ cmd: 'stop_all_tasks', data: 1 });
            return true;
        case 'device.cancelRtkAntennaMoved':
            await context.shadowClient.publishServiceCommand({ cmd: 'clear_rtk_move' });
            return true;
        case 'docking.startReturn':
            await context.shadowClient.publishServiceCommand({ cmd: 'charge_start', data: 1 });
            return true;
        case 'docking.pauseReturn':
            await context.shadowClient.publishServiceCommand({ cmd: 'charge_pause' });
            return true;
        case 'maintenance.startGrassDump':
            await context.shadowClient.publishServiceCommand({ cmd: 'start_dump' });
            return true;
        case 'maintenance.startDiskMaintenance':
            await context.shadowClient.publishServiceCommand({ cmd: 'clean_mode_cmd' });
            return true;
        case 'mowing.startEdge':
            await context.shadowClient.publishServiceCommand({ cmd: 'ridable_mow_start', data: 1 });
            return true;
        case 'mowing.startNearCharger':
            await context.shadowClient.publishServiceCommand({ cmd: 'nest_mow_start', data: 1 });
            return true;
        case 'mowing.startPoint':
            await context.shadowClient.publishServiceCommand({
                cmd: 'mow_point',
                data: parsePointMowValue(value),
            });
            return true;
        case 'mowing.stopPoint':
            await context.shadowClient.publishServiceCommand({ cmd: 'mow_point_stop' });
            return true;
        case 'device.refresh':
            await context.shadowClient.requestAllProperties();
            return false;
        case 'map.clearTrack':
            clearTrackHistory(context);
            return false;
        case 'map.saveSvg':
            await exportMap(context, { createPng: false });
            return false;
        case 'map.createPng':
            await exportMap(context, { createPng: true });
            return false;
        case 'mowing.startZone': {
            const matchedIds = resolveManualZoneSelection(context, value);
            if (!matchedIds.length) {
                throw new AnthbotGenieError('No matching manual zones found');
            }
            await context.shadowClient.publishServiceCommand({
                cmd: 'custom_area_mow_start',
                data: { id: matchedIds },
            });
            return true;
        }
        case 'mowing.startSelectedZone': {
            const selection = context.zoneSelection?.selected;
            if (typeof selection !== 'string' || !selection.trim()) {
                throw new AnthbotGenieError('No zone selected');
            }
            const result = await startSelectedZone(context, selection);
            context.zoneSelection.lastResult = {
                ok: true,
                ...result,
                time: new Date().toISOString(),
            };
            return true;
        }
        case 'mowing.startAutoZone': {
            const points = resolveAutoZoneSelection(context, value);
            if (!points.length) {
                throw new AnthbotGenieError('No matching auto zones found');
            }
            await context.shadowClient.publishServiceCommand({
                cmd: 'region_mow_start',
                data: { points },
            });
            return true;
        }
        default:
            throw new AnthbotGenieError(`Unsupported command '${command}'`);
    }
}

/**
 * @param {{ context: { shadowClient: object }, command: string }} params
 * @returns {Promise<void>}
 */
async function executeConsumableCommand({ context, command }) {
    const robotMaintenance = MAINTENANCE_RESET_TYPES[command];

    if (robotMaintenance === undefined) {
        throw new AnthbotGenieError(`Unsupported consumable command '${command}'`);
    }

    await context.shadowClient.publishServiceCommand({
        cmd: 'robot_maintenance_reset',
        robot_maintenance: robotMaintenance,
    });
}

/**
 * @param {{ context: { lastReported?: object, shadowClient: object, mapDebug?: boolean, mapLayers?: Record<string, boolean>, zoneSelection?: object, device: { model?: string|null } }, control: string, value: unknown }} params
 * @returns {Promise<void>}
 */
async function executeControl({ context, control, value }) {
    const data = context.lastReported || {};

    switch (control) {
        case 'map.debug': {
            context.mapDebug = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            return;
        }
        case 'map.showManualZones':
        case 'map.showAutoZones':
        case 'map.showNoGoZones':
        case 'map.showPaths':
        case 'map.showCurrentTrack':
        case 'map.showLegend': {
            const key = control.slice('map.'.length);
            context.mapLayers = context.mapLayers || {};
            context.mapLayers[key] = coerceEnabledValue(
                /** @type {string|number|boolean|null|undefined} */ (value),
            );
            return;
        }
        case 'zoneSelection.selected': {
            const selected = String(value ?? '').trim();
            context.zoneSelection = context.zoneSelection || {};
            context.zoneSelection.selected = selected;
            return;
        }
        case 'fullMapMowing.mowHeight':
        case 'zoneMowing.mowHeight': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Mow height',
                min: 30,
                max: 70,
                step: 5,
                suffix: 'in 5 mm steps',
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'param_set',
                data: buildParamSetPayload(context.device.model, data, { cutter_height: intValue }),
            });
            return;
        }
        case 'fullMapMowing.includeEdgeTrimming': {
            const enabled = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            await context.shadowClient.publishServiceCommand({
                cmd: 'param_set',
                data: buildParamSetPayload(context.device.model, data, { rid_switch: enabled ? 1 : 0 }),
            });
            return;
        }
        case 'voiceVolume': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Voice volume',
                min: 0,
                max: 100,
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'volume_ctl',
                data: { volume: intValue },
            });
            return;
        }
        case 'fullMapMowing.customMowingDirection':
        case 'zoneMowing.customMowingDirection': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Custom mowing direction',
                min: 0,
                max: 180,
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'param_set',
                data: buildParamSetPayload(context.device.model, data, {
                    mow_head: intValue,
                    enable_adaptive_head: 0,
                }),
            });
            return;
        }
        case 'fullMapMowing.customMowingDirectionEnabled':
        case 'zoneMowing.customMowingDirectionEnabled': {
            const enabled = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            await context.shadowClient.publishServiceCommand({
                cmd: 'param_set',
                data: buildParamSetPayload(context.device.model, data, {
                    enable_adaptive_head: enabled ? 0 : 1,
                }),
            });
            return;
        }
        case 'zoneMowing.mowCount': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Zone mow count',
                min: 1,
                max: 3,
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'param_set',
                data: buildParamSetPayload(context.device.model, data, { mow_count: intValue }),
            });
            return;
        }
        case 'zoneMowing.obstacleAvoidanceEnabled': {
            const enabled = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            await context.shadowClient.publishServiceCommand({
                cmd: 'perception_obstacle_ctl',
                data: {
                    switch: enabled ? 1 : 0,
                    level: typeof safeGet(data, 'pobctl', 'level') === 'number' ? safeGet(data, 'pobctl', 'level') : 0,
                },
            });
            return;
        }
        case 'zoneMowing.obstacleAvoidanceLevel': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Zone obstacle avoidance level',
                min: 0,
                max: 2,
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'perception_obstacle_ctl',
                data: {
                    switch: coerceEnabledValue(safeGet(data, 'pobctl', 'switch')) ? 1 : 0,
                    level: intValue,
                },
            });
            return;
        }
        case 'rain.perceptionEnabled': {
            const enabled = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            const continueTime =
                typeof data.rain_continue_time === 'number' && data.rain_continue_time > 0
                    ? data.rain_continue_time
                    : 10800;
            await context.shadowClient.publishServiceCommand({
                cmd: 'ctl_rainer',
                data: {
                    switch: enabled ? 1 : 0,
                    continue_time: continueTime,
                },
            });
            return;
        }
        case 'rain.continueTimeHours': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Rain continue time',
                min: 0,
                max: 8,
                suffix: 'hours',
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'ctl_rainer',
                data: {
                    switch: coerceEnabledValue(data.rain_switch) ? 1 : 0,
                    continue_time: intValue * 3600,
                },
            });
            return;
        }
        case 'nearChargerMowing.enabled': {
            const enabled = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            await context.shadowClient.publishServiceCommand({
                cmd: 'set_mow_params',
                data: buildNestMowParamsPayload(data, { nest_switch: enabled ? 1 : 0 }),
            });
            return;
        }
        case 'nearChargerMowing.mowHeight': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Near charger mow height',
                min: 30,
                max: 70,
                step: 5,
                suffix: 'in 5 mm steps',
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'set_mow_params',
                data: buildNestMowParamsPayload(data, { nest_cutter_height: intValue }),
            });
            return;
        }
        case 'nearChargerMowing.mowCount': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Near charger mow count',
                min: 1,
                max: 3,
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'set_mow_params',
                data: buildNestMowParamsPayload(data, { nest_mow_count: intValue }),
            });
            return;
        }
        case 'nearChargerMowing.obstacleAvoidanceEnabled': {
            const enabled = coerceEnabledValue(/** @type {string|number|boolean|null|undefined} */ (value));
            await context.shadowClient.publishServiceCommand({
                cmd: 'set_mow_params',
                data: buildNestMowParamsPayload(data, { nest_pobctl_switch: enabled ? 1 : 0 }),
            });
            return;
        }
        case 'nearChargerMowing.obstacleAvoidanceLevel': {
            const intValue = parseIntegerControlValue(value, {
                label: 'Near charger obstacle avoidance level',
                min: 0,
                max: 2,
            });
            await context.shadowClient.publishServiceCommand({
                cmd: 'set_mow_params',
                data: buildNestMowParamsPayload(data, { nest_pobctl_level: intValue }),
            });
            return;
        }
        default:
            throw new AnthbotGenieError(`Unsupported control '${control}'`);
    }
}

module.exports = {
    executeCommand,
    executeConsumableCommand,
    executeControl,
    parseIntegerControlValue,
    parsePointMowValue,
    resolveAutoZoneSelection,
    resolveManualZoneSelection,
};
