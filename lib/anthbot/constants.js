'use strict';

const DEFAULT_IOT_REGION = 'us-east-1';
const DEFAULT_IOT_ENDPOINT = 'a2bhy9nr7jkgaj-ats.iot.us-east-1.amazonaws.com';
const IOT_ENDPOINT_TEMPLATE = 'a2bhy9nr7jkgaj-ats.iot.{region}.amazonaws.com';
const CN_NORTHWEST_IOT_ENDPOINT = 'a2iw0czxjowiip-ats.iot.cn-northwest-1.amazonaws.com.cn';
// Anthbot's mobile apps fall back to these vendor-side SigV4 signing values when
// the cloud API does not return temporary IoT credentials. They are not user
// secrets or account tokens and are only used to sign anonymous shadow requests.
const AWS_ACCESS_KEY_DEFAULT = 'AKIAV2C4RVIAOLEXB545';
const AWS_SECRET_KEY_DEFAULT = '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';
const AWS_ACCESS_KEY_CN = 'AKIAWJ3KIT7IV6AHMJ5V';
const AWS_SECRET_KEY_CN = '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';
const AWS_ACCESS_KEY_CN_NORTHWEST = 'AKIAYVWVSSRF7W5YWI74';
const AWS_SECRET_KEY_CN_NORTHWEST = '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';

const MODEL_NAME_BY_CATEGORY = {
    'Genie 600': 'Anthbot Genie 600',
    'Genie 1000': 'Anthbot Genie 1000',
    'Genie 3000': 'Anthbot Genie 3000',
    'Genie 5000': 'Anthbot Genie 5000',
};

const RTK_STATE_OPTIONS = {
    0: 'not_ready',
    1: 'single',
    2: 'differential',
    3: 'fixed',
    4: 'float',
    5: 'dead_reckoning',
};

const RTK_BASE_STATE_OPTIONS = {
    0: 'offline',
    1: 'initializing',
    2: 'searching',
    3: 'online',
    4: 'error',
};

const ROBOT_STATUS_BY_CODE = [
    'idle',
    'pause',
    'charge',
    'sleep',
    'ota',
    'position',
    'globalmowing',
    'zonemowing',
    'pointmowing',
    'mapping',
    'backtodock',
    'resume_point',
    'shutdown',
    'remotectrl',
    'factory',
    'sleep',
    'camera_cleaning',
    'gototarget',
    'bordermowing',
    'regionmowing',
    'nestmowing',
];

const M_SERIES_MODEL_PATTERN = /\bM(?:5|9)\b/i;

module.exports = {
    AWS_ACCESS_KEY_CN,
    AWS_ACCESS_KEY_CN_NORTHWEST,
    AWS_ACCESS_KEY_DEFAULT,
    AWS_SECRET_KEY_CN,
    AWS_SECRET_KEY_CN_NORTHWEST,
    AWS_SECRET_KEY_DEFAULT,
    CN_NORTHWEST_IOT_ENDPOINT,
    DEFAULT_IOT_ENDPOINT,
    DEFAULT_IOT_REGION,
    IOT_ENDPOINT_TEMPLATE,
    MODEL_NAME_BY_CATEGORY,
    M_SERIES_MODEL_PATTERN,
    ROBOT_STATUS_BY_CODE,
    RTK_BASE_STATE_OPTIONS,
    RTK_STATE_OPTIONS,
};
