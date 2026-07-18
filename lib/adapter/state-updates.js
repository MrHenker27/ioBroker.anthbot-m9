'use strict';

const {
    activeManualZoneIds,
    autoZones,
    batteryLevel,
    compactZonePayload,
    consumableLifetimes,
    errorCode,
    errorDescription,
    generalMowerStatus,
    ipAddress,
    isCharging,
    isCustomDirectionEnabled,
    manualZones,
    mapArea,
    mappingTaskState,
    nearChargerMowingSettings,
    rawModeStatus,
    rawRobotStatus,
    rtkBaseStateLabel,
    rtkStateLabel,
    simCcid,
    simPresent,
    totalMowingArea,
    totalMowingTime,
    wifiSsid,
} = require('../anthbot/payload');
const { asInteger, asIsoTimestamp, coerceEnabledValue, isNonZero, safeGet } = require('../anthbot/utils');
const { buildZoneOptions } = require('../anthbot/zone-selection');
const { buildM9Svg } = require('../anthbot/m9-svg');
const { selectM9Position } = require('../anthbot/m9-position');
const { evaluateMapHealth } = require('../anthbot/m9-map-health');
const { mapDebugInfo } = require('../anthbot/map-debug');
const { updateTrackHistory } = require('../anthbot/m9-track-history');
const { extractGnssDiagnostics } = require('../anthbot/gnss-diagnostics');
const { normalizeRtkSatellites, renderRtkSkyplot } = require('../anthbot/rtk-skyplot');
const { stableStringify } = require('../anthbot/stable-json');

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
    return value == null ? '' : String(value);
}

/**
 * @param {{
 * context: object,
 * data: object,
 * eventCodeCache: object|null,
 * errorDescriptionLanguage: string,
 * now: Date,
 * }} params
 * @returns {Record<string, ioBroker.StateValue>}
 */
function buildDeviceStateUpdates({ context, data, eventCodeCache, errorDescriptionLanguage, now }) {
    const manualZoneList = manualZones(data);
    const rtkSatellites = normalizeRtkSatellites(data?._rtk_satellite_info?.satellites || []);
    const autoZoneList = autoZones(data);
    const zoneOptions = buildZoneOptions(data);
    const activeZoneIds = activeManualZoneIds(data);
    const mowerStatus = generalMowerStatus(data);
    const currentBattery = batteryLevel(data);
    const currentErrorDescription = asText(
        errorDescription(data, eventCodeCache, errorDescriptionLanguage || 'English'),
    );
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
    const nearChargerMowingEnabled = coerceEnabledValue(
        data?.nest_switch !== undefined ? data.nest_switch : safeGet(data, 'param_set', 'nest_switch'),
    );
    const nearChargerSettings = nearChargerMowingSettings(data);
    const pointMow = data?.mow_point && typeof data.mow_point === 'object' ? data.mow_point : {};
    const rtkAntennaMoved = coerceEnabledValue(data?.rtk_move_sta?.value);
    const serviceCommand = typeof data?._service_reported?.cmd === 'string' ? data._service_reported.cmd : '';
    const position = selectM9Position(data, mowerStatus, now.getTime());
    const pose = /** @type {{ x?: number, y?: number, yaw?: number }} */ (position.pose || {});

    if (
        position.dockPose &&
        typeof position.dockPose.x === 'number' &&
        typeof position.dockPose.y === 'number'
    ) {
        context.dockPose = { ...position.dockPose };
    }

    const consumables = consumableLifetimes(data);
    const mapData = context.mapData || {};
    const mapHealth = evaluateMapHealth(mapData);
    const pathHistory = updateTrackHistory(context, position.path, data);
    const gnss = extractGnssDiagnostics(data, {
        mowerActive: ['mowing', 'mapping', 'returning', 'remote_control'].includes(mowerStatus),
        positionFresh: Boolean(position.pathHealth?.fresh || position.pose),
        lastPositionSource: position.source,
    }, now);
    const debugInfo = mapDebugInfo({
        mapData,
        areaDefinition: context.areaDefinition || {},
        position,
        dockPose: context.dockPose || null,
        mowerStatus,
        activeZoneIds,
    });

    let mapSvg = typeof context.lastMapSvg === 'string' ? context.lastMapSvg : '';
    let mapRenderError = '';

    try {
        const renderedMapSvg = buildM9Svg(mapData, {
            areaDefinition: context.areaDefinition || {},
            pose: position.pose,
            dockPose: context.dockPose || null,
            path: { points: pathHistory.points },
            layers: context.mapLayers || {},
            debug: Boolean(context.mapDebug),
            debugInfo,
        });

        if (renderedMapSvg) {
            mapSvg = renderedMapSvg;
            context.lastMapSvg = renderedMapSvg;
        }
    } catch (error) {
        mapRenderError = error?.message || String(error);
    }

    return {
        'info.alias': context.device.alias,
        'info.model': context.device.model,
        'info.region': context.region.regionName,
        'info.endpoint': context.shadowClient.iotEndpoint,
        'info.online': coerceEnabledValue(data.online),
        'info.charging': isCharging(data),
        'info.lastServiceCommand': serviceCommand,
        'info.lastPoll': now.toISOString(),

        'consumable.chargingPort.life': consumables.chargingPort,
        'consumable.cameras.life': consumables.cameras,
        'consumable.blades.life': consumables.blades,

        'metrics.batteryLevel': currentBattery,
        'metrics.status.mower': mowerStatus,
        'metrics.status.robotRaw': rawRobotStatus(data) || '',
        'metrics.status.modeRaw': rawModeStatus(data) || '',
        'metrics.mowing.time': mowingTime,
        'metrics.mowing.area': mowingArea,
        'metrics.mowing.totalTime': totalMowingTime(data),
        'metrics.mowing.totalArea': totalMowingArea(data),
        'metrics.mowing.borderActive': isNonZero(safeGet(data, 'mow_border', 'value')),
        'metrics.mowing.nearChargerActive': isNonZero(safeGet(data, 'mow_nest', 'value')),
        'metrics.mowing.fullYardActive': coerceEnabledValue(data.mow_full),
        'metrics.pointMowing.active': coerceEnabledValue(pointMow.sta),
        'metrics.pointMowing.x': typeof pointMow.x === 'number' ? pointMow.x : null,
        'metrics.pointMowing.y': typeof pointMow.y === 'number' ? pointMow.y : null,
        'metrics.zones.manualCount': manualZoneList.length,
        'metrics.zones.autoCount': autoZoneList.length,
        'metrics.map.totalArea': mapArea(data),
        'metrics.map.status': asText(safeGet(data, 'map_sta', 'value')),
        'metrics.map.mappingTaskState': mappingTaskState(data) || '',
        'metrics.error.code': errorCode(data),
        'metrics.error.description': currentErrorDescription,
        'metrics.error.active': isNonZero(errorCode(data)),

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
        'location.pose.source': position.source,
        'location.pose.valid': Boolean(position.pose),

        'map.svg': mapSvg,
        'map.info': JSON.stringify(mapData.mapInfo || {}),
        'map.contours': JSON.stringify(mapData.contours || []),
        'map.path': JSON.stringify(pathHistory.points || []),
        'map.position': JSON.stringify(position.pose || {}),
        'map.debug.info': JSON.stringify(debugInfo),
        'map.export.svgPath': context.mapExport?.svgPath || '',
        'map.export.pngPath': context.mapExport?.pngPath || '',
        'map.export.lastResult': JSON.stringify(context.mapExport || {}),
        'map.export.lastTimestamp': context.mapExport?.timestamp || '',

        'diagnostics.mqtt.connected': Boolean(context.mqttStatus?.connected),
        'diagnostics.mqtt.state': asText(context.mqttStatus?.state),
        'diagnostics.mqtt.lastMessage': asText(context.mqttStatus?.lastMessageAt),
        'diagnostics.mqtt.lastError': asText(context.mqttStatus?.lastError),
        'diagnostics.mqtt.reconnectCount': asInteger(context.mqttStatus?.reconnectCount) || 0,

        'diagnostics.map.available': mapHealth.available,
        'diagnostics.map.contourCount': mapHealth.contourCount,
        'diagnostics.map.validContourCount': mapHealth.validContourCount,
        'diagnostics.map.mapId': mapHealth.mapId,
        'diagnostics.map.renderError': mapRenderError,
        'diagnostics.map.pathFresh': position.pathHealth.fresh,
        'diagnostics.map.pathUsable': position.pathHealth.usable,
        'diagnostics.map.pathAgeSeconds':
            typeof position.pathHealth.ageMs === 'number'
                ? Math.round(position.pathHealth.ageMs / 1000)
                : null,
        'diagnostics.map.pathPointCount': position.pathHealth.pointCount,
        'diagnostics.map.pathReason': position.pathHealth.reason,
        'diagnostics.map.pathDecodeError': position.decodeError,

        'diagnostics.gnss.robot.fix': gnss.robot.fix,
        'diagnostics.gnss.robot.rawStatus': gnss.robot.rawStatus,
        'diagnostics.gnss.robot.satellites': gnss.robot.satellites,
        'diagnostics.gnss.robot.accuracy': gnss.robot.accuracy,
        'diagnostics.gnss.robot.hdop': gnss.robot.hdop,
        'diagnostics.gnss.robot.pdop': gnss.robot.pdop,
        'diagnostics.gnss.robot.source': gnss.robot.source,
        'diagnostics.gnss.base.fix': gnss.base.fix,
        'diagnostics.gnss.base.rawStatus': gnss.base.rawStatus,
        'diagnostics.gnss.base.satellites': gnss.base.satellites,
        'diagnostics.gnss.base.source': gnss.base.source,
        'diagnostics.gnss.base.satelliteList': stableStringify(rtkSatellites),
        'diagnostics.gnss.base.skyplotSvg': renderRtkSkyplot(rtkSatellites),
        'diagnostics.gnss.assessment.overall': gnss.assessment.overall,
        'diagnostics.gnss.assessment.message': gnss.assessment.message,
        'diagnostics.gnss.assessment.odometryLikely': gnss.assessment.odometryLikely,
        'diagnostics.gnss.lastUpdate': gnss.updatedAt,
        'diagnostics.gnss.rawCandidates': JSON.stringify(gnss.candidates),

        'diagnostics.rtk.state': asText(rtkStateLabel(data)),
        'diagnostics.rtk.baseState': asText(rtkBaseStateLabel(data)),
        'diagnostics.rtk.antennaMoved': rtkAntennaMoved,
        'diagnostics.rtk.baseFirmware': asText(safeGet(data, 'fw_version', 'rtk_base')),
        'diagnostics.cameraError': isNonZero(safeGet(data, 'camera_error_sta', 'value')),
        'diagnostics.network.wifiConnected': coerceEnabledValue(data.wifi_state),
        'diagnostics.network.cellularConnected': coerceEnabledValue(data['4g_state']),
        'diagnostics.network.cellularHeartbeat': coerceEnabledValue(data.heart_4g),
        'diagnostics.network.bluetoothActive': coerceEnabledValue(data.bt_state),
        'diagnostics.network.simPresent': simPresent(data),
        'diagnostics.network.wifiSsid': asText(wifiSsid(data)),
        'diagnostics.network.ipAddress': asText(ipAddress(data)),
        'diagnostics.network.simCcid': asText(simCcid(data)),
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
        'controls.nearChargerMowing.obstacleAvoidanceEnabled': coerceEnabledValue(nearChargerSettings.pobctl_switch),
        'controls.nearChargerMowing.obstacleAvoidanceLevel': nearChargerSettings.pobctl_level,
        'dashboard.battery': currentBattery,
        'dashboard.status': mowerStatus,
        'dashboard.charging': isCharging(data),
        'dashboard.currentArea': mowingArea,
        'dashboard.currentTime': mowingTime,
        'dashboard.error': currentErrorDescription,

        'controls.map.showManualZones': Boolean(context.mapLayers?.showManualZones),
        'controls.map.showAutoZones': Boolean(context.mapLayers?.showAutoZones),
        'controls.map.showNoGoZones': context.mapLayers?.showNoGoZones !== false,
        'controls.map.showPaths': context.mapLayers?.showPaths !== false,
        'controls.map.showCurrentTrack': context.mapLayers?.showCurrentTrack !== false,
        'controls.map.showLegend': Boolean(context.mapLayers?.showLegend),
        'controls.map.debug': Boolean(context.mapDebug),
        'controls.zoneSelection.selected': context.zoneSelection?.selected || '',
        'zones.options': JSON.stringify(zoneOptions.all),
        'zones.manual.options': JSON.stringify(zoneOptions.manual),
        'zones.auto.options': JSON.stringify(zoneOptions.auto),
        'zones.selection.current': context.zoneSelection?.selected || '',
        'zones.selection.lastResult': JSON.stringify(context.zoneSelection?.lastResult || {}),
        'zones.manual.list': JSON.stringify(compactZonePayload(manualZoneList)),
        'zones.manual.activeIds': JSON.stringify(activeZoneIds),
        'zones.autoList': JSON.stringify(compactZonePayload(autoZoneList)),

        'raw.shadow.property': stableStringify(context.lastReported || {}),
        'raw.shadow.service': JSON.stringify(context.lastService || {}),
        'raw.areaDefinition': JSON.stringify(context.areaDefinition || {}),
    };
}

/**
 * @param {object} data
 * @param {string} control
 * @returns {ioBroker.StateValue|undefined}
 */
function getControlFallbackValue(data, control, context = null) {
    if (control === 'map.debug') {
        return Boolean(context?.mapDebug);
    }
    if (control === 'zoneSelection.selected') {
        return context?.zoneSelection?.selected || '';
    }
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
        return coerceEnabledValue(
            data?.nest_switch !== undefined ? data.nest_switch : safeGet(data, 'param_set', 'nest_switch'),
        );
    }
    if (control === 'nearChargerMowing.mowHeight') {
        return nearChargerMowingSettings(data).cutter_height;
    }
    if (control === 'nearChargerMowing.mowCount') {
        return nearChargerMowingSettings(data).mow_count;
    }
    if (control === 'nearChargerMowing.obstacleAvoidanceEnabled') {
        return coerceEnabledValue(nearChargerMowingSettings(data).pobctl_switch);
    }
    if (control === 'nearChargerMowing.obstacleAvoidanceLevel') {
        return nearChargerMowingSettings(data).pobctl_level;
    }
    return undefined;
}

module.exports = {
    buildDeviceStateUpdates,
    getControlFallbackValue,
};
