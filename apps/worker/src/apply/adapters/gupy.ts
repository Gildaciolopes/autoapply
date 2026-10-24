import { isAlreadyApplied, isPlatformActionPage, isUnusualActivity } from '@autoapply/apply';
import type { Page } from 'playwright';
import { AdapterStop, frameWithMostFields, gotoForm, type Adapter } from './types.js';

const START = /^(candidatar-se|candidate-se|quero me candidatar|me candidatar|aplicar|inscrever-se|continuar candidatura)\b/i;

const bodyText = (page: Page) => page.evaluate('document.body ? document.body.innerText : ""').then(String).catch(() => '');

/** Signals on any Gupy page: login wall, already applied, platform action, unusual activity. */
export async function gupySignals(page: Page): Promise<void> {
  const url = page.url();
  const text = await bodyText(page);
  if (/login\.gupy\.io|\/signin|\/login/.test(url)) throw new AdapterStop('session_expired');
  if (isUnusualActivity(text)) throw new AdapterStop('unusual_activity');
  if (isAlreadyApplied(text)) throw new AdapterStop('already_applied');
  if (isPlatformActionPage(text)) throw new AdapterStop('platform_action');
}

/**
 * Gupy (logged in with the user's session): job page → "Candidatar-se" (a navigation, never a submit)
 * → application steps, handled by the F4 extractor/next-step logic.
 */
export const gupyAdapter: Adapter = {
  ats: 'gupy',
  async locate({ page, detected }) {
    if (!/gupy\.io/.test(page.url())) await gotoForm(page, detected.formUrl);
    await gupySignals(page);
    if (!(await page.locator('input:not([type="hidden"]), textarea, select').count())) {
      const starts = page.locator('a, button');
      const n = await starts.count();
      for (let i = 0; i < n; i++) {
        const el = starts.nth(i);
        const label = (await el.innerText().catch(() => '')).trim();
        if (!START.test(label) || !(await el.isVisible().catch(() => false))) continue;
        await el.click({ timeout: 5000 });
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await page.waitForTimeout(1500);
        break;
      }
      await gupySignals(page);
    }
    return frameWithMostFields(page);
  },
  async hints() {
    return [];
  },
  async postingOpen() {
    return null;
  },
};
