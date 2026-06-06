'use strict';

/** @type {typeof import('@iobroker/adapter-core')} */
const utils = require('@iobroker/adapter-core');
const axios = /** @type {import('axios').AxiosStatic} */ (/** @type {unknown} */ (require('axios')));
const {
    AnthbotCloudApiClient,
    AnthbotShadowApiClient,
    AnthbotGenieError,
    activeManualZoneIds,
    asInteger,
    asIsoTimestamp,
    autoZones,
    compactZonePayload,
    coerceEnabledValue,
    consumableLifetimes,
    errorDescription,
    generalMowerStatus,
    isLikelyAuthenticationError,
    isCharging,
    isCustomDirectionEnabled,
    isNonZero,
    manualZones,
    parseCommandSelection,
    rawRobotStatus,
    rtkBaseStateLabel,
    rtkStateLabel,
    safeGet,
} = require('./lib/anthbot');

/**
 * @typedef {object} AnthbotAdapterConfig
 * @property {string} username
 * @property {string} password
 * @property {string} areaCode
 * @property {string} apiHost
 * @property {number} pollInterval
 * @property {string} errorDescriptionLanguage
 */

/** @typedef {ioBroker.StringOrTranslated} StringOrTranslated */
/** @typedef {ioBroker.StateCommon} StateCommon */
/** @typedef {ioBroker.Adapter} IoBrokerAdapter */
/** @typedef {new (options: ioBroker.AdapterOptions | string) => IoBrokerAdapter} AdapterCtor */
/** @typedef {[id: string, type: "channel", name: StringOrTranslated]} DeviceChannelDefinition */
/** @typedef {StateCommon & { name: StringOrTranslated }} DeviceStateDefinition */

const AdapterBase = /** @type {AdapterCtor} */ (utils.Adapter);
const { I18n } = utils;

function t(en) {
    return I18n.getTranslatedObject(en);
}

function asText(value) {
    return value == null ? '' : String(value);
}

/** @returns {DeviceChannelDefinition[]} */
function getDeviceChannelDefinitions() {
    return [
        ['info', 'channel', t('Info')],
        ['metrics', 'channel', t('Metrics')],
        ['metrics.error', 'channel', t('Error metrics')],
        ['metrics.map', 'channel', t('Map metrics')],
        ['metrics.mowing', 'channel', t('Mowing metrics')],
        ['metrics.pointMowing', 'channel', t('Point mowing metrics')],
        ['metrics.status', 'channel', t('Status metrics')],
        ['metrics.zones', 'channel', t('Zone metrics')],
        ['diagnostics', 'channel', t('Diagnostics')],
        ['diagnostics.features', 'channel', t('Feature diagnostics')],
        ['diagnostics.network', 'channel', t('Network diagnostics')],
        ['diagnostics.ota', 'channel', t('OTA diagnostics')],
        ['diagnostics.rtk', 'channel', t('RTK diagnostics')],
        ['diagnostics.security', 'channel', t('Security diagnostics')],
        ['diagnostics.system', 'channel', t('System diagnostics')],
        ['diagnostics.time', 'channel', t('Time diagnostics')],
        ['location', 'channel', t('Location')],
        ['location.gps', 'channel', t('GPS location')],
        ['location.pose', 'channel', t('Pose location')],
        ['consumable', 'channel', t('Consumable')],
        ['consumable.blades', 'channel', t('Blades')],
        ['consumable.cameras', 'channel', t('Cameras')],
        ['consumable.chargingPort', 'channel', t('Charging port')],
        ['controls', 'channel', t('Controls')],
        ['controls.fullMapMowing', 'channel', t('Full-map mowing')],
        ['controls.nearChargerMowing', 'channel', t('Near-charger mowing')],
        ['controls.rain', 'channel', t('Rain controls')],
        ['controls.zoneMowing', 'channel', t('Zone mowing')],
        ['commands', 'channel', t('Commands')],
        ['commands.device', 'channel', t('Device commands')],
        ['commands.docking', 'channel', t('Docking commands')],
        ['commands.maintenance', 'channel', t('Maintenance commands')],
        ['commands.mowing', 'channel', t('Mowing commands')],
        ['zones', 'channel', t('Zones')],
        ['zones.manual', 'channel', t('Manual zones')],
        ['raw', 'channel', t('Raw')],
        ['raw.shadow', 'channel', t('Raw shadows')],
    ];
}

/** @returns {Record<string, DeviceStateDefinition>} */
function getDeviceStateDefinitions() {
    return {
        'info.alias': { type: 'string', role: 'text', read: true, write: false, name: t('Alias') },
        'info.model': { type: 'string', role: 'text', read: true, write: false, name: t('Model') },
        'info.region': { type: 'string', role: 'text', read: true, write: false, name: t('Region') },
        'info.endpoint': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('IoT endpoint'),
        },
        'info.online': {
            type: 'boolean',
            role: 'indicator.reachable',
            read: true,
            write: false,
            name: t('Online'),
        },
        'info.charging': {
            type: 'boolean',
            role: 'indicator.working',
            read: true,
            write: false,
            name: t('Charging'),
        },
        'info.lastServiceCommand': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Last service command'),
        },
        'info.lastPoll': { type: 'string', role: 'date', read: true, write: false, name: t('Last poll') },
        'consumable.chargingPort.life': {
            type: 'number',
            role: 'value',
            unit: '%',
            read: true,
            write: false,
            name: t('Charging port lifetime'),
        },
        'consumable.chargingPort.reset': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Reset charging port lifetime'),
            def: false,
        },
        'consumable.cameras.life': {
            type: 'number',
            role: 'value',
            unit: '%',
            read: true,
            write: false,
            name: t('Cameras lifetime'),
        },
        'consumable.cameras.reset': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Reset cameras lifetime'),
            def: false,
        },
        'consumable.blades.life': {
            type: 'number',
            role: 'value',
            unit: '%',
            read: true,
            write: false,
            name: t('Blades lifetime'),
        },
        'consumable.blades.reset': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Reset blades lifetime'),
            def: false,
        },
        'metrics.batteryLevel': {
            type: 'number',
            role: 'value.battery',
            unit: '%',
            read: true,
            write: false,
            name: t('Battery level'),
        },
        'metrics.status.mower': {
            type: 'string',
            role: 'value',
            read: true,
            write: false,
            name: t('Mower status'),
        },
        'metrics.status.robotRaw': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Raw robot status'),
        },
        'metrics.mowing.time': {
            type: 'number',
            role: 'value.interval',
            unit: 's',
            read: true,
            write: false,
            name: t('Mowing time'),
        },
        'metrics.mowing.area': {
            type: 'number',
            role: 'value',
            unit: 'm²',
            read: true,
            write: false,
            name: t('Mowing area'),
        },
        'metrics.mowing.borderActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Mowing border'),
        },
        'metrics.mowing.nearChargerActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Mowing nest'),
        },
        'metrics.mowing.fullYardActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Full-yard mowing enabled'),
        },
        'metrics.pointMowing.active': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Point mowing active'),
        },
        'metrics.pointMowing.x': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Point mowing X'),
        },
        'metrics.pointMowing.y': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Point mowing Y'),
        },
        'metrics.zones.manualCount': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Manual zone count'),
        },
        'metrics.zones.autoCount': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Auto zone count'),
        },
        'metrics.map.totalArea': {
            type: 'number',
            role: 'value',
            unit: 'm²',
            read: true,
            write: false,
            name: t('Total mapped area'),
        },
        'metrics.map.status': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Map status'),
        },
        'metrics.error.code': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Error code'),
        },
        'metrics.error.description': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Error description'),
        },
        'metrics.error.active': {
            type: 'boolean',
            role: 'indicator.maintenance',
            read: true,
            write: false,
            name: t('Error active'),
        },
        'location.gps.latitude': {
            type: 'number',
            role: 'value.gps.latitude',
            read: true,
            write: false,
            name: t('GPS latitude'),
        },
        'location.gps.longitude': {
            type: 'number',
            role: 'value.gps.longitude',
            read: true,
            write: false,
            name: t('GPS longitude'),
        },
        'location.pose.x': { type: 'number', role: 'value', read: true, write: false, name: t('Pose X') },
        'location.pose.y': { type: 'number', role: 'value', read: true, write: false, name: t('Pose Y') },
        'location.pose.yaw': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Pose yaw'),
        },
        'location.pose.type': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Pose type'),
        },
        'diagnostics.rtk.state': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('RTK fix state'),
        },
        'diagnostics.rtk.baseState': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('RTK base station state'),
        },
        'diagnostics.rtk.antennaMoved': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('RTK antenna moved'),
        },
        'diagnostics.rtk.baseFirmware': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('RTK base firmware'),
        },
        'diagnostics.cameraError': {
            type: 'boolean',
            role: 'indicator.maintenance',
            read: true,
            write: false,
            name: t('Camera error'),
        },
        'diagnostics.network.wifiConnected': {
            type: 'boolean',
            role: 'indicator.reachable',
            read: true,
            write: false,
            name: t('WiFi connected'),
        },
        'diagnostics.network.cellularConnected': {
            type: 'boolean',
            role: 'indicator.reachable',
            read: true,
            write: false,
            name: t('Cellular connected'),
        },
        'diagnostics.network.cellularHeartbeat': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Cellular heartbeat'),
        },
        'diagnostics.network.bluetoothActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Bluetooth active'),
        },
        'diagnostics.network.wifiSsid': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('WiFi SSID'),
        },
        'diagnostics.network.ipAddress': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('IP address'),
        },
        'diagnostics.network.simPresent': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('SIM inserted'),
        },
        'diagnostics.network.simCcid': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('SIM CCID'),
        },
        'diagnostics.mapAvailable': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Map available'),
        },
        'diagnostics.accelerometerActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Accelerometer active'),
        },
        'diagnostics.features.antiLossActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Anti-loss state'),
        },
        'diagnostics.features.edgeCutActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Edge-cut state'),
        },
        'diagnostics.features.indoorModeActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Indoor mode state'),
        },
        'diagnostics.features.autoUpgradeActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Auto upgrade state'),
        },
        'diagnostics.features.obstacleAvoidanceActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Obstacle avoidance state'),
        },
        'diagnostics.features.obstacleAvoidanceLevel': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Obstacle avoidance level'),
        },
        'diagnostics.features.drcActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('DRC enabled'),
        },
        'diagnostics.features.logUploadActive': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('Log upload enabled'),
        },
        'diagnostics.security.factoryResetPending': {
            type: 'boolean',
            role: 'indicator.maintenance',
            read: true,
            write: false,
            name: t('Factory reset pending'),
        },
        'diagnostics.security.unbindPending': {
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            name: t('User unbind pending'),
        },
        'diagnostics.security.pinCode': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Device PIN'),
        },
        'diagnostics.security.antiLossRadius': {
            type: 'number',
            role: 'value',
            unit: 'm',
            read: true,
            write: false,
            name: t('Anti-loss radius'),
        },
        'diagnostics.system.eventCode': {
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            name: t('Last event code'),
        },
        'diagnostics.system.firmwareVersion': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Firmware version'),
        },
        'diagnostics.system.mainBoardVersion': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Main board version'),
        },
        'diagnostics.system.extensionBoardVersion': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Extension board version'),
        },
        'diagnostics.system.protocolVersion': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Protocol version'),
        },
        'diagnostics.system.minimumAppVersion': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Minimum app version'),
        },
        'diagnostics.system.voiceLanguage': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('Voice language'),
        },
        'diagnostics.ota.progress': {
            type: 'number',
            role: 'value',
            unit: '%',
            read: true,
            write: false,
            name: t('OTA progress'),
        },
        'diagnostics.ota.state': {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            name: t('OTA state'),
        },
        'diagnostics.ota.timeEstimate': {
            type: 'number',
            role: 'value.interval',
            unit: 's',
            read: true,
            write: false,
            name: t('OTA time estimate'),
        },
        'diagnostics.time.shadowUpdated': {
            type: 'string',
            role: 'date',
            read: true,
            write: false,
            name: t('Shadow last updated'),
        },
        'diagnostics.time.systemBoot': {
            type: 'string',
            role: 'date',
            read: true,
            write: false,
            name: t('System boot time'),
        },
        'diagnostics.time.mapUpdated': {
            type: 'string',
            role: 'date',
            read: true,
            write: false,
            name: t('Map last updated'),
        },
        'diagnostics.time.pathUpdated': {
            type: 'string',
            role: 'date',
            read: true,
            write: false,
            name: t('Path last updated'),
        },
        'diagnostics.time.areaUpdated': {
            type: 'string',
            role: 'date',
            read: true,
            write: false,
            name: t('Area last updated'),
        },
        'diagnostics.time.nextAppointment': {
            type: 'string',
            role: 'date',
            read: true,
            write: false,
            name: t('Next appointment'),
        },
        'controls.fullMapMowing.mowHeight': {
            type: 'number',
            role: 'level',
            unit: 'mm',
            min: 30,
            max: 70,
            read: true,
            write: true,
            name: t('Set full-map mow height'),
        },
        'controls.fullMapMowing.includeEdgeTrimming': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Include edge trimming in full-map mowing'),
        },
        'controls.fullMapMowing.customMowingDirection': {
            type: 'number',
            role: 'level',
            unit: 'deg',
            min: 0,
            max: 180,
            read: true,
            write: true,
            name: t('Set full-map custom mowing direction'),
        },
        'controls.fullMapMowing.customMowingDirectionEnabled': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Enable full-map custom mowing direction'),
        },
        'controls.zoneMowing.mowHeight': {
            type: 'number',
            role: 'level',
            unit: 'mm',
            min: 30,
            max: 70,
            read: true,
            write: true,
            name: t('Set zone mow height'),
        },
        'controls.zoneMowing.mowCount': {
            type: 'number',
            role: 'level',
            min: 1,
            max: 3,
            read: true,
            write: true,
            name: t('Set zone mow count'),
        },
        'controls.zoneMowing.customMowingDirection': {
            type: 'number',
            role: 'level',
            unit: 'deg',
            min: 0,
            max: 180,
            read: true,
            write: true,
            name: t('Set zone custom mowing direction'),
        },
        'controls.zoneMowing.customMowingDirectionEnabled': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Enable zone custom mowing direction'),
        },
        'controls.zoneMowing.obstacleAvoidanceEnabled': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Enable zone obstacle avoidance'),
        },
        'controls.zoneMowing.obstacleAvoidanceLevel': {
            type: 'number',
            role: 'level',
            min: 0,
            max: 2,
            read: true,
            write: true,
            name: t('Set zone obstacle avoidance level'),
        },
        'controls.voiceVolume': {
            type: 'number',
            role: 'level.volume',
            unit: '%',
            min: 0,
            max: 100,
            read: true,
            write: true,
            name: t('Set voice volume'),
        },
        'controls.rain.perceptionEnabled': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Enable rain perception'),
        },
        'controls.rain.continueTimeHours': {
            type: 'number',
            role: 'level',
            unit: 'h',
            min: 0,
            max: 8,
            read: true,
            write: true,
            name: t('Set rain continue time'),
        },
        'controls.nearChargerMowing.enabled': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Enable mowing near charging pile'),
        },
        'controls.nearChargerMowing.mowHeight': {
            type: 'number',
            role: 'level',
            unit: 'mm',
            min: 30,
            max: 70,
            read: true,
            write: true,
            name: t('Set near charger mow height'),
        },
        'controls.nearChargerMowing.mowCount': {
            type: 'number',
            role: 'level',
            min: 1,
            max: 3,
            read: true,
            write: true,
            name: t('Set near charger mow count'),
        },
        'controls.nearChargerMowing.obstacleAvoidanceEnabled': {
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            name: t('Enable near charger obstacle avoidance'),
        },
        'controls.nearChargerMowing.obstacleAvoidanceLevel': {
            type: 'number',
            role: 'level',
            min: 0,
            max: 2,
            read: true,
            write: true,
            name: t('Set near charger obstacle avoidance level'),
        },
        'commands.device.find': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Find robot'),
            def: false,
        },
        'commands.device.refresh': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Request refresh'),
            def: false,
        },
        'commands.device.cancelRtkAntennaMoved': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Cancel RTK antenna moved warning'),
            def: false,
        },
        'commands.docking.startReturn': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Return to dock'),
            def: false,
        },
        'commands.docking.pauseReturn': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Pause return to dock'),
            def: false,
        },
        'commands.maintenance.startGrassDump': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Start grass dump'),
            def: false,
        },
        'commands.maintenance.startDiskMaintenance': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Start disk maintenance mode'),
            def: false,
        },
        'commands.mowing.startFullMap': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Start full-map mow'),
            def: false,
        },
        'commands.mowing.startZone': {
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            name: t('Start manual zone mow'),
        },
        'commands.mowing.startAutoZone': {
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            name: t('Start auto zone mow'),
        },
        'commands.mowing.startPoint': {
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            name: t('Start point mow'),
        },
        'commands.mowing.startEdge': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Start edge mow'),
            def: false,
        },
        'commands.mowing.startNearCharger': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Start mowing near charging pile'),
            def: false,
        },
        'commands.mowing.pause': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Pause mowing'),
            def: false,
        },
        'commands.mowing.resume': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Resume mowing'),
            def: false,
        },
        'commands.mowing.stop': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Stop mow'),
            def: false,
        },
        'commands.mowing.end': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('End mowing'),
            def: false,
        },
        'commands.mowing.stopPoint': {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            name: t('Stop point mow'),
            def: false,
        },
        'zones.manual.list': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Manual zones'),
        },
        'zones.manual.activeIds': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Active manual zone IDs'),
        },
        'zones.autoList': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Auto zones'),
        },
        'raw.shadow.property': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Raw property shadow'),
        },
        'raw.shadow.service': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Raw service shadow'),
        },
        'raw.shadow.event-code': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Raw event code translations'),
        },
        'raw.areaDefinition': {
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            name: t('Raw area definition'),
        },
    };
}

const BOOLEAN_COMMANDS = [
    'device.find',
    'device.refresh',
    'device.cancelRtkAntennaMoved',
    'docking.startReturn',
    'docking.pauseReturn',
    'maintenance.startGrassDump',
    'maintenance.startDiskMaintenance',
    'mowing.startFullMap',
    'mowing.startEdge',
    'mowing.startNearCharger',
    'mowing.pause',
    'mowing.resume',
    'mowing.stop',
    'mowing.end',
    'mowing.stopPoint',
];

const STRING_COMMANDS = ['mowing.startZone', 'mowing.startAutoZone', 'mowing.startPoint'];

const MAINTENANCE_RESET_TYPES = {
    'blades.reset': 0,
    'cameras.reset': 1,
    'chargingPort.reset': 2,
};

class AnthbotGenieAdapter extends AdapterBase {
    constructor(options = {}) {
        super({
            ...options,
            name: 'anthbot-genie',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.http = null;
        this.cloudClient = null;
        this.authToken = null;
        this.deviceContexts = new Map();
        this.eventCodeCache = null;
        this.eventCodeCacheInitialized = false;
        this.pollTimer = null;
        this.refreshInFlight = null;
        this.unloaded = false;
    }

    /**
     * @returns {AnthbotAdapterConfig}
     */
    get anthbotConfig() {
        return /** @type {AnthbotAdapterConfig} */ (this.config);
    }

    async onReady() {
        this.unloaded = false;
        const config = this.anthbotConfig;
        this.http = axios.create({
            timeout: 15000,
            validateStatus: () => true,
        });

        await I18n.init(__dirname, this);
        await this.ensureBaseObjects();
        await this.setStateAsync('info.connection', false, true);

        if (!config.username || !config.password) {
            this.log.error('Username and password must be configured.');
            return;
        }

        this.subscribeStates('*.commands.*');
        this.subscribeStates('*.controls.*');
        this.subscribeStates('*.consumable.*.reset');

        await this.refreshAll(true);
        this.schedulePoll();
    }

    async ensureBaseObjects() {
        await this.extendObjectAsync('info.connection', {
            type: 'state',
            common: {
                name: t('Cloud connection'),
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
    }

    onUnload(callback) {
        try {
            this.unloaded = true;
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }
            callback();
        } catch {
            callback();
        }
    }

    schedulePoll() {
        if (this.unloaded) {
            return;
        }
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }
        const intervalSeconds = Math.max(10, Number(this.anthbotConfig.pollInterval) || 60);
        this.pollTimer = this.setTimeout(async () => {
            this.pollTimer = null;
            try {
                await this.refreshAll();
            } finally {
                if (!this.unloaded) {
                    this.schedulePoll();
                }
            }
        }, intervalSeconds * 1000);
    }

    async refreshAll(forceLogin = false) {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }
        this.refreshInFlight = this.doRefreshAll(forceLogin).finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }

    async doRefreshAll(forceLogin = false) {
        return this.runRefreshCycle(forceLogin, false);
    }

    async runRefreshCycle(forceLogin, retriedAfterAuthFailure) {
        let successful = 0;
        try {
            await this.ensureSession(forceLogin);
            await this.discoverDevices(forceLogin);
            await this.ensureEventCodeCache();
            for (const context of this.deviceContexts.values()) {
                try {
                    await this.refreshDevice(context);
                    successful += 1;
                } catch (error) {
                    this.log.warn(`Refresh failed for ${context.device.serialNumber}: ${error.message}`);
                }
            }
        } catch (error) {
            if (!retriedAfterAuthFailure && !forceLogin && isLikelyAuthenticationError(error)) {
                this.log.info('Anthbot cloud session expired, retrying refresh with a new login.');
                return this.runRefreshCycle(true, true);
            }
            this.log.error(`Global refresh failed: ${error.message}`);
        }

        await this.setStateAsync('info.connection', successful > 0, true);
    }

    async ensureEventCodeCache() {
        if (this.eventCodeCacheInitialized) {
            return;
        }
        this.eventCodeCacheInitialized = true;

        const cached = await this.readStoredEventCodeCache();
        this.eventCodeCache = cached;

        let cloudVersion = null;
        try {
            cloudVersion = await this.cloudClient.getEventCodeVersion();
        } catch (error) {
            if (cached) {
                this.log.warn(`Failed to fetch event code version, using cached translations: ${error.message}`);
                await this.writeEventCodeCacheToDevices(cached);
            } else {
                this.log.warn(
                    `Failed to fetch event code version and no cached translations are available: ${error.message}`,
                );
            }
            return;
        }

        if (cached && asInteger(cached.version) === cloudVersion) {
            this.eventCodeCache = cached;
            await this.writeEventCodeCacheToDevices(cached);
            return;
        }

        try {
            const payload = await this.cloudClient.getEventCodeTranslations(cloudVersion);
            this.eventCodeCache = {
                version: cloudVersion,
                fetchedAt: new Date().toISOString(),
                payload,
            };
            await this.writeEventCodeCacheToDevices(this.eventCodeCache);
        } catch (error) {
            if (cached) {
                this.log.warn(`Failed to fetch event code translations, using cached translations: ${error.message}`);
                this.eventCodeCache = cached;
                await this.writeEventCodeCacheToDevices(cached);
            } else {
                this.log.warn(
                    `Failed to fetch event code translations and no cached translations are available: ${error.message}`,
                );
            }
        }
    }

    async readStoredEventCodeCache() {
        for (const context of this.deviceContexts.values()) {
            const serial = context.device.serialNumber;
            try {
                const state = await this.getStateAsync(`${serial}.raw.shadow.event-code`);
                const raw = typeof state?.val === 'string' ? state.val : '';
                if (!raw) {
                    continue;
                }
                const parsed = JSON.parse(raw);
                if (this.isValidEventCodeCache(parsed)) {
                    return parsed;
                }
            } catch (error) {
                this.log.debug(`Stored event code cache could not be read for ${serial}: ${error.message}`);
            }
        }
        return null;
    }

    isValidEventCodeCache(cache) {
        return Boolean(
            cache &&
            typeof cache === 'object' &&
            asInteger(cache.version) != null &&
            cache.payload &&
            typeof cache.payload === 'object' &&
            !Array.isArray(cache.payload),
        );
    }

    async writeEventCodeCacheToDevices(cache) {
        if (!cache) {
            return;
        }
        const value = JSON.stringify(cache);
        for (const context of this.deviceContexts.values()) {
            await this.setStateAsync(`${context.device.serialNumber}.raw.shadow.event-code`, { val: value, ack: true });
        }
    }

    async ensureSession(force = false) {
        const config = this.anthbotConfig;
        if (!this.cloudClient || force) {
            this.cloudClient = new AnthbotCloudApiClient({
                http: this.http,
                host: config.apiHost || 'api.anthbot.com',
                bearerToken: force ? null : this.authToken,
            });
        }
        if (!this.authToken || force) {
            this.authToken = await this.cloudClient.login({
                username: config.username,
                password: config.password,
                areaCode: String(config.areaCode || '49'),
            });
        }
    }

    async discoverDevices(force = false) {
        if (this.deviceContexts.size > 0 && !force) {
            return;
        }

        const devices = await this.cloudClient.getBoundDevices();
        if (!devices.length) {
            throw new AnthbotGenieError('No Anthbot devices found for this account');
        }

        const seenSerials = new Set(devices.map(device => device.serialNumber));
        await this.removeStaleDeviceContexts(seenSerials);

        for (const device of devices) {
            const region = await this.resolveDeviceRegion(device);
            const existing = this.deviceContexts.get(device.serialNumber);
            const context = {
                device,
                region,
                shadowClient: new AnthbotShadowApiClient({
                    http: this.http,
                    serialNumber: device.serialNumber,
                    regionName: region.regionName,
                    iotEndpoint: region.iotEndpoint,
                    iotCredentials: region.iotCredentials,
                }),
                iotCredentials: region.iotCredentials,
                areaDefinition: existing?.areaDefinition || {},
                lastAreaTime: existing?.lastAreaTime || null,
                lastReported: existing?.lastReported || {},
                lastService: existing?.lastService || {},
            };
            this.deviceContexts.set(device.serialNumber, context);
            await this.ensureDeviceObjects(context);
        }
    }

    async resolveDeviceRegion(device) {
        let regionName = null;
        let iotEndpoint = null;
        let iotCredentials = null;

        try {
            const deviceRegion = await this.cloudClient.getDeviceRegion(device.serialNumber);
            regionName = deviceRegion.regionName;
            iotEndpoint = deviceRegion.iotEndpoint;
        } catch (error) {
            this.log.warn(
                `Failed to fetch region metadata for ${device.serialNumber}, using fallback discovery: ${error.message}`,
            );
        }

        try {
            const fallbackRegion = await this.cloudClient.getDevicePresignedRegion(device.serialNumber);
            if (fallbackRegion) {
                if (!regionName) {
                    regionName = fallbackRegion;
                }
                if (!iotEndpoint && !fallbackRegion.startsWith('cn')) {
                    iotEndpoint = AnthbotShadowApiClient.buildDefaultIotEndpointForRegion(fallbackRegion);
                } else if (iotEndpoint && !fallbackRegion.startsWith('cn')) {
                    const endpointRegion = AnthbotShadowApiClient.guessRegionFromEndpoint(iotEndpoint);
                    if (endpointRegion && endpointRegion !== fallbackRegion) {
                        regionName = fallbackRegion;
                        iotEndpoint = AnthbotShadowApiClient.buildDefaultIotEndpointForRegion(fallbackRegion);
                        this.log.debug(
                            `Overriding mismatched region metadata for ${device.serialNumber}: region=${regionName}, endpoint=${iotEndpoint}`,
                        );
                    }
                }
            }
        } catch (error) {
            this.log.debug(`Presigned region fallback failed for ${device.serialNumber}: ${error.message}`);
        }

        try {
            iotCredentials = await this.cloudClient.getDeviceIotCredentials(device.serialNumber);
            regionName = iotCredentials.regionName || regionName;
            iotEndpoint = iotCredentials.endpoint || iotEndpoint;
        } catch (error) {
            this.log.warn(
                `Failed to fetch temporary IoT credentials for ${device.serialNumber}, using bundled fallback credentials: ${error.message}`,
            );
        }

        return {
            serialNumber: device.serialNumber,
            regionName: regionName || AnthbotShadowApiClient.guessRegionFromEndpoint(iotEndpoint) || 'unknown',
            iotEndpoint,
            iotCredentials,
        };
    }

    async removeStaleDeviceContexts(seenSerials) {
        for (const serial of this.deviceContexts.keys()) {
            if (seenSerials.has(serial)) {
                continue;
            }
            this.deviceContexts.delete(serial);
            try {
                await this.delObjectAsync(serial, { recursive: true });
                this.log.info(`Removed stale device objects for ${serial}.`);
            } catch (error) {
                this.log.warn(`Failed to remove stale device objects for ${serial}: ${error.message}`);
            }
        }
    }

    async ensureDeviceObjects(context) {
        const serial = context.device.serialNumber;
        const root = serial;

        await this.extendObjectAsync(root, {
            type: 'device',
            common: {
                name: context.device.alias,
            },
            native: {
                serialNumber: serial,
            },
        });

        for (const [id, type, name] of getDeviceChannelDefinitions()) {
            await this.extendObjectAsync(`${root}.${id}`, {
                type,
                common: { name },
                native: {},
            });
        }

        for (const [suffix, common] of Object.entries(getDeviceStateDefinitions())) {
            await this.extendObjectAsync(`${root}.${suffix}`, {
                type: 'state',
                common,
                native: {},
            });
        }
    }

    async refreshDevice(context) {
        await this.ensureDeviceIotCredentials(context);
        const propertyState = await context.shadowClient.getShadowReportedState();
        let serviceState = {};
        try {
            serviceState = await context.shadowClient.getServiceReportedState();
        } catch (error) {
            this.log.debug(`Service shadow failed for ${context.device.serialNumber}: ${error.message}`);
        }

        const areaTime = typeof propertyState.area_time === 'string' ? propertyState.area_time : null;
        const shouldRefreshArea =
            !context.areaDefinition ||
            Object.keys(context.areaDefinition).length === 0 ||
            (areaTime && areaTime !== context.lastAreaTime);
        if (shouldRefreshArea) {
            try {
                context.areaDefinition = await this.cloudClient.getDeviceAreaDefinition(context.device.serialNumber);
                context.lastAreaTime = areaTime;
            } catch (error) {
                if (isLikelyAuthenticationError(error)) {
                    await this.ensureSession(true);
                    context.areaDefinition = await this.cloudClient.getDeviceAreaDefinition(
                        context.device.serialNumber,
                    );
                    context.lastAreaTime = areaTime;
                } else {
                    this.log.debug(
                        `Area definition refresh failed for ${context.device.serialNumber}: ${error.message}`,
                    );
                }
            }
        }

        context.lastReported = propertyState;
        context.lastService = serviceState;

        const merged = {
            ...propertyState,
            _service_reported: serviceState,
            _area_definition: context.areaDefinition || {},
        };
        await this.updateStates(context, merged);
    }

    async ensureDeviceIotCredentials(context) {
        if (
            context.iotCredentials &&
            (!context.iotCredentials.expiresAt || context.iotCredentials.expiresAt - Date.now() > 60000)
        ) {
            return;
        }
        const iotCredentials = await this.cloudClient.getDeviceIotCredentials(context.device.serialNumber);
        context.iotCredentials = iotCredentials;
        context.region = {
            ...context.region,
            regionName: iotCredentials.regionName || context.region.regionName,
            iotEndpoint: iotCredentials.endpoint || context.region.iotEndpoint,
            iotCredentials,
        };
        context.shadowClient = new AnthbotShadowApiClient({
            http: this.http,
            serialNumber: context.device.serialNumber,
            regionName: context.region.regionName,
            iotEndpoint: context.region.iotEndpoint,
            iotCredentials,
        });
    }

    async updateStates(context, data) {
        const serial = context.device.serialNumber;
        const config = this.anthbotConfig;
        const manualZoneList = manualZones(data);
        const autoZoneList = autoZones(data);
        const cutterHeight =
            typeof data?.param_set?.cutter_height === 'number'
                ? data.param_set.cutter_height
                : typeof data?.mow_remote?.cutter_height === 'number'
                  ? data.mow_remote.cutter_height
                  : null;
        const mowingTime = typeof data?.mowing_time_new?.value === 'number' ? data.mowing_time_new.value : null;
        const mowingArea = typeof data?.mowing_area_new?.value === 'number' ? data.mowing_area_new.value : null;
        const customDirection = typeof data?.param_set?.mow_head === 'number' ? data.param_set.mow_head : null;
        const rainContinueTime = typeof data.rain_continue_time === 'number' ? data.rain_continue_time : null;
        const rainPerceptionEnabled = coerceEnabledValue(data.rain_switch);
        const nearChargerMowingEnabled = coerceEnabledValue(safeGet(data, 'param_set', 'nest_switch'));
        const nearChargerSettings = this.nearChargerMowingSettings(data);
        const pointMow = data?.mow_point && typeof data.mow_point === 'object' ? data.mow_point : {};
        const rtkAntennaMoved = coerceEnabledValue(data?.rtk_move_sta?.value);
        const serviceCommand = typeof data?._service_reported?.cmd === 'string' ? data._service_reported.cmd : '';
        const pose = data?.pose && typeof data.pose === 'object' ? data.pose : {};
        const consumables = consumableLifetimes(data);

        const updates = {
            'info.alias': context.device.alias,
            'info.model': context.device.model,
            'info.region': context.region.regionName,
            'info.endpoint': context.shadowClient.iotEndpoint,
            'info.online': coerceEnabledValue(data.online),
            'info.charging': isCharging(data),
            'info.lastServiceCommand': serviceCommand,
            'info.lastPoll': new Date().toISOString(),

            // 2026-04-26: The cloud API misspells "percent" as "pecent" in the robot_maintenance object, so we need to use the wrong spelling here to get the data until it's fixed upstream.
            'consumable.chargingPort.life': consumables.chargingPort,
            'consumable.cameras.life': consumables.cameras,
            'consumable.blades.life': consumables.blades,

            'metrics.batteryLevel': typeof data.elec === 'number' ? data.elec : null,
            'metrics.status.mower': generalMowerStatus(data),
            'metrics.status.robotRaw': rawRobotStatus(data) || '',
            'metrics.mowing.time': mowingTime,
            'metrics.mowing.area': mowingArea,
            'metrics.mowing.borderActive': isNonZero(safeGet(data, 'mow_border', 'value')),
            'metrics.mowing.nearChargerActive': isNonZero(safeGet(data, 'mow_nest', 'value')),
            'metrics.mowing.fullYardActive': coerceEnabledValue(data.mow_full),
            'metrics.pointMowing.active': coerceEnabledValue(pointMow.sta),
            'metrics.pointMowing.x': typeof pointMow.x === 'number' ? pointMow.x : null,
            'metrics.pointMowing.y': typeof pointMow.y === 'number' ? pointMow.y : null,
            'metrics.zones.manualCount': manualZoneList.length,
            'metrics.zones.autoCount': autoZoneList.length,
            'metrics.map.totalArea': typeof data.map_area === 'number' ? data.map_area : null,
            'metrics.map.status': asText(safeGet(data, 'map_sta', 'value')),
            'metrics.error.code': asInteger(data.err_code),
            'metrics.error.description': asText(
                errorDescription(data, this.eventCodeCache, config.errorDescriptionLanguage || 'English'),
            ),
            'metrics.error.active': isNonZero(data.err_code),

            'location.gps.latitude':
                typeof safeGet(data, 'anti_loss_pose', 'posegps', 'lat') === 'number'
                    ? safeGet(data, 'anti_loss_pose', 'posegps', 'lat')
                    : null,
            'location.gps.longitude':
                typeof safeGet(data, 'anti_loss_pose', 'posegps', 'lon') === 'number'
                    ? safeGet(data, 'anti_loss_pose', 'posegps', 'lon')
                    : null,
            'location.pose.x': typeof pose.x === 'number' ? pose.x : null,
            'location.pose.y': typeof pose.y === 'number' ? pose.y : null,
            'location.pose.yaw': typeof pose.yaw === 'number' ? pose.yaw : null,
            'location.pose.type': asText(safeGet(data, 'anti_loss_pose', 'pose_type')),

            'diagnostics.rtk.state': asText(rtkStateLabel(data)),
            'diagnostics.rtk.baseState': asText(rtkBaseStateLabel(data)),
            'diagnostics.rtk.antennaMoved': rtkAntennaMoved,
            'diagnostics.rtk.baseFirmware': asText(safeGet(data, 'fw_version', 'rtk_base')),
            'diagnostics.cameraError': isNonZero(safeGet(data, 'camera_error_sta', 'value')),
            'diagnostics.network.wifiConnected': coerceEnabledValue(data.wifi_state),
            'diagnostics.network.cellularConnected': coerceEnabledValue(data['4g_state']),
            'diagnostics.network.cellularHeartbeat': coerceEnabledValue(data.heart_4g),
            'diagnostics.network.bluetoothActive': coerceEnabledValue(data.bt_state),
            'diagnostics.network.simPresent': coerceEnabledValue(safeGet(data, 'sim_status', 'status')),
            'diagnostics.network.wifiSsid': asText(data.sta_ssid),
            'diagnostics.network.ipAddress': asText(data.sta_ip_addr),
            'diagnostics.network.simCcid': asText(data['4g_ccid']),
            'diagnostics.mapAvailable': isNonZero(safeGet(data, 'has_map', 'value')),
            'diagnostics.accelerometerActive': coerceEnabledValue(safeGet(data, 'acc_sta', 'value')),
            'diagnostics.features.antiLossActive': coerceEnabledValue(data.anti_loss_switch),
            'diagnostics.features.edgeCutActive': coerceEnabledValue(data.edge_switch),
            'diagnostics.features.indoorModeActive': coerceEnabledValue(data.indoor_switch),
            'diagnostics.features.autoUpgradeActive': coerceEnabledValue(data.auto_upgrade),
            'diagnostics.features.obstacleAvoidanceActive': coerceEnabledValue(safeGet(data, 'pobctl', 'switch')),
            'diagnostics.features.obstacleAvoidanceLevel':
                typeof safeGet(data, 'pobctl', 'level') === 'number' ? safeGet(data, 'pobctl', 'level') : null,
            'diagnostics.features.drcActive': coerceEnabledValue(data.drc_switch),
            'diagnostics.features.logUploadActive': coerceEnabledValue(data.log_switch),
            'diagnostics.security.factoryResetPending': coerceEnabledValue(data.factory_reset),
            'diagnostics.security.unbindPending': coerceEnabledValue(data.user_unbind),
            'diagnostics.security.pinCode': asInteger(data.pin_code),
            'diagnostics.security.antiLossRadius': asInteger(data.anti_loss_radius),
            'diagnostics.system.eventCode': asInteger(data.event_code),
            'diagnostics.system.firmwareVersion': asText(safeGet(data, 'fw_version', 'system_version')),
            'diagnostics.system.mainBoardVersion': asText(safeGet(data, 'fw_version', 'main_board')),
            'diagnostics.system.extensionBoardVersion': asText(safeGet(data, 'fw_version', 'exten_board')),
            'diagnostics.system.protocolVersion': asText(data.protocol_version),
            'diagnostics.system.minimumAppVersion': asText(data.min_app_version),
            'diagnostics.system.voiceLanguage': asText(
                safeGet(data, 'voice_status', 'name') || safeGet(data, 'music_cfg', 'music_language'),
            ),
            'diagnostics.ota.progress':
                typeof safeGet(data, 'ota_status', 'ota_progress') === 'number'
                    ? safeGet(data, 'ota_status', 'ota_progress')
                    : null,
            'diagnostics.ota.state': asText(safeGet(data, 'ota_status', 'ota_state')),
            'diagnostics.ota.timeEstimate':
                typeof safeGet(data, 'ota_status', 'ota_time_estimate') === 'number'
                    ? safeGet(data, 'ota_status', 'ota_time_estimate')
                    : null,
            'diagnostics.time.shadowUpdated': asIsoTimestamp(data.timestamp) || '',
            'diagnostics.time.systemBoot': asIsoTimestamp(data.system_boot_time) || '',
            'diagnostics.time.mapUpdated': asIsoTimestamp(data.map_time) || '',
            'diagnostics.time.pathUpdated': asIsoTimestamp(data.path_time) || '',
            'diagnostics.time.areaUpdated': asIsoTimestamp(data.area_time) || '',
            'diagnostics.time.nextAppointment': asIsoTimestamp(data.appointment_time) || '',

            'controls.fullMapMowing.mowHeight': cutterHeight,
            'controls.fullMapMowing.includeEdgeTrimming': coerceEnabledValue(safeGet(data, 'param_set', 'rid_switch')),
            'controls.fullMapMowing.customMowingDirection': customDirection,
            'controls.fullMapMowing.customMowingDirectionEnabled': isCustomDirectionEnabled(data),
            'controls.zoneMowing.mowHeight': cutterHeight,
            'controls.zoneMowing.mowCount':
                typeof safeGet(data, 'param_set', 'mow_count') === 'number'
                    ? safeGet(data, 'param_set', 'mow_count')
                    : null,
            'controls.zoneMowing.customMowingDirection': customDirection,
            'controls.zoneMowing.customMowingDirectionEnabled': isCustomDirectionEnabled(data),
            'controls.zoneMowing.obstacleAvoidanceEnabled': coerceEnabledValue(safeGet(data, 'pobctl', 'switch')),
            'controls.zoneMowing.obstacleAvoidanceLevel':
                typeof safeGet(data, 'pobctl', 'level') === 'number' ? safeGet(data, 'pobctl', 'level') : null,
            'controls.voiceVolume': typeof data.volume === 'number' ? data.volume : null,
            'controls.rain.perceptionEnabled': rainPerceptionEnabled,
            'controls.rain.continueTimeHours':
                typeof rainContinueTime === 'number' ? Math.round(rainContinueTime / 3600) : null,
            'controls.nearChargerMowing.enabled': nearChargerMowingEnabled,
            'controls.nearChargerMowing.mowHeight': nearChargerSettings.cutter_height,
            'controls.nearChargerMowing.mowCount': nearChargerSettings.mow_count,
            'controls.nearChargerMowing.obstacleAvoidanceEnabled': coerceEnabledValue(
                nearChargerSettings.pobctl_switch,
            ),
            'controls.nearChargerMowing.obstacleAvoidanceLevel': nearChargerSettings.pobctl_level,
            'zones.manual.list': JSON.stringify(compactZonePayload(manualZoneList)),
            'zones.manual.activeIds': JSON.stringify(activeManualZoneIds(data)),
            'zones.autoList': JSON.stringify(compactZonePayload(autoZoneList)),

            'raw.shadow.property': JSON.stringify(context.lastReported || {}),
            'raw.shadow.service': JSON.stringify(context.lastService || {}),
            'raw.shadow.event-code': JSON.stringify(this.eventCodeCache || {}),
            'raw.areaDefinition': JSON.stringify(context.areaDefinition || {}),
        };

        for (const [suffix, value] of Object.entries(updates)) {
            await this.setStateAsync(`${serial}.${suffix}`, { val: value, ack: true });
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }

        const parts = id.replace(`${this.namespace}.`, '').split('.');
        if (parts.length < 3) {
            return;
        }

        const [serial, section, ...commandParts] = parts;
        const command = commandParts.join('.');
        const context = this.deviceContexts.get(serial);
        if (!context) {
            this.log.warn(`No device context for state ${id}`);
            return;
        }

        let commandError = null;
        try {
            if (section === 'commands') {
                await this.handleCommandState(context, command, state.val);
            } else if (section === 'controls') {
                await this.handleControlState(context, command, state.val);
            } else if (section === 'consumable') {
                await this.handleConsumableState(context, command, state.val);
            }
        } catch (error) {
            commandError = error;
        } finally {
            try {
                await this.refreshDevice(context);
            } catch (refreshError) {
                this.log.warn(`Post-command refresh failed for ${id}: ${refreshError.message}`);
            }
            await this.resetWriteState(id, section, command, context);
        }

        if (commandError) {
            this.log.error(`Command failed for ${id}: ${commandError.message}`);
        }
    }

    async resetWriteState(id, section, command, context) {
        if (
            (section === 'commands' && BOOLEAN_COMMANDS.includes(command)) ||
            (section === 'consumable' && Object.hasOwn(MAINTENANCE_RESET_TYPES, command))
        ) {
            await this.setStateAsync(id, { val: false, ack: true });
            return;
        }
        if (section === 'commands' && STRING_COMMANDS.includes(command)) {
            await this.setStateAsync(id, { val: '', ack: true });
            return;
        }
        if (section === 'controls') {
            const fallbackValue = this.getControlFallbackValue(context, command);
            if (fallbackValue !== undefined) {
                await this.setStateAsync(id, { val: fallbackValue, ack: true });
            }
        }
    }

    getControlFallbackValue(context, control) {
        const data = context.lastReported || {};
        if (control === 'fullMapMowing.mowHeight' || control === 'zoneMowing.mowHeight') {
            if (typeof data?.param_set?.cutter_height === 'number') {
                return data.param_set.cutter_height;
            }
            if (typeof data?.mow_remote?.cutter_height === 'number') {
                return data.mow_remote.cutter_height;
            }
            return null;
        }
        if (control === 'voiceVolume') {
            return typeof data.volume === 'number' ? data.volume : null;
        }
        if (control === 'fullMapMowing.customMowingDirection' || control === 'zoneMowing.customMowingDirection') {
            return typeof data?.param_set?.mow_head === 'number' ? data.param_set.mow_head : null;
        }
        if (control === 'fullMapMowing.includeEdgeTrimming') {
            return coerceEnabledValue(safeGet(data, 'param_set', 'rid_switch'));
        }
        if (
            control === 'fullMapMowing.customMowingDirectionEnabled' ||
            control === 'zoneMowing.customMowingDirectionEnabled'
        ) {
            return isCustomDirectionEnabled(data);
        }
        if (control === 'zoneMowing.mowCount') {
            return typeof data?.param_set?.mow_count === 'number' ? data.param_set.mow_count : null;
        }
        if (control === 'zoneMowing.obstacleAvoidanceEnabled') {
            return coerceEnabledValue(safeGet(data, 'pobctl', 'switch'));
        }
        if (control === 'zoneMowing.obstacleAvoidanceLevel') {
            return typeof safeGet(data, 'pobctl', 'level') === 'number' ? safeGet(data, 'pobctl', 'level') : null;
        }
        if (control === 'rain.perceptionEnabled') {
            return coerceEnabledValue(data.rain_switch);
        }
        if (control === 'rain.continueTimeHours') {
            return typeof data.rain_continue_time === 'number' ? Math.round(data.rain_continue_time / 3600) : null;
        }
        if (control === 'nearChargerMowing.enabled') {
            return coerceEnabledValue(safeGet(data, 'param_set', 'nest_switch'));
        }
        if (control === 'nearChargerMowing.mowHeight') {
            return this.nearChargerMowingSettings(data).cutter_height;
        }
        if (control === 'nearChargerMowing.mowCount') {
            return this.nearChargerMowingSettings(data).mow_count;
        }
        if (control === 'nearChargerMowing.obstacleAvoidanceEnabled') {
            return coerceEnabledValue(this.nearChargerMowingSettings(data).pobctl_switch);
        }
        if (control === 'nearChargerMowing.obstacleAvoidanceLevel') {
            return this.nearChargerMowingSettings(data).pobctl_level;
        }
        return undefined;
    }

    async handleCommandState(context, command, value) {
        const shouldRun =
            value === true || value === 1 || value === 'true' || (typeof value === 'string' && value.trim() !== '');
        if (!shouldRun) {
            return;
        }

        await this.ensureDeviceIotCredentials(context);
        const shouldRequestProperties = await this.executeCommand(context, command, value);
        if (shouldRequestProperties) {
            await context.shadowClient.requestAllProperties();
        }
        await this.delay(1000);
    }

    async handleControlState(context, control, value) {
        if (value === null || value === undefined || value === '') {
            return;
        }

        await this.ensureDeviceIotCredentials(context);
        await this.executeControl(context, control, value);
        await context.shadowClient.requestAllProperties();
        await this.delay(1000);
    }

    async handleConsumableState(context, command, value) {
        const shouldRun = value === true || value === 1 || value === 'true';
        if (!shouldRun) {
            return;
        }

        await this.ensureDeviceIotCredentials(context);
        await this.executeConsumableCommand(context, command);
        await this.delay(1000);
    }

    async executeCommand(context, command, value) {
        switch (command) {
            case 'device.find':
                await context.shadowClient.publishServiceCommand({ cmd: 'find_robot' });
                return true;
            case 'mowing.startFullMap':
                await context.shadowClient.publishServiceCommand({ cmd: 'app_state', data: 1 });
                await context.shadowClient.publishServiceCommand({ cmd: 'mow_start', data: 1 });
                return true;
            case 'mowing.pause':
                await context.shadowClient.publishServiceCommand({ cmd: 'mow_pause' });
                return true;
            case 'mowing.resume':
                await context.shadowClient.publishServiceCommand({ cmd: 'mow_continue' });
                return true;
            case 'mowing.stop':
                await context.shadowClient.publishServiceCommand({ cmd: 'stop_all_tasks', data: 1 });
                return true;
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
            case 'mowing.startPoint': {
                await context.shadowClient.publishServiceCommand({
                    cmd: 'mow_point',
                    data: this.parsePointMowValue(value),
                });
                return true;
            }
            case 'mowing.stopPoint':
                await context.shadowClient.publishServiceCommand({ cmd: 'mow_point_stop' });
                return true;
            case 'device.refresh':
                await context.shadowClient.requestAllProperties();
                return false;
            case 'mowing.startZone': {
                const matchedIds = this.resolveManualZoneSelection(context, value);
                if (!matchedIds.length) {
                    throw new AnthbotGenieError('No matching manual zones found');
                }
                await context.shadowClient.publishServiceCommand({
                    cmd: 'custom_area_mow_start',
                    data: { id: matchedIds },
                });
                return true;
            }
            case 'mowing.startAutoZone': {
                const points = this.resolveAutoZoneSelection(context, value);
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

    async executeConsumableCommand(context, command) {
        const robotMaintenance = MAINTENANCE_RESET_TYPES[command];

        if (robotMaintenance === undefined) {
            throw new AnthbotGenieError(`Unsupported consumable command '${command}'`);
        }

        await context.shadowClient.publishServiceCommand({
            cmd: 'robot_maintenance_reset',
            robot_maintenance: robotMaintenance,
        });
    }

    async executeControl(context, control, value) {
        const data = context.lastReported || {};

        switch (control) {
            case 'fullMapMowing.mowHeight':
            case 'zoneMowing.mowHeight': {
                const intValue = this.parseIntegerControlValue(value, {
                    label: 'Mow height',
                    min: 30,
                    max: 70,
                    step: 5,
                    suffix: 'in 5 mm steps',
                });
                await context.shadowClient.publishServiceCommand({
                    cmd: 'param_set',
                    data: { ...this.globalMowingSettings(data), cutter_height: intValue },
                });
                return;
            }
            case 'fullMapMowing.includeEdgeTrimming': {
                const enabled = coerceEnabledValue(value);
                await context.shadowClient.publishServiceCommand({
                    cmd: 'param_set',
                    data: { ...this.globalMowingSettings(data), rid_switch: enabled ? 1 : 0 },
                });
                return;
            }
            case 'voiceVolume': {
                const intValue = this.parseIntegerControlValue(value, {
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
                const intValue = this.parseIntegerControlValue(value, {
                    label: 'Custom mowing direction',
                    min: 0,
                    max: 180,
                });
                await context.shadowClient.publishServiceCommand({
                    cmd: 'param_set',
                    data: {
                        ...this.globalMowingSettings(data),
                        mow_head: intValue,
                        enable_adaptive_head: 0,
                    },
                });
                return;
            }
            case 'fullMapMowing.customMowingDirectionEnabled':
            case 'zoneMowing.customMowingDirectionEnabled': {
                const enabled = coerceEnabledValue(value);
                const mowHead = typeof data?.param_set?.mow_head === 'number' ? data.param_set.mow_head : 0;
                await context.shadowClient.publishServiceCommand({
                    cmd: 'param_set',
                    data: {
                        ...this.globalMowingSettings(data),
                        mow_head: mowHead,
                        enable_adaptive_head: enabled ? 0 : 1,
                    },
                });
                return;
            }
            case 'zoneMowing.mowCount': {
                const intValue = this.parseIntegerControlValue(value, {
                    label: 'Zone mow count',
                    min: 1,
                    max: 3,
                });
                await context.shadowClient.publishServiceCommand({
                    cmd: 'param_set',
                    data: { ...this.globalMowingSettings(data), mow_count: intValue },
                });
                return;
            }
            case 'zoneMowing.obstacleAvoidanceEnabled': {
                const enabled = coerceEnabledValue(value);
                await context.shadowClient.publishServiceCommand({
                    cmd: 'perception_obstacle_ctl',
                    data: {
                        switch: enabled ? 1 : 0,
                        level:
                            typeof safeGet(data, 'pobctl', 'level') === 'number' ? safeGet(data, 'pobctl', 'level') : 0,
                    },
                });
                return;
            }
            case 'zoneMowing.obstacleAvoidanceLevel': {
                const intValue = this.parseIntegerControlValue(value, {
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
                const enabled = coerceEnabledValue(value);
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
                const intValue = this.parseIntegerControlValue(value, {
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
                const enabled = coerceEnabledValue(value);
                await context.shadowClient.publishServiceCommand({
                    cmd: 'param_set',
                    data: { ...this.globalMowingSettings(data), nest_switch: enabled ? 1 : 0 },
                });
                return;
            }
            case 'nearChargerMowing.mowHeight': {
                const intValue = this.parseIntegerControlValue(value, {
                    label: 'Near charger mow height',
                    min: 30,
                    max: 70,
                    step: 5,
                    suffix: 'in 5 mm steps',
                });
                await context.shadowClient.publishServiceCommand({
                    cmd: 'nest_param_set',
                    data: { ...this.nearChargerMowingSettings(data, true), cutter_height: intValue },
                });
                return;
            }
            case 'nearChargerMowing.mowCount': {
                const intValue = this.parseIntegerControlValue(value, {
                    label: 'Near charger mow count',
                    min: 1,
                    max: 3,
                });
                await context.shadowClient.publishServiceCommand({
                    cmd: 'nest_param_set',
                    data: { ...this.nearChargerMowingSettings(data, true), mow_count: intValue },
                });
                return;
            }
            case 'nearChargerMowing.obstacleAvoidanceEnabled': {
                const enabled = coerceEnabledValue(value);
                await context.shadowClient.publishServiceCommand({
                    cmd: 'nest_param_set',
                    data: { ...this.nearChargerMowingSettings(data, true), pobctl_switch: enabled ? 1 : 0 },
                });
                return;
            }
            case 'nearChargerMowing.obstacleAvoidanceLevel': {
                const intValue = this.parseIntegerControlValue(value, {
                    label: 'Near charger obstacle avoidance level',
                    min: 0,
                    max: 2,
                });
                await context.shadowClient.publishServiceCommand({
                    cmd: 'nest_param_set',
                    data: { ...this.nearChargerMowingSettings(data, true), pobctl_level: intValue },
                });
                return;
            }
            default:
                throw new AnthbotGenieError(`Unsupported control '${control}'`);
        }
    }

    globalMowingSettings(data) {
        const settings = data?.param_set && typeof data.param_set === 'object' ? data.param_set : {};
        const result = {
            cutter_height: typeof settings.cutter_height === 'number' ? settings.cutter_height : 30,
            mow_count: typeof settings.mow_count === 'number' ? settings.mow_count : 1,
            mow_head: typeof settings.mow_head === 'number' ? settings.mow_head : 0,
            enable_adaptive_head: typeof settings.enable_adaptive_head === 'number' ? settings.enable_adaptive_head : 1,
        };
        if (typeof settings.rid_switch === 'number') {
            result.rid_switch = settings.rid_switch;
        }
        if (typeof settings.nest_switch === 'number') {
            result.nest_switch = settings.nest_switch;
        }
        return result;
    }

    nearChargerMowingSettings(data, withDefaults = false) {
        const settings = data?.nest_param_set && typeof data.nest_param_set === 'object' ? data.nest_param_set : {};
        return {
            cutter_height:
                typeof settings.cutter_height === 'number' ? settings.cutter_height : withDefaults ? 30 : null,
            mow_count: typeof settings.mow_count === 'number' ? settings.mow_count : withDefaults ? 2 : null,
            pobctl_level: typeof settings.pobctl_level === 'number' ? settings.pobctl_level : withDefaults ? 0 : null,
            pobctl_switch:
                typeof settings.pobctl_switch === 'number' ? settings.pobctl_switch : withDefaults ? 1 : null,
        };
    }

    parsePointMowValue(value) {
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

        const x = Array.isArray(parsed) ? parsed[0] : parsed?.x;
        const y = Array.isArray(parsed) ? parsed[1] : parsed?.y;
        const point = {
            x: Math.round(Number(x)),
            y: Math.round(Number(y)),
        };

        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            throw new AnthbotGenieError('Point mow must be "x,y" or {"x":number,"y":number}');
        }
        return point;
    }

    parseIntegerControlValue(value, { label, min, max, step = 1, suffix = '' }) {
        const intValue = Math.round(Number(value));
        const invalidStep = step > 1 && intValue % step !== 0;
        if (!Number.isFinite(intValue) || intValue < min || intValue > max || invalidStep) {
            const rangeText = `${min}..${max}`;
            const suffixText = suffix ? ` ${suffix}` : '';
            throw new AnthbotGenieError(`${label} must be ${rangeText}${suffixText}`);
        }
        return intValue;
    }

    resolveManualZoneSelection(context, value) {
        const wanted = parseCommandSelection(value);
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

    resolveAutoZoneSelection(context, value) {
        const wanted = parseCommandSelection(value);
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
                    typeof zone.name === 'string' &&
                    zone.name.trim().toLowerCase() === String(item).trim().toLowerCase();
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

    delay(ms) {
        return new Promise(resolve => this.setTimeout(resolve, ms));
    }
}

if (require.main !== module) {
    module.exports = options => new AnthbotGenieAdapter(options);
} else {
    new AnthbotGenieAdapter();
}
