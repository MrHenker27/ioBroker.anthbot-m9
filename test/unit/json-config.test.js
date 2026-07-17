'use strict';

const { expect } = require('chai');
const config = require('../../admin/jsonConfig.json');

describe('Admin JSONConfig', () => {
    it('renders the RTK sky plot from the live HTML state', () => {
        const item = config.items.diagSkyplot;
        expect(item).to.deep.equal({
            type: 'state',
            label: 'RTK satellite map',
            oid: 'diagnostics.admin.skyplotHtml',
            control: 'html',
            readOnly: true,
            xs: 12,
            sm: 12,
            md: 6,
            lg: 6,
            xl: 6,
        });
    });
});
