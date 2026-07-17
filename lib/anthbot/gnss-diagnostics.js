'use strict';

const { asInteger, safeGet } = require('./utils');

const KEY_PATTERN = /(gps|gnss|rtk|sat|position|pos_|posegps|hdop|pdop|accuracy|fix)/i;
const ROBOT_PATH_PATTERN = /(robot|mower|host|pose|position|anti_loss|pos_|gnss|gps)/i;
const BASE_PATH_PATTERN = /(base|station|netrtk|ctl_rtk|rtk_base|pos_board)/i;

function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
}

function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asText(value) {
    return value == null ? '' : String(value);
}

function normalizeFix(value) {
    if (value == null || value === '') return 'unknown';
    if (typeof value === 'boolean') return value ? 'fixed' : 'lost';

    const text = String(value).trim().toLowerCase();
    const numeric = asInteger(value);

    if (['fixed', 'fix', 'rtk_fixed', 'strong', 'good', 'ok', 'valid'].includes(text)) return 'fixed';
    if (['float', 'rtk_float', 'medium', 'weak'].includes(text)) return 'float';
    if (['lost', 'none', 'invalid', 'offline', 'no_fix', 'nofix', 'disconnected'].includes(text)) return 'lost';

    // Numeric Anthbot status codes are not interpreted generically. The same
    // number is used by different RTK/GNSS objects with different meanings.
    // Keep numeric values unknown until the app/protocol mapping is proven.
    if (numeric !== null) return `unknown (${numeric})`;
    return text || 'unknown';
}


function normalizeRobotFix(value) {
    const numeric = asInteger(value);
    // These mappings are only applied to explicit robot positioning fields
    // such as pos_status.
    if (numeric === 3) return 'fixed';
    if (numeric === 2) return 'float';
    if (numeric === 0) return 'lost';
    return normalizeFix(value);
}

function normalizeMowerRtkState(value) {
    const numeric = asInteger(value);
    // rtk.state is used by the app in a specific setup gate, but field tests
    // show that its numeric value does not reliably match the mower's visible
    // GPS LED during normal operation. Therefore it must not be interpreted as
    // Kevin's live GNSS fix. Keep the raw code visible without claiming a fix.
    if (numeric === 1) return 'positioning active (code 1)';
    if (numeric !== null) return `status code ${numeric}`;
    return normalizeFix(value);
}

function walkCandidates(value, path = '', output = {}, depth = 0) {
    if (depth > 7 || value == null) return output;
    if (Array.isArray(value)) {
        value.slice(0, 30).forEach((entry, index) => walkCandidates(entry, `${path}[${index}]`, output, depth + 1));
        return output;
    }
    if (typeof value !== 'object') {
        if (KEY_PATTERN.test(path)) output[path] = value;
        return output;
    }

    for (const [key, entry] of Object.entries(value)) {
        if (key.startsWith('_') && !['_service_reported'].includes(key)) continue;
        const nextPath = path ? `${path}.${key}` : key;
        if (entry == null || typeof entry !== 'object') {
            if (KEY_PATTERN.test(nextPath)) output[nextPath] = entry;
        } else {
            walkCandidates(entry, nextPath, output, depth + 1);
        }
    }
    return output;
}

function selectCandidate(candidates, patterns, preferBase) {
    for (const pattern of patterns) {
        const exact = Object.entries(candidates).find(([path]) => pattern.test(path));
        if (!exact) continue;
        const path = exact[0];
        const isBase = BASE_PATH_PATTERN.test(path);
        if (preferBase === true && isBase) return exact[1];
        if (preferBase === false && !isBase && ROBOT_PATH_PATTERN.test(path)) return exact[1];
    }
    return null;
}

function extractGnssDiagnostics(data, context = {}, now = new Date()) {
    const candidates = walkCandidates(data);

    const explicitRobotStatus = firstDefined(
        safeGet(data, 'gnss', 'status'),
        safeGet(data, 'gps', 'status'),
        safeGet(data, 'positioning', 'status'),
        safeGet(data, 'pos_status'),
        safeGet(data, 'anti_loss_pose', 'pos_status'),
        selectCandidate(candidates, [/\.(?:pos_status|positioning_status|gps_status|gnss_status)$/i], false),
    );
    const mowerRtkState = safeGet(data, 'rtk', 'state');
    const robotRawStatus = firstDefined(explicitRobotStatus, mowerRtkState);
    const robotFix = explicitRobotStatus !== undefined && explicitRobotStatus !== null && explicitRobotStatus !== ''
        ? normalizeRobotFix(explicitRobotStatus)
        : normalizeMowerRtkState(mowerRtkState);
    const robotSatellites = asNumber(firstDefined(
        safeGet(data, 'gnss', 'satellites'),
        safeGet(data, 'gnss', 'satellite_count'),
        safeGet(data, 'gps', 'satellites'),
        safeGet(data, 'positioning', 'satellites'),
        safeGet(data, 'anti_loss_pose', 'satellites'),
        data?.satellite_num,
        data?.sat_num,
        selectCandidate(candidates, [/(?:robot|mower|host|gnss|gps|pose).*sat/i, /(?:^|\.)sat(?:ellite)?_?(?:num|count|s)$/i], false),
    ));
    const robotAccuracy = asNumber(firstDefined(
        safeGet(data, 'gnss', 'accuracy'), safeGet(data, 'gps', 'accuracy'), safeGet(data, 'positioning', 'accuracy'),
        safeGet(data, 'anti_loss_pose', 'accuracy'), data?.pos_accuracy,
        selectCandidate(candidates, [/(?:robot|mower|host|gnss|gps|pose).*accuracy/i], false),
    ));
    const robotHdop = asNumber(firstDefined(safeGet(data, 'gnss', 'hdop'), safeGet(data, 'gps', 'hdop'), data?.hdop));
    const robotPdop = asNumber(firstDefined(safeGet(data, 'gnss', 'pdop'), safeGet(data, 'gps', 'pdop'), data?.pdop));
    const robotSource = asText(firstDefined(
        safeGet(data, 'gnss', 'source'), safeGet(data, 'gps', 'source'), data?.pos_source,
        safeGet(data, 'anti_loss_pose', 'pose_type'), context?.lastPositionSource,
    ));

    const baseRawStatus = firstDefined(
        safeGet(data, 'ctl_rtk_base', 'positioning_status'),
        safeGet(data, 'ctl_rtk_base', 'pos_status'),
        safeGet(data, 'netrtk', 'positioning_status'),
        safeGet(data, 'rtk_base', 'status'),
        selectCandidate(candidates, [/(?:ctl_rtk|rtk_base|netrtk|base|station).*?(?:pos|positioning|rtk).*status/i], true),
    );
    const baseFix = normalizeFix(baseRawStatus);
    const explicitRtkInfo = data?._rtk_satellite_info;
    const baseSatellites = asNumber(firstDefined(
        explicitRtkInfo?.satelliteCount,
        safeGet(data, 'ctl_rtk_base', 'satellites'),
        safeGet(data, 'ctl_rtk_base', 'satellite_count'),
        safeGet(data, 'netrtk', 'satellites'),
        safeGet(data, 'rtk_base', 'satellites'),
        selectCandidate(candidates, [/(?:ctl_rtk|rtk_base|netrtk|base|station).*sat/i], true),
    ));
    const baseSource = asText(firstDefined(
        explicitRtkInfo ? 'rtk_base_info.bin' : null,
        safeGet(data, 'ctl_rtk_base', 'signal_source'), safeGet(data, 'netrtk', 'signal_source'),
        safeGet(data, 'rtk_base', 'source'), selectCandidate(candidates, [/(?:base|station|netrtk|ctl_rtk).*source/i], true),
    ));

    const poseFresh = Boolean(context?.positionFresh);
    const mowerActive = Boolean(context?.mowerActive);
    const odometryLikely = mowerActive && poseFresh && robotFix !== 'fixed';

    let overall = 'unknown';
    let message = 'No separate GNSS quality values for Kevin were found in the current payload.';
    if (robotFix === 'fixed') {
        overall = 'ok';
        message = 'Kevin reports an RTK/GNSS fix.';
    } else if (robotFix === 'float') {
        overall = 'warning';
        message = 'Kevin reports RTK float or reduced positioning quality.';
    } else if (robotFix === 'lost') {
        overall = 'error';
        message = odometryLikely
            ? 'Kevin has no GNSS fix, but fresh movement data suggests temporary navigation by sensors/odometry.'
            : 'Kevin reports no GNSS fix.';
    } else if (robotFix === 'positioning active (code 1)') {
        overall = 'ok';
        message = 'Kevin reports active RTK positioning (raw code 1). A separate satellite count is not transmitted in this data stream.';
    } else if (String(robotFix).startsWith('unknown') || String(robotFix).startsWith('status code')) {
        overall = 'unknown';
        message = 'Kevin provides only a numeric RTK status in this payload. The raw code is shown without guessing a GNSS fix.';
    } else if (baseFix === 'fixed') {
        overall = 'warning';
        message = 'The RTK base reports a good state, but Kevin does not expose a confirmed GNSS fix in this payload.';
    }

    return {
        robot: {
            fix: robotFix,
            rawStatus: asText(robotRawStatus),
            satellites: robotSatellites,
            accuracy: robotAccuracy,
            hdop: robotHdop,
            pdop: robotPdop,
            source: robotSource,
        },
        base: {
            fix: baseFix,
            rawStatus: asText(baseRawStatus),
            satellites: baseSatellites,
            source: baseSource,
        },
        assessment: { overall, message, odometryLikely },
        candidates,
        updatedAt: now.toISOString(),
    };
}

module.exports = { extractGnssDiagnostics, normalizeFix, walkCandidates };
