"use strict";

const assert = require("node:assert/strict");

const {
    activeManualZoneIds,
    asInteger,
    asIsoTimestamp,
    batteryLevel,
    buildNestMowParamsPayload,
    buildParamSetPayload,
    autoZones,
    compactZonePayload,
    coerceEnabledValue,
    consumableLifetimes,
    errorCode,
    errorDescription,
    generalMowerStatus,
    ipAddress,
    isCharging,
    isCustomDirectionEnabled,
    isLikelyAuthenticationError,
    isMSeriesModel,
    isNonZero,
    mapArea,
    manualZones,
    mappingTaskState,
    parseCommandSelection,
    rawModeStatus,
    rawRobotStatus,
    rtkBaseStateLabel,
    rtkStateLabel,
    safeGet,
    simCcid,
    simPresent,
    totalMowingArea,
    totalMowingTime,
    wifiSsid,
} = require("../../../lib/anthbot");

describe("lib/anthbot utils and payload helpers", () => {
    describe("value coercion", () => {
        it("reads nested object values safely", () => {
            assert.equal(safeGet({ a: { b: 3 } }, "a", "b"), 3);
            assert.equal(safeGet({ a: null }, "a", "b"), undefined);
            assert.equal(safeGet({ a: [] }, "a", "b"), undefined);
        });

        it("converts supported values to integers", () => {
            assert.equal(asInteger(true), 1);
            assert.equal(asInteger(12.9), 12);
            assert.equal(asInteger(" 42mm "), 42);
            assert.equal(asInteger("not a number"), null);
        });

        it("normalizes Anthbot timestamps", () => {
            assert.equal(asIsoTimestamp(1711974896), "2024-04-01T12:34:56.000Z");
            assert.equal(asIsoTimestamp("20260428153045"), "2026-04-28T15:30:45.000Z");
            assert.equal(asIsoTimestamp(0), null);
        });

        it("handles boolean-like values used by cloud payloads", () => {
            assert.equal(isNonZero("1"), true);
            assert.equal(isNonZero("0"), false);
            assert.equal(coerceEnabledValue("enabled"), true);
            assert.equal(coerceEnabledValue("disabled"), false);
        });
    });

    describe("status mapping", () => {
        it("maps robot status codes and labels to general states", () => {
            assert.equal(rawRobotStatus({ robot_sta: { value: 6 } }), "globalmowing");
            assert.equal(generalMowerStatus({ robot_sta: { value: 6 } }), "mowing");
            assert.equal(generalMowerStatus({ robot_sta: { value: "backtodock" } }), "returning_to_dock");
            assert.equal(generalMowerStatus({ robot_sta: { value: "camera_cleaning" } }), "camera_cleaning");
            assert.equal(generalMowerStatus({ robot_sta: { value: 99 } }), "unknown");
        });

        it("falls back to M-series mode values and telemetry", () => {
            const mSeries = {
                mode: { value: "charge" },
                elec: { value: 81 },
                error: { value: 2012 },
                net_config: {
                    ip: "192.168.1.77",
                    ssid: "GardenWiFi",
                    "4g_ccid": "8949000000000000000",
                },
                rtk: { state: "fixed" },
                map: { map_area: 321.5 },
                mapping_task: { state: "running" },
                mowing_time: { value: 7200 },
                mowing_area: { value: 456.7 },
            };

            assert.equal(rawModeStatus(mSeries), "charge");
            assert.equal(rawRobotStatus(mSeries), "charge");
            assert.equal(generalMowerStatus(mSeries), "charging");
            assert.equal(isCharging(mSeries), true);
            assert.equal(batteryLevel(mSeries), 81);
            assert.equal(errorCode(mSeries), 2012);
            assert.equal(wifiSsid(mSeries), "GardenWiFi");
            assert.equal(ipAddress(mSeries), "192.168.1.77");
            assert.equal(simCcid(mSeries), "8949000000000000000");
            assert.equal(simPresent(mSeries), true);
            assert.equal(rtkStateLabel(mSeries), "fixed");
            assert.equal(mapArea(mSeries), 321.5);
            assert.equal(mappingTaskState(mSeries), "running");
            assert.equal(totalMowingTime(mSeries), 7200);
            assert.equal(totalMowingArea(mSeries), 456.7);
        });

        it("maps diagnostic codes", () => {
            assert.equal(errorDescription({ err_code: 999 }), "Unknown error (999)");
            assert.equal(rtkStateLabel({ rtk_state: 3 }), "fixed");
            assert.equal(rtkBaseStateLabel({ ctl_rtk_base: { rtk_base_state: 3 } }), "online");
        });

        it("resolves error descriptions from the cloud event code payload", () => {
            const cache = {
                version: 336,
                payload: {
                    code: 0,
                    data: {
                        "2012": {
                            English: { event_message: "The machine is stuck" },
                            German: { event_message: "Die Maschine ist blockiert." },
                        },
                    },
                    msg: "success",
                },
            };

            assert.equal(errorDescription({ err_code: 2012 }, cache, "English"), "The machine is stuck");
            assert.equal(errorDescription({ err_code: 2012 }, cache, "German"), "Die Maschine ist blockiert.");
            assert.equal(errorDescription({ err_code: 2012 }, cache, "French"), "The machine is stuck");
        });

        it("falls back to unknown when event code data is missing", () => {
            assert.equal(errorDescription({ err_code: 2012 }, { payload: { data: {} } }, "English"), "Unknown error (2012)");
            assert.equal(errorDescription({ error: { value: 2012 } }, { payload: { data: {} } }, "English"), "Unknown error (2012)");
        });
    });

    describe("zone and command parsing", () => {
        it("prefers manual zones from area definitions", () => {
            const data = {
                custom_areas: [{ id: 1 }],
                _area_definition: {
                    custom_areas: [{ id: 2, name: "Front" }],
                },
            };

            assert.deepEqual(manualZones(data), [{ id: 2, name: "Front" }]);
        });

        it("reads auto zones from known area definition keys", () => {
            const data = {
                _area_definition: {
                    regionAreas: [{ id: 5, name: "Back" }],
                },
            };

            assert.deepEqual(autoZones(data), [{ id: 5, name: "Back" }]);
        });

        it("filters active manual zone ids and compacts zone payloads", () => {
            assert.deepEqual(activeManualZoneIds({ active_area: { id: [1, "2", 3] } }), [1, 3]);
            assert.deepEqual(
                compactZonePayload([{ id: 1, name: "Front", ignored: true, cutter_height: 45, vertexs: [[1, 2]] }]),
                [{ id: 1, name: "Front", cutter_height: 45, vertexs: [[1, 2]] }],
            );
        });

        it("parses command selections from common ioBroker values", () => {
            assert.deepEqual(parseCommandSelection([1, "2"]), [1, "2"]);
            assert.deepEqual(parseCommandSelection(4), [4]);
            assert.deepEqual(parseCommandSelection("1, 2, front"), ["1", "2", "front"]);
            assert.deepEqual(parseCommandSelection("[1,\"front\"]"), [1, "front"]);
            assert.deepEqual(parseCommandSelection(""), []);
            assert.deepEqual(parseCommandSelection("[not-json"), ["[not-json"]);
        });
    });

    describe("protocol payload shaping", () => {
        it("maps consumable lifetime values to the names shown in the Anthbot app", () => {
            const lifetimes = consumableLifetimes({
                robot_maintenance: {
                    ccp_pecent: 99,
                    cl_pecent: 98,
                    rc_pecent: 91,
                },
            });

            assert.deepEqual(lifetimes, {
                blades: 91,
                cameras: 98,
                chargingPort: 99,
            });
        });

        it("keeps custom direction enabled semantics aligned with Anthbot payloads", () => {
            assert.equal(isCustomDirectionEnabled({ param_set: { enable_adaptive_head: 0 } }), true);
            assert.equal(isCustomDirectionEnabled({ param_set: { enable_adaptive_head: 1 } }), false);
        });

        it("detects likely authentication failures", () => {
            assert.equal(isLikelyAuthenticationError(new Error("403 unauthorized token")), true);
            assert.equal(isLikelyAuthenticationError(new Error("network timeout")), false);
        });

        it("detects M-series model names", () => {
            assert.equal(isMSeriesModel("Anthbot M5"), true);
            assert.equal(isMSeriesModel("Anthbot Genie 600"), false);
        });

        it("builds sparse M-series param_set payloads without legacy defaults", () => {
            const payload = buildParamSetPayload(
                "Anthbot M5",
                {
                    param_set: {
                        mow_count: 2,
                    },
                },
                { rid_switch: 1 },
            );

            assert.deepEqual(payload, {
                mow_count: 2,
                rid_switch: 1,
            });
        });

        it("keeps legacy param_set defaults for non-M-series models", () => {
            const payload = buildParamSetPayload("Anthbot Genie 600", {}, { rid_switch: 1 });

            assert.deepEqual(payload, {
                cutter_height: 30,
                mow_count: 1,
                mow_head: 0,
                enable_adaptive_head: 1,
                rid_switch: 1,
            });
        });

        it("preserves known mow_head when toggling M-series custom direction mode", () => {
            const payload = buildParamSetPayload(
                "Anthbot M9",
                {
                    param_set: {
                        mow_head: 45,
                        enable_adaptive_head: 1,
                    },
                },
                { enable_adaptive_head: 0 },
            );

            assert.deepEqual(payload, {
                mow_head: 45,
                enable_adaptive_head: 0,
            });
        });

        it("builds set_mow_params payloads with preserved current values", () => {
            const payload = buildNestMowParamsPayload(
                {
                    nest_switch: 1,
                    nest_mow_count: 2,
                    nest_pobctl_switch: 1,
                },
                { nest_cutter_height: 45 },
            );

            assert.deepEqual(payload, {
                nest_switch: 1,
                nest_mow_count: 2,
                nest_cutter_height: 45,
                nest_pobctl_switch: 1,
                nest_pobctl_level: 1,
            });
        });

        it("matches command defaults when no current near-charger settings are known", () => {
            const payload = buildNestMowParamsPayload({}, { nest_pobctl_level: 2 });

            assert.deepEqual(payload, {
                nest_switch: 0,
                nest_mow_count: 1,
                nest_cutter_height: 35,
                nest_pobctl_switch: 0,
                nest_pobctl_level: 2,
            });
        });
    });
});
