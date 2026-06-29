'use strict';

const DEFAULT_IOT_REGION = 'us-east-1';
const DEFAULT_IOT_ENDPOINT = 'a2bhy9nr7jkgaj-ats.iot.us-east-1.amazonaws.com';
const IOT_ENDPOINT_TEMPLATE = 'a2bhy9nr7jkgaj-ats.iot.{region}.amazonaws.com';

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
    DEFAULT_IOT_ENDPOINT,
    DEFAULT_IOT_REGION,
    IOT_ENDPOINT_TEMPLATE,
    MODEL_NAME_BY_CATEGORY,
    M_SERIES_MODEL_PATTERN,
    ROBOT_STATUS_BY_CODE,
    RTK_BASE_STATE_OPTIONS,
    RTK_STATE_OPTIONS,
};
