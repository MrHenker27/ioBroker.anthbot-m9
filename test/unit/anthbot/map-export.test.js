'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { exportMap, safeFilePart, timestampForFile } = require('../../../lib/anthbot/map-export');

test('safeFilePart sanitizes serial numbers', () => {
    assert.equal(safeFilePart('ABC/123 test'), 'ABC_123_test');
});

test('timestampForFile creates a filesystem-safe timestamp', () => {
    assert.equal(timestampForFile(new Date('2026-07-16T10:11:12.345Z')), '20260716T101112Z');
});

test('exportMap writes an SVG and stores the result in the context', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anthbot-map-export-'));
    const context = {
        lastMapSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        mapExportDirectory: directory,
        device: { serialNumber: 'M9/123' },
    };

    try {
        const result = await exportMap(context, {
            createPng: false,
            now: new Date('2026-07-16T10:11:12.345Z'),
        });

        assert.equal(result.ok, true);
        assert.equal(result.pngPath, '');
        assert.match(result.svgPath, /anthbot-map-M9_123-20260716T101112Z\.svg$/);
        assert.equal(await fs.readFile(result.svgPath, 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
        assert.deepEqual(context.mapExport, result);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
