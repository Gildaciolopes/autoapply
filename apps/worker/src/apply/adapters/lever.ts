import { frameWithMostFields, gotoForm, type Adapter } from './types.js';

/** Lever: `/apply` page; standard names (name, email, phone, org, urls[...], resume) are classified by name. */
export const leverAdapter: Adapter = {
  ats: 'lever',
  async locate({ page, detected }) {
    if (!page.url().endsWith('/apply')) await gotoForm(page, detected.formUrl);
    return frameWithMostFields(page);
  },
  async hints() {
    return [];
  },
  async postingOpen({ detected, getJson }) {
    if (!detected.board || !detected.jobId) return null;
    const data = await getJson(`https://api.lever.co/v0/postings/${detected.board}/${detected.jobId}`);
    return data === null ? null : Boolean((data as { id?: unknown }).id);
  },
};
