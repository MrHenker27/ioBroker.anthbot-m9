'use strict';

/**
 * Select the active M5/M9 multi-map entry from a merged shadow payload.
 * The app prefers the map whose map_id matches map_tar_time/map_time and
 * otherwise falls back to the first usable map_list entry.
 *
 * @param {object|null|undefined} data
 * @returns {{fileName:string|null, md5:string|null, mapId:string|null}}
 */
function selectMultiMapEntry(data) {
    const mapList = Array.isArray(data?.multi_maps?.map_list)
        ? data.multi_maps.map_list
        : [];
    const entries = mapList.filter(
        item => item && typeof item === 'object' &&
            typeof item.map_file_name === 'string' && item.map_file_name.trim(),
    );
    if (!entries.length) {
        return { fileName: null, md5: null, mapId: null };
    }

    const activeIds = [data?.map_tar_time, data?.map_time]
        .filter(value => value !== null && value !== undefined && value !== '')
        .map(value => String(value));
    const selected = entries.find(item => activeIds.includes(String(item.map_id ?? ''))) || entries[0];

    return {
        fileName: selected.map_file_name,
        md5: typeof selected.md5 === 'string' && selected.md5.trim() ? selected.md5.trim() : null,
        mapId: selected.map_id == null ? null : String(selected.map_id),
    };
}

function rleEncode(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return [];
    const runs = [];
    let value = buffer[0];
    let count = 1;
    for (let index = 1; index < buffer.length; index++) {
        if (buffer[index] === value) {
            count += 1;
        } else {
            runs.push([value, count]);
            value = buffer[index];
            count = 1;
        }
    }
    runs.push([value, count]);
    return runs;
}

/** Decode remote_map.json + remote_map_navi.map from the M5/M9 multi_maps archive. */
function decodeMultiMapFiles(metadataInput, pixels, rtkMask = null) {
    const metadataText = Buffer.isBuffer(metadataInput)
        ? metadataInput.toString('utf8')
        : String(metadataInput || '');
    const metadata = JSON.parse(metadataText);
    const naviMap = metadata?.navi_map;
    if (!naviMap || typeof naviMap !== 'object') {
        throw new Error('remote_map.json does not contain navi_map metadata');
    }

    const width = Number(naviMap.width);
    const height = Number(naviMap.height);
    const resolution = Number(naviMap.resolution);
    const xMin = Number(naviMap.x_min);
    const yMin = Number(naviMap.y_min);
    const pixelCount = width * height;

    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || pixelCount > 8_000_000) {
        throw new Error(`Invalid multi-map dimensions ${width}x${height}`);
    }
    if (!Buffer.isBuffer(pixels) || pixels.length !== pixelCount) {
        throw new Error(`remote_map_navi.map has ${pixels?.length || 0} bytes, expected ${pixelCount}`);
    }
    if (![resolution, xMin, yMin].every(Number.isFinite) || resolution <= 0) {
        throw new Error('Invalid multi-map resolution/origin metadata');
    }

    const resolutionMm = resolution * 1000;
    const minX = xMin * 1000;
    const minY = yMin * 1000;
    const decoded = {
        encoding: 'multi_maps_tar_gz',
        width,
        height,
        resolution,
        bounds: {
            minX,
            maxX: minX + width * resolutionMm,
            minY,
            maxY: minY + height * resolutionMm,
        },
        runs: rleEncode(pixels),
        metadata,
        rtkMask: null,
    };

    if (Buffer.isBuffer(rtkMask) && rtkMask.length === pixelCount) {
        decoded.rtkMask = {
            width,
            height,
            runs: rleEncode(rtkMask),
        };
    }
    return decoded;
}

module.exports = { decodeMultiMapFiles, rleEncode, selectMultiMapEntry };
