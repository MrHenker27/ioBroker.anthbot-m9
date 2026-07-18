'use strict';

const assert = require('node:assert/strict');
const { stableStringify } = require('../../../lib/anthbot/stable-json');

describe('lib/anthbot/stable-json', () => {
    it('serializes equivalent objects identically regardless of key insertion order', () => {
        const first = {
            z: 1,
            nested: { b: 2, a: 1 },
            list: [{ y: 2, x: 1 }],
        };
        const second = {
            list: [{ x: 1, y: 2 }],
            nested: { a: 1, b: 2 },
            z: 1,
        };

        assert.equal(stableStringify(first), stableStringify(second));
        assert.equal(stableStringify(first), '{"list":[{"x":1,"y":2}],"nested":{"a":1,"b":2},"z":1}');
    });

    it('preserves array order', () => {
        assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
    });
});
