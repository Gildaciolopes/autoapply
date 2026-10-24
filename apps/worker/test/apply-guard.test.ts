import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { isReadOnlyGraphql, openDryRunContext, submitAttempts } from '../src/apply/browser.js';

const FORM = `<!doctype html><html><body>
<form id="f" action="https://ats.example/apply" method="post">
  <input name="email" value="a@b.co"><button id="send" type="submit">Enviar candidatura</button>
</form>
<iframe id="inner" src="https://embed.example/form"></iframe>
</body></html>`;
const INNER = `<!doctype html><html><body><form id="g" action="https://embed.example/submit" method="post">
<input name="x"><button id="send2" type="submit">Submit</button></form></body></html>`;

describe('dry-run guard (FR-001)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
  });

  it('nothing but GET leaves the context, even when submit is forced', async () => {
    const served: string[] = [];
    const ctx = await openDryRunContext(browser, {
      serve: (url) => {
        served.push(url);
        if (url.startsWith('https://ats.example/job')) return { body: FORM, contentType: 'text/html' };
        if (url.startsWith('https://embed.example/form')) return { body: INNER, contentType: 'text/html' };
        return { body: 'ok', contentType: 'text/plain' };
      },
    });
    try {
      const { page } = ctx;
      await page.goto('https://ats.example/job');
      await page.frameLocator('#inner').locator('#send2').waitFor();

      await page.click('#send');
      await page.evaluate(() => (document.getElementById('f') as HTMLFormElement).submit());
      await page.evaluate(() => (document.getElementById('f') as HTMLFormElement).requestSubmit());
      await page.evaluate(() => fetch('https://ats.example/api/applications', { method: 'POST', body: 'x' }).catch(() => null));
      await page.evaluate(() => navigator.sendBeacon('https://ats.example/beacon', 'email=a@b.co'));
      await page.frameLocator('#inner').locator('#send2').click();
      await page.waitForTimeout(300);

      expect(page.url()).toBe('https://ats.example/job'); // never navigated to the action
      expect(served.every((u) => !u.includes('/apply') && !u.includes('/submit') && !u.includes('/api/applications'))).toBe(true);
      expect(ctx.blockedRequests.map((r) => r.method)).toContain('POST');
      expect(ctx.blockedRequests.some((r) => r.url.includes('/api/applications'))).toBe(true);
      expect(await submitAttempts(page)).toBeGreaterThanOrEqual(4);
    } finally {
      await ctx.close();
    }
  });
});

describe('read-only GraphQL exception (Ashby)', () => {
  const url = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting';
  const json = 'application/json';
  it('allows only queries on the allow-listed host', () => {
    expect(isReadOnlyGraphql(url, json, JSON.stringify({ operationName: 'ApiJobPosting', query: 'query ApiJobPosting { x }' }))).toBe(true);
    expect(isReadOnlyGraphql(url, json, JSON.stringify({ operationName: 'ApiSubmitApplication', query: 'mutation Submit { x }' }))).toBe(false);
    expect(isReadOnlyGraphql(url, json, JSON.stringify({ operationName: 'ApiSubmitSingleApplicationFormAction', query: 'query X { x }' }))).toBe(false);
    expect(isReadOnlyGraphql(url, json, JSON.stringify([{ query: 'query A { a }' }, { query: 'mutation B { b }' }]))).toBe(false);
    expect(isReadOnlyGraphql(url, 'multipart/form-data', 'query A')).toBe(false);
    expect(isReadOnlyGraphql('https://evil.example/api/non-user-graphql', json, JSON.stringify({ query: 'query A { a }' }))).toBe(false);
  });
});
