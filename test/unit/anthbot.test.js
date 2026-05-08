"use strict";

const assert = require("node:assert/strict");

const {
    AnthbotCloudApiClient,
    AnthbotShadowApiClient,
    activeManualZoneIds,
    asInteger,
    asIsoTimestamp,
    autoZones,
    compactZonePayload,
    coerceEnabledValue,
    consumableLifetimes,
    errorDescription,
    generalMowerStatus,
    isCharging,
    isCustomDirectionEnabled,
    isLikelyAuthenticationError,
    isNonZero,
    manualZones,
    parseCommandSelection,
    rawRobotStatus,
    rtkBaseStateLabel,
    rtkStateLabel,
    safeGet,
} = require("../../lib/anthbot");

describe("lib/anthbot helpers", () => {
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

        it("detects charging from the general status", () => {
            assert.equal(isCharging({ robot_sta: { value: "charge" } }), true);
            assert.equal(isCharging({ robot_sta: { value: "idle" } }), false);
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
        });

        it("uses the configured event code language when available", () => {
            const cache = {
                payload: {
                    data: {
                        "2012": {
                            English: { event_message: "The machine is stuck" },
                            German: { event_message: "Die Maschine ist blockiert." },
                        },
                    },
                },
            };

            assert.equal(errorDescription({ err_code: 2012 }, cache, "German"), "Die Maschine ist blockiert.");
        });

        it("falls back to English when the configured event code language is missing", () => {
            const cache = {
                payload: {
                    data: {
                        "2012": {
                            English: { event_message: "The machine is stuck" },
                        },
                    },
                },
            };

            assert.equal(errorDescription({ err_code: 2012 }, cache, "French"), "The machine is stuck");
        });

        it("falls back to unknown when no event code payload entry exists", () => {
            assert.equal(errorDescription({ err_code: 2012 }, { payload: { data: {} } }, "English"), "Unknown error (2012)");
        });
    });

    describe("zone helpers", () => {
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
            assert.deepEqual(compactZonePayload([
                { id: 1, name: "Front", ignored: true, cutter_height: 45, vertexs: [[1, 2]] },
            ]), [
                { id: 1, name: "Front", cutter_height: 45, vertexs: [[1, 2]] },
            ]);
        });
    });

    describe("command parsing", () => {
        it("parses command selections from common ioBroker values", () => {
            assert.deepEqual(parseCommandSelection([1, "2"]), [1, "2"]);
            assert.deepEqual(parseCommandSelection(4), [4]);
            assert.deepEqual(parseCommandSelection("1, 2, front"), ["1", "2", "front"]);
            assert.deepEqual(parseCommandSelection("[1,\"front\"]"), [1, "front"]);
            assert.deepEqual(parseCommandSelection(""), []);
        });

        it("falls back to the original string for invalid JSON-looking selections", () => {
            assert.deepEqual(parseCommandSelection("[not-json"), ["[not-json"]);
        });
    });

    describe("protocol helpers", () => {
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

        it("builds stable cloud verification tokens for a fixed timestamp", () => {
            assert.equal(
                AnthbotCloudApiClient.buildVerificationToken("SERIAL123", 1711974896),
                "e74a008a1c0019cfa518153efcd4d2c61711974896",
            );
        });

        it("parses temporary IoT credentials from the Anthbot STS endpoint", async () => {
            const client = new AnthbotCloudApiClient({
                http: {
                    post: async (url, body, options) => {
                        assert.equal(url, "https://api.anthbot.com/api/v1/device/v2/iot/sts/arn");
                        assert.equal(body.sn, "SERIAL123");
                        assert.equal(typeof body.verification_token, "string");
                        assert.equal(options.headers.Authorization, "Bearer token");
                        return {
                            status: 200,
                            data: {
                                code: 0,
                                data: {
                                    access_key_id: "ASIA123",
                                    secret_access_key: "secret",
                                    session_token: "session",
                                    region_name: "eu-central-1",
                                    endpoint: "a.example.iot.eu-central-1.amazonaws.com",
                                    expiration: 3600,
                                },
                            },
                        };
                    },
                },
                host: "api.anthbot.com",
                bearerToken: "Bearer token",
            });

            const credentials = await client.getDeviceIotCredentials("SERIAL123");

            assert.equal(credentials.accessKeyId, "ASIA123");
            assert.equal(credentials.secretAccessKey, "secret");
            assert.equal(credentials.sessionToken, "session");
            assert.equal(credentials.regionName, "eu-central-1");
            assert.equal(credentials.endpoint, "a.example.iot.eu-central-1.amazonaws.com");
            assert.equal(credentials.expiresAt > Date.now(), true);
        });

        it("fetches the Anthbot event code version", async () => {
            const client = new AnthbotCloudApiClient({
                http: {
                    get: async (url, options) => {
                        assert.equal(url, "https://api.anthbot.com/api/v1/message/code/version");
                        assert.equal(options.headers.Authorization, "Bearer token");
                        return {
                            status: 200,
                            data: {
                                code: 0,
                                data: { version: 336 },
                            },
                        };
                    },
                },
                host: "api.anthbot.com",
                bearerToken: "Bearer token",
            });

            assert.equal(await client.getEventCodeVersion(), 336);
        });

        it("fetches Anthbot event code translations for a version", async () => {
            const payload = {
                code: 0,
                data: {
                    "2012": {
                        English: { event_message: "The machine is stuck" },
                    },
                },
                msg: "success",
            };
            const client = new AnthbotCloudApiClient({
                http: {
                    post: async (url, body, options) => {
                        assert.equal(url, "https://api.anthbot.com/api/v1/message/code/translate");
                        assert.deepEqual(body, { version: 336 });
                        assert.equal(options.headers.Authorization, "Bearer token");
                        return {
                            status: 200,
                            data: payload,
                        };
                    },
                },
                host: "api.anthbot.com",
                bearerToken: "Bearer token",
            });

            assert.deepEqual(await client.getEventCodeTranslations(336), payload);
        });

        it("signs shadow requests with temporary AWS session tokens", async () => {
            const requests = [];
            const client = new AnthbotShadowApiClient({
                http: {
                    get: async (url, options) => {
                        requests.push({ url, options });
                        return {
                            status: 200,
                            data: {
                                state: {
                                    reported: { ok: true },
                                },
                            },
                        };
                    },
                },
                serialNumber: "SERIAL123",
                regionName: "eu-central-1",
                iotEndpoint: "a.example.iot.eu-central-1.amazonaws.com",
                iotCredentials: {
                    accessKeyId: "ASIA123",
                    secretAccessKey: "secret",
                    sessionToken: "session",
                },
            });

            await client.getNamedShadowReportedState("property");

            assert.equal(requests.length, 1);
            assert.equal(requests[0].options.headers["x-amz-security-token"], "session");
            assert.match(requests[0].options.headers.Authorization, /Credential=ASIA123\//);
            assert.match(requests[0].options.headers.Authorization, /SignedHeaders=.*x-amz-security-token/);
        });
    });
});
