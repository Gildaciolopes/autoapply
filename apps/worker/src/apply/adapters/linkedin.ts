import { isAlreadyApplied, isPlatformActionPage, isUnusualActivity } from '@autoapply/apply';
import type { Page } from 'playwright';
import { AdapterRedirect, AdapterStop, gotoForm, type Adapter } from './types.js';

export const EASY_APPLY_MODAL = '[data-test-modal-id="easy-apply-modal"], .jobs-easy-apply-modal, [role="dialog"][aria-labelledby*="easy-apply" i]';
const EASY = /(candidatura simplificada|easy apply)/i;
const EXTERNAL = /^(candidatar-se|candidatar|apply|aplicar)\b/i;

const bodyText = (page: Page) => page.evaluate('document.body ? document.body.innerText : ""').then(String).catch(() => '');

/**
 * LinkedIn (user's session): Easy Apply opens a modal (a click that only opens the dialog, never a
 * submit); without Easy Apply, the external apply link is followed and the F4 engine takes over.
 */
export const linkedinAdapter: Adapter = {
  ats: 'linkedin',
  scope: EASY_APPLY_MODAL,
  async locate({ page, detected }) {
    if (!/linkedin\.com\/jobs/.test(page.url())) await gotoForm(page, detected.formUrl);
    const url = page.url();
    const text = await bodyText(page);
    if (/\/(login|authwall|checkpoint|uas\/login)/.test(url)) throw new AdapterStop('session_expired');
    if (/\b(entre no linkedin|sign in to linkedin|join linkedin|entre ou cadastre-se)\b/i.test(text.slice(0, 600)) && !(await page.locator('.jobs-apply-button').count())) {
      throw new AdapterStop('session_expired');
    }
    if (isUnusualActivity(text)) throw new AdapterStop('unusual_activity');
    if (isPlatformActionPage(text)) throw new AdapterStop('platform_action');
    if (isAlreadyApplied(text)) throw new AdapterStop('already_applied');
    if (await page.locator(EASY_APPLY_MODAL).first().isVisible().catch(() => false)) return page.mainFrame();

    const buttons = page.locator('.jobs-apply-button, button, a');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      const label = ((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label')) || '').trim();
      if (!(await b.isVisible().catch(() => false))) continue;
      if (EASY.test(label)) {
        await b.click({ timeout: 5000 });
        await page.locator(EASY_APPLY_MODAL).first().waitFor({ state: 'visible', timeout: 10_000 });
        return page.mainFrame();
      }
    }
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      const label = ((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label')) || '').trim();
      if (!EXTERNAL.test(label) || !(await b.isVisible().catch(() => false))) continue;
      const href = await b.getAttribute('href');
      if (href && !/linkedin\.com/.test(new URL(href, url).hostname)) throw new AdapterRedirect(new URL(href, url).toString());
      // Button that opens the employer site in a new tab: capture the URL, close the tab.
      const popup = await Promise.all([page.context().waitForEvent('page', { timeout: 8000 }), b.click({ timeout: 5000 })]).then(([p]) => p).catch(() => null);
      if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
        const target = popup.url();
        await popup.close().catch(() => undefined);
        if (target && target !== 'about:blank') throw new AdapterRedirect(target);
      }
    }
    throw new AdapterStop('job_closed'); // neither Easy Apply nor an apply link
  },
  async hints() {
    return [];
  },
  async postingOpen() {
    return null;
  },
};
