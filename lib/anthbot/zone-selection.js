'use strict';

const { autoZones, manualZones } = require('./payload');
const { AnthbotGenieError } = require('./utils');

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizedText(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {object} zone
 * @param {number} index
 * @param {'manual'|'auto'} type
 * @returns {{ value: string, label: string, type: string, id: number|string|null, name: string, x?: number, y?: number }}
 */
function zoneOption(zone, index, type) {
    const id = Number.isInteger(zone?.id) ? zone.id : null;
    const fallbackNumber = id ?? index + 1;
    const name = normalizedText(zone?.name);
    const typeLabel = type === 'manual' ? 'Zone' : 'Auto-Zone';
    const label = name || `${typeLabel} ${fallbackNumber}`;

    const option = {
        value: id != null ? `${type}:${id}` : `${type}:index:${index}`,
        label,
        type,
        id,
        name,
    };

    if (typeof zone?.x === 'number') {
        option.x = zone.x;
    }
    if (typeof zone?.y === 'number') {
        option.y = zone.y;
    }

    return option;
}

/**
 * @param {object} data
 * @returns {{ manual: Array<object>, auto: Array<object>, all: Array<object> }}
 */
function buildZoneOptions(data) {
    const manual = manualZones(data).map((zone, index) => zoneOption(zone, index, 'manual'));
    const auto = autoZones(data).map((zone, index) => zoneOption(zone, index, 'auto'));

    return {
        manual,
        auto,
        all: [...manual, ...auto],
    };
}

/**
 * @param {unknown} value
 * @returns {{ type: 'manual'|'auto', id: number|null, index: number|null, raw: string }}
 */
function parseZoneSelection(value) {
    const raw = normalizedText(value);
    const match = /^(manual|auto):(\d+)$/.exec(raw);
    if (match) {
        return {
            type: /** @type {'manual'|'auto'} */ (match[1]),
            id: Number(match[2]),
            index: null,
            raw,
        };
    }

    const indexMatch = /^(manual|auto):index:(\d+)$/.exec(raw);
    if (indexMatch) {
        return {
            type: /** @type {'manual'|'auto'} */ (indexMatch[1]),
            id: null,
            index: Number(indexMatch[2]),
            raw,
        };
    }

    throw new AnthbotGenieError(
        'Zone selection must be in the form "manual:ID" or "auto:ID"',
    );
}

/**
 * @param {object} data
 * @param {unknown} selectionValue
 * @returns {{ type: 'manual'|'auto', option: object, zone: object }}
 */
function resolveZoneSelection(data, selectionValue) {
    const parsed = parseZoneSelection(selectionValue);
    const zones = parsed.type === 'manual' ? manualZones(data) : autoZones(data);
    const options = zones.map((zone, index) => zoneOption(zone, index, parsed.type));

    let index = -1;
    if (parsed.id != null) {
        index = zones.findIndex(zone => zone?.id === parsed.id);
    } else if (parsed.index != null && parsed.index < zones.length) {
        index = parsed.index;
    }

    if (index < 0) {
        throw new AnthbotGenieError(`Selected ${parsed.type} zone is no longer available`);
    }

    return {
        type: parsed.type,
        option: options[index],
        zone: zones[index],
    };
}

/**
 * @param {object} context
 * @param {unknown} selectionValue
 * @returns {Promise<{ type: string, label: string, command: string }>}
 */
async function startSelectedZone(context, selectionValue) {
    const data = {
        ...(context.lastReported || {}),
        _area_definition: context.areaDefinition || {},
    };
    const resolved = resolveZoneSelection(data, selectionValue);

    if (resolved.type === 'manual') {
        if (!Number.isInteger(resolved.zone.id)) {
            throw new AnthbotGenieError('Selected manual zone has no usable ID');
        }
        await context.shadowClient.publishServiceCommand({
            cmd: 'custom_area_mow_start',
            data: { id: [resolved.zone.id] },
        });
        return {
            type: resolved.type,
            label: resolved.option.label,
            command: 'custom_area_mow_start',
        };
    }

    if (!Number.isInteger(resolved.zone.x) || !Number.isInteger(resolved.zone.y)) {
        throw new AnthbotGenieError('Selected auto zone has no usable coordinates');
    }

    await context.shadowClient.publishServiceCommand({
        cmd: 'region_mow_start',
        data: { points: [[resolved.zone.x, resolved.zone.y]] },
    });
    return {
        type: resolved.type,
        label: resolved.option.label,
        command: 'region_mow_start',
    };
}

module.exports = {
    buildZoneOptions,
    parseZoneSelection,
    resolveZoneSelection,
    startSelectedZone,
};
