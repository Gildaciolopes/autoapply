import { frameWithMostFields, gotoForm, type Adapter } from './types.js';

/** Any other career page: open it and use the frame with the most fields (research R3). */
export const genericAdapter: Adapter = {
  ats: 'generic',
  async locate({ page, detected }) {
    if (page.url() !== detected.formUrl) await gotoForm(page, detected.formUrl);
    return frameWithMostFields(page);
  },
  async hints() {
    return [];
  },
  async postingOpen() {
    return null;
  },
};
