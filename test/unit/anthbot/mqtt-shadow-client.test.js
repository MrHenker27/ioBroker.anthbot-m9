'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildPresignedMqttUrl,
    reportedStateFromMessage,
    shadowTopics,
} = require('../../../lib/anthbot/mqtt-shadow-client');

test('builds an AWS IoT SigV4 MQTT websocket URL', () => {
    const url = buildPresignedMqttUrl({
        endpoint: 'example-ats.iot.eu-central-1.amazonaws.com',
        regionName: 'eu-central-1',
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'secret',
        sessionToken: 'token/value',
        now: new Date('2026-07-16T20:00:00.000Z'),
        expiresSeconds: 900,
    });
    assert.match(url, /^wss:\/\/example-ats\.iot\.eu-central-1\.amazonaws\.com\/mqtt\?/);
    assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    assert.match(url, /X-Amz-Signature=[a-f0-9]{64}/);
    assert.match(url, /X-Amz-Security-Token=token%2Fvalue/);
});

test('creates official named shadow topics', () => {
    const topics = shadowTopics('SERIAL', 'property');
    assert.equal(topics.updateAccepted, '$aws/things/SERIAL/shadow/name/property/update/accepted');
    assert.equal(topics.updateDocuments, '$aws/things/SERIAL/shadow/name/property/update/documents');
});

test('extracts reported state from update accepted and documents', () => {
    assert.deepEqual(
        reportedStateFromMessage('x/update/accepted', Buffer.from('{"state":{"reported":{"mode":{"value":"charge"}}}}')),
        { mode: { value: 'charge' } },
    );
    assert.deepEqual(
        reportedStateFromMessage('x/update/documents', Buffer.from('{"current":{"state":{"reported":{"elec":{"value":99}}}}}')),
        { elec: { value: 99 } },
    );
});
