"use strict";

const assert = require("node:assert/strict");

const {
    executeCommand,
    executeConsumableCommand,
    executeControl,
    parseIntegerControlValue,
    parsePointMowValue,
    resolveAutoZoneSelection,
    resolveManualZoneSelection,
} = require("../../../lib/adapter/actions");

function createShadowRecorder() {
    const calls = [];
    return {
        calls,
        shadowClient: {
            publishServiceCommand: async payload => {
                calls.push(["publishServiceCommand", payload]);
            },
            requestAllProperties: async () => {
                calls.push(["requestAllProperties"]);
            },
        },
    };
}

describe("lib/adapter/actions", () => {
    it("parses point mowing inputs", () => {
        assert.deepEqual(parsePointMowValue("12,34"), { x: 12, y: 34 });
        assert.deepEqual(parsePointMowValue("{\"x\":12,\"y\":34}"), { x: 12, y: 34 });
        assert.throws(() => parsePointMowValue("x,y"), /Point mow must be/);
    });

    it("parses bounded integer control values", () => {
        assert.equal(parseIntegerControlValue(35, { label: "Height", min: 30, max: 70, step: 5 }), 35);
        assert.throws(
            () => parseIntegerControlValue(34, { label: "Height", min: 30, max: 70, step: 5 }),
            /Height must be 30\.\.70/,
        );
    });

    it("resolves manual and auto zone selections by id and name", () => {
        const context = {
            lastReported: {},
            areaDefinition: {
                custom_areas: [
                    { id: 1, name: "Front" },
                    { id: 2, name: "Side" },
                ],
                region_areas: [
                    { id: 10, name: "Back", x: 100, y: 200 },
                    { id: 11, name: "North", x: 100, y: 200 },
                    { id: 12, name: "South", x: 110, y: 210 },
                ],
            },
        };

        assert.deepEqual(resolveManualZoneSelection(context, "1,Side"), [1, 2]);
        assert.deepEqual(resolveAutoZoneSelection(context, "10,South"), [
            [100, 200],
            [110, 210],
        ]);
    });

    it("emits the expected mowing command payloads", async () => {
        const { calls, shadowClient } = createShadowRecorder();
        const context = {
            shadowClient,
            device: { model: "Anthbot Genie 600" },
            areaDefinition: {
                custom_areas: [{ id: 1, name: "Front" }],
                region_areas: [{ id: 2, name: "Back", x: 55, y: 66 }],
            },
            lastReported: {},
        };

        assert.equal(await executeCommand({ context, command: "mowing.startFullMap", value: true }), true);
        await executeCommand({ context, command: "mowing.startZone", value: "Front" });
        await executeCommand({ context, command: "mowing.startAutoZone", value: "Back" });
        await executeCommand({ context, command: "mowing.startPoint", value: "10,20" });
        await executeCommand({ context, command: "mowing.startNearCharger", value: true });
        assert.equal(await executeCommand({ context, command: "device.refresh", value: true }), false);

        assert.deepEqual(calls, [
            ["publishServiceCommand", { cmd: "app_state", data: 1 }],
            ["publishServiceCommand", { cmd: "mow_start", data: 1 }],
            ["publishServiceCommand", { cmd: "custom_area_mow_start", data: { id: [1] } }],
            ["publishServiceCommand", { cmd: "region_mow_start", data: { points: [[55, 66]] } }],
            ["publishServiceCommand", { cmd: "mow_point", data: { x: 10, y: 20 } }],
            ["publishServiceCommand", { cmd: "nest_mow_start", data: 1 }],
            ["requestAllProperties"],
        ]);
    });

    it("emits the expected control payloads for full-map, zone, rain, and near-charger flows", async () => {
        const { calls, shadowClient } = createShadowRecorder();
        const context = {
            shadowClient,
            device: { model: "Anthbot Genie 600" },
            lastReported: {
                param_set: {
                    cutter_height: 35,
                    mow_count: 2,
                    mow_head: 45,
                    enable_adaptive_head: 1,
                    rid_switch: 0,
                    nest_switch: 1,
                },
                pobctl: { switch: 1, level: 2 },
                rain_switch: 1,
                rain_continue_time: 7200,
                nest_switch: 1,
                nest_cutter_height: 35,
                nest_mow_count: 2,
                nest_pobctl_switch: 1,
                nest_pobctl_level: 1,
            },
        };

        await executeControl({ context, control: "fullMapMowing.includeEdgeTrimming", value: true });
        await executeControl({ context, control: "zoneMowing.mowCount", value: 3 });
        await executeControl({ context, control: "rain.perceptionEnabled", value: false });
        await executeControl({ context, control: "rain.continueTimeHours", value: 4 });
        await executeControl({ context, control: "nearChargerMowing.enabled", value: false });
        await executeControl({ context, control: "nearChargerMowing.mowHeight", value: 45 });
        await executeControl({ context, control: "nearChargerMowing.obstacleAvoidanceLevel", value: 2 });

        assert.deepEqual(calls, [
            ["publishServiceCommand", { cmd: "param_set", data: { cutter_height: 35, mow_count: 2, mow_head: 45, enable_adaptive_head: 1, rid_switch: 1, nest_switch: 1 } }],
            ["publishServiceCommand", { cmd: "param_set", data: { cutter_height: 35, mow_count: 3, mow_head: 45, enable_adaptive_head: 1, rid_switch: 0, nest_switch: 1 } }],
            ["publishServiceCommand", { cmd: "ctl_rainer", data: { switch: 0, continue_time: 7200 } }],
            ["publishServiceCommand", { cmd: "ctl_rainer", data: { switch: 1, continue_time: 14400 } }],
            ["publishServiceCommand", { cmd: "set_mow_params", data: { nest_switch: 0, nest_mow_count: 2, nest_cutter_height: 35, nest_pobctl_switch: 1, nest_pobctl_level: 1 } }],
            ["publishServiceCommand", { cmd: "set_mow_params", data: { nest_switch: 1, nest_mow_count: 2, nest_cutter_height: 45, nest_pobctl_switch: 1, nest_pobctl_level: 1 } }],
            ["publishServiceCommand", { cmd: "set_mow_params", data: { nest_switch: 1, nest_mow_count: 2, nest_cutter_height: 35, nest_pobctl_switch: 1, nest_pobctl_level: 2 } }],
        ]);
    });

    it("shapes M-series param_set control updates without legacy defaults", async () => {
        const { calls, shadowClient } = createShadowRecorder();
        const context = {
            shadowClient,
            device: { model: "Anthbot M5" },
            lastReported: {
                param_set: {
                    mow_count: 2,
                },
            },
        };

        await executeControl({ context, control: "zoneMowing.mowCount", value: 3 });

        assert.deepEqual(calls, [
            ["publishServiceCommand", { cmd: "param_set", data: { mow_count: 3 } }],
        ]);
    });

    it("emits the expected consumable reset payload", async () => {
        const { calls, shadowClient } = createShadowRecorder();
        const context = { shadowClient };

        await executeConsumableCommand({ context, command: "chargingPort.reset" });

        assert.deepEqual(calls, [
            ["publishServiceCommand", { cmd: "robot_maintenance_reset", robot_maintenance: 2 }],
        ]);
    });
});
