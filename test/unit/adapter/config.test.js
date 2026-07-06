"use strict";

const assert = require("node:assert/strict");

const { normalizePollIntervalSeconds } = require("../../../lib/adapter/config");

describe("adapter config helpers", () => {
    describe("normalizePollIntervalSeconds", () => {
        it("uses the default poll interval for missing or invalid values", () => {
            assert.equal(normalizePollIntervalSeconds(undefined), 60);
            assert.equal(normalizePollIntervalSeconds("not a number"), 60);
        });

        it("clamps poll interval values to the supported code-level range", () => {
            assert.equal(normalizePollIntervalSeconds(5), 10);
            assert.equal(normalizePollIntervalSeconds(120), 120);
            assert.equal(normalizePollIntervalSeconds(7200), 3600);
        });
    });
});
