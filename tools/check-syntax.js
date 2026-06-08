"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function collectJsFiles(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    /** @type {string[]} */
    const files = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJsFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".js")) {
            files.push(fullPath);
        }
    }

    return files;
}

const cwd = process.cwd();
const targets = [
    "main.js",
    "lib/anthbot.js",
    ...collectJsFiles(path.join(cwd, "lib", "anthbot")),
    ...collectJsFiles(path.join(cwd, "lib", "adapter")),
    "test/package/testPackageFiles.js",
    "test/integration/testStartup.js",
    ...collectJsFiles(path.join(cwd, "test", "unit")),
].map(target => path.resolve(cwd, target));

for (const filePath of targets) {
    execFileSync(process.execPath, ["--check", filePath], {
        cwd,
        stdio: "inherit",
    });
}
