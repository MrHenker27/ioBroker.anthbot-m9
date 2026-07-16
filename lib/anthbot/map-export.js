'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function safeFilePart(value) {
    return String(value ?? 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function timestampForFile(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function loadSharp() {
    try {
        return require('sharp');
    } catch (error) {
        const wrapped = /** @type {Error & { code?: string }} */ (new Error(
            `PNG export requires the optional 'sharp' dependency: ${error.message}`,
        ));
        wrapped.code = 'SHARP_NOT_AVAILABLE';
        throw wrapped;
    }
}

/**
 * @param {{
 *   lastMapSvg?: string,
 *   mapExportDirectory?: string,
 *   device?: { serialNumber?: string, alias?: string },
 *   mapExport?: object,
 * }} context
 * @param {{ createPng?: boolean, now?: Date }} [options]
 */
async function exportMap(context, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();

    try {
        const svg = typeof context?.lastMapSvg === 'string' ? context.lastMapSvg.trim() : '';
        if (!svg) {
            throw new Error('No rendered SVG map is available');
        }

        const directory = context?.mapExportDirectory;
        if (typeof directory !== 'string' || !directory.trim()) {
            throw new Error('Map export directory is not configured');
        }

        const serial = safeFilePart(context?.device?.serialNumber || 'mower');
        const stamp = timestampForFile(now);
        const baseName = `anthbot-map-${serial}-${stamp}`;

        await fs.mkdir(directory, { recursive: true });

        const svgPath = path.join(directory, `${baseName}.svg`);
        await fs.writeFile(svgPath, `${svg}\n`, 'utf8');

        let pngPath = '';
        if (options.createPng) {
            const sharp = await loadSharp();
            pngPath = path.join(directory, `${baseName}.png`);
            await sharp(Buffer.from(svg, 'utf8')).png().toFile(pngPath);
        }

        const result = {
            ok: true,
            svgPath,
            pngPath,
            timestamp: now.toISOString(),
            message: options.createPng
                ? 'SVG and PNG map exported successfully'
                : 'SVG map exported successfully',
        };

        context.mapExport = result;
        return result;
    } catch (error) {
        context.mapExport = {
            ok: false,
            svgPath: '',
            pngPath: '',
            timestamp: now.toISOString(),
            message: error?.message || String(error),
        };
        throw error;
    }
}

module.exports = {
    exportMap,
    safeFilePart,
    timestampForFile,
};
