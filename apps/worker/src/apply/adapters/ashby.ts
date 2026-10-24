import { frameWithMostFields, gotoForm, type Adapter } from './types.js';

/** Ashby: client-rendered `/application` page; waits for the form before extraction. */
export const ashbyAdapter: Adapter = {
  ats: 'ashby',
  async locate({ page, detected }) {
    if (!page.url().endsWith('/application')) await gotoForm(page, detected.formUrl);
    await page.locator('input[name^="_systemfield_"], form input').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
    return frameWithMostFields(page);
  },
  async hints() {
    return [];
  },
  async postingOpen({ detected, getJson }) {
    if (!detected.board || !detected.jobId) return null;
    const data = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(detected.board)}`)) as { jobs?: { id: string }[] } | null;
    if (!data?.jobs) return null;
    return data.jobs.some((j) => j.id === detected.jobId);
  },
};
