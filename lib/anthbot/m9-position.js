'use strict';

const { decodeCurpath } = require('./curpath');
const { evaluatePathHealth } = require('./m9-map-health');

const ACTIVE_STATUSES = new Set([
    'mowing',
    'returning_to_dock',
    'mapping',
    'positioning',
    'resuming',
    'remote_control',
    'going_to_target',
]);

function propertyPose(data) {
    const candidates = [data?.pose, data?.anti_loss_pose?.pose2d];

    for (const pose of candidates) {
        if (
            pose &&
            typeof pose === 'object' &&
            typeof pose.x === 'number' &&
            typeof pose.y === 'number'
        ) {
            return {
                x: pose.x,
                y: pose.y,
                ...(typeof pose.yaw === 'number' ? { yaw: pose.yaw } : {}),
            };
        }
    }

    return null;
}

/**
 * Returns the fixed charging-station coordinate used by the official MGSMapView.
 *
 * Reverse engineering result:
 * - The native map view owns a field `j0` of type map point.
 * - `j0` is constructed with the default point constructor and is never
 *   overwritten by a shadow property.
 * - The native renderer always draws the dock at `j0`.
 * - While mode is `charge`, it also forces the robot pose to `j0`.
 *
 * The map's coordinate origin therefore is the charging station.
 *
 * @returns {{x: number, y: number, yaw: number}}
 */
function dockPose() {
    return {
        x: 0,
        y: 0,
        yaw: 0,
    };
}

/**
 * @param {{lastPoint?: object|null, heading?: number|null}} path
 * @returns {{x:number,y:number,yaw?:number}|null}
 */
function pathPose(path) {
    if (!path?.lastPoint) {
        return null;
    }

    return {
        x: path.lastPoint.xMetres,
        y: path.lastPoint.yMetres,
        ...(typeof path.heading === 'number' ? { yaw: path.heading } : {}),
    };
}

/**
 * Selects the map position.
 *
 * M9 behaviour used here:
 * - Active movement: fresh curpath is the live position.
 * - Pause/stop/standby: retain the last usable curpath position.
 * - Charging: use the fixed map origin (0/0), matching the official app.
 * - anti_loss_pose is diagnostic/fallback data, not the normal map position.
 *
 * @param {object} data
 * @param {string} mowerStatus
 * @param {number} [now]
 */
function selectM9Position(data, mowerStatus, now = Date.now()) {
    const fallbackPose = propertyPose(data);
    const fixedDockPose = dockPose();
    /** @type {any} */
    let path;
    let decodeError = '';

    try {
        path = decodeCurpath(typeof data?.curpath?.value === 'string' ? data.curpath.value : '');
    } catch (error) {
        decodeError = error?.message || String(error);
        path = { points: [], lastPoint: null, heading: null, header: {} };
    }

    const pathHealth = evaluatePathHealth(data, path, now);
    const active = ACTIVE_STATUSES.has(mowerStatus);
    const decodedPathPose = pathPose(path);

    if (active && pathHealth.fresh && decodedPathPose) {
        return {
            pose: decodedPathPose,
            source: 'curpath-live',
            path,
            pathHealth,
            propertyPose: fallbackPose,
            dockPose: fixedDockPose,
            decodeError,
        };
    }

    if (mowerStatus === 'charging' && fixedDockPose) {
        return {
            pose: fixedDockPose,
            source: 'dock-position-charging',
            path,
            pathHealth,
            propertyPose: fallbackPose,
            dockPose: fixedDockPose,
            decodeError,
        };
    }

    if (pathHealth.usable && decodedPathPose) {
        return {
            pose: decodedPathPose,
            source: pathHealth.fresh ? 'curpath-current' : 'curpath-last-known',
            path,
            pathHealth,
            propertyPose: fallbackPose,
            dockPose: fixedDockPose,
            decodeError,
        };
    }

    if (fixedDockPose && mowerStatus === 'charging') {
        return {
            pose: fixedDockPose,
            source: 'dock-position-charging',
            path,
            pathHealth,
            propertyPose: fallbackPose,
            dockPose: fixedDockPose,
            decodeError,
        };
    }

    if (fallbackPose) {
        return {
            pose: fallbackPose,
            source: active ? 'property-pose-active-fallback' : 'property-pose-fallback',
            path,
            pathHealth,
            propertyPose: fallbackPose,
            dockPose: fixedDockPose,
            decodeError,
        };
    }

    return {
        pose: null,
        source: 'none',
        path,
        pathHealth,
        propertyPose: null,
        dockPose: fixedDockPose,
        decodeError,
    };
}

module.exports = {
    ACTIVE_STATUSES,
    dockPose,
    pathPose,
    propertyPose,
    selectM9Position,
};
