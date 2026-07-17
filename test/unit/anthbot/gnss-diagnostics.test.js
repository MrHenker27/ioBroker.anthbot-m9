'use strict';

const assert = require('node:assert/strict');
const { extractGnssDiagnostics, normalizeFix, walkCandidates } = require('../../../lib/anthbot/gnss-diagnostics');

describe('lib/anthbot/gnss-diagnostics', () => {
    it('separates Kevin and RTK base data', () => {
        const result = extractGnssDiagnostics({
            pos_status: 3,
            satellite_num: 19,
            pos_accuracy: 0.03,
            pos_source: 'rtk',
            ctl_rtk_base: {
                positioning_status: 'strong',
                satellite_count: 36,
                signal_source: 'wifi',
            },
        }, {}, new Date('2026-07-17T06:00:00Z'));

        assert.equal(result.robot.fix, 'fixed');
        assert.equal(result.robot.satellites, 19);
        assert.equal(result.base.fix, 'fixed');
        assert.equal(result.base.satellites, 36);
        assert.equal(result.assessment.overall, 'ok');
    });

    it('does not present base data as Kevin data', () => {
        const result = extractGnssDiagnostics({
            ctl_rtk_base: { positioning_status: 'strong', satellite_count: 36 },
        });
        assert.equal(result.robot.fix, 'unknown');
        assert.equal(result.robot.satellites, null);
        assert.equal(result.base.satellites, 36);
        assert.equal(result.assessment.overall, 'unknown');
    });

    it('marks odometry only as a cautious inference', () => {
        const result = extractGnssDiagnostics({ pos_status: 0 }, { mowerActive: true, positionFresh: true });
        assert.equal(result.robot.fix, 'lost');
        assert.equal(result.assessment.odometryLikely, true);
        assert.match(result.assessment.message, /suggests temporary navigation/i);
    });


    it('describes mower rtk.state code 1 as active positioning and keeps other codes raw', () => {
        const active = extractGnssDiagnostics({ rtk: { state: 1 } });
        assert.equal(active.robot.fix, 'positioning active (code 1)');
        assert.equal(active.robot.rawStatus, '1');
        assert.equal(active.assessment.overall, 'ok');
        assert.match(active.assessment.message, /active RTK positioning/i);

        const other = extractGnssDiagnostics({ rtk: { state: 0 } });
        assert.equal(other.robot.fix, 'status code 0');
        assert.equal(other.assessment.overall, 'unknown');
        assert.match(other.assessment.message, /numeric RTK status/i);
    });

    it('collects unknown GNSS candidates for later protocol analysis', () => {
        const candidates = walkCandidates({ foo: { gnss_quality: 7 }, ctl_rtk_base: { sat_count: 22 } });
        assert.equal(candidates['foo.gnss_quality'], 7);
        assert.equal(candidates['ctl_rtk_base.sat_count'], 22);
    });

    it('normalizes common fix values', () => {
        assert.equal(normalizeFix('fixed'), 'fixed');
        assert.equal(normalizeFix('float'), 'float');
        assert.equal(normalizeFix(0), 'unknown (0)');
        assert.equal(normalizeFix(null), 'unknown');
    });
});
