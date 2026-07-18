'use strict';

/**
 * Recursively clone a JSON-compatible value with object keys sorted.
 * Array order is intentionally preserved because arrays may be ordered data.
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalizeJson(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalizeJson);
    }

    if (value && typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            const child = value[key];
            if (child !== undefined) {
                result[key] = canonicalizeJson(child);
            }
        }
        return result;
    }

    return value;
}

/**
 * JSON.stringify with deterministic object-key ordering.
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
    return JSON.stringify(canonicalizeJson(value));
}

module.exports = {
    canonicalizeJson,
    stableStringify,
};
