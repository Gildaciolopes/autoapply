import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { connectSession, LOGIN, testSession } from '../src/apply/sessions.js';
import { decryptSession } from '../src/apply/session-crypto.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { applyDeps, platformPage } from './apply-helpers.js';

let browser: Browser;
beforeAll(async () => {
  process.env.SESSION_ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
beforeEach(resetAll);

const page = (html: string) => ({ body: html, contentType: 'text/html; charset=utf-8' });

describe('connect / test session (US1)', { timeout: 60_000 }, () => {
  it('user logs in in the window → session stored encrypted, connected', async () => {
    const deps = applyDeps(browser, []);
    const status = await connectSession(deps, 'linkedin', {
      launch: () => chromium.launch({ headless: true }),
      pollMs: 200,
      serve: (url) => (url.startsWith(LOGIN.linkedin.url) ? page(platformPage('login-fake.html')) : null),
    });
    expect(status).toBe('connected');
    const p = await db.platform.findUniqueOrThrow({ where: { kind: 'linkedin' } });
    expect(p.sessionStatus).toBe('connected');
    expect(p.sessionEnc).not.toContain('FAKE-SESSION-COOKIE');
    const state = decryptSession<{ cookies: { name: string; value: string }[] }>(p.sessionEnc!);
    expect(state.cookies.find((c) => c.name === 'li_at')?.value).toBe('FAKE-SESSION-COOKIE-123456');
    expect(p.accountLabel).toBe('Feed');
  });

  it('cancel from the UI → not connected, nothing stored', async () => {
    const deps = applyDeps(browser, []);
    const run = connectSession(deps, 'gupy', {
      launch: () => chromium.launch({ headless: true }),
      pollMs: 100,
      serve: (url) => (url.startsWith(LOGIN.gupy.url) ? page(platformPage('gupy-login.html')) : null),
    });
    await new Promise((r) => setTimeout(r, 700));
    await db.platform.update({ where: { kind: 'gupy' }, data: { connectRequest: 'cancel' } });
    expect(await run).toBe('disconnected');
    expect((await db.platform.findUniqueOrThrow({ where: { kind: 'gupy' } })).sessionEnc).toBeNull();
  });

  it('test session: logged-in page → valid; login wall → expired', async () => {
    const deps = applyDeps(browser, []);
    await connectSession(deps, 'linkedin', {
      launch: () => chromium.launch({ headless: true }),
      pollMs: 200,
      serve: (url) => (url.startsWith(LOGIN.linkedin.url) ? page(platformPage('login-fake.html')) : null),
    });
    const feed = '<html><body><h1>Página inicial</h1><p>Ana Souza</p></body></html>';
    expect(await testSession({ ...deps, serve: (url) => (url.startsWith(LOGIN.linkedin.testUrl) ? page(feed) : null) }, 'linkedin')).toBe(true);
    expect(await testSession({ ...deps, serve: (url) => (url.startsWith(LOGIN.linkedin.testUrl) ? page(platformPage('linkedin-authwall.html')) : null) }, 'linkedin')).toBe(false);
    expect((await db.platform.findUniqueOrThrow({ where: { kind: 'linkedin' } })).sessionStatus).toBe('expired');
  });
});
