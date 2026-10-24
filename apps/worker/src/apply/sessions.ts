import type { Browser, BrowserContext, Page } from 'playwright';
import type { SessionPlatform } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { openDryRunContext, type FixtureServer, type StorageState } from './browser.js';
import { ensurePlatform } from './gate.js';
import { SessionKeyError, decryptSession, encryptSession, sessionKey } from './session-crypto.js';

interface LoginSpec {
  url: string;
  /** Logged-in signal from cookies / current URL (the system never touches the login form). */
  loggedIn(cookies: { name: string; domain: string; value: string }[], url: string): boolean;
  /** A page that only renders for a logged-in user (session test). */
  testUrl: string;
  loginWall(url: string, text: string): boolean;
}

export const LOGIN: Record<SessionPlatform, LoginSpec> = {
  gupy: {
    url: 'https://login.gupy.io/candidates/signin',
    loggedIn: (cookies, url) => !/login\.gupy\.io/.test(url) && /gupy\.io/.test(url) && cookies.some((c) => /gupy\.io$/.test(c.domain.replace(/^\./, '')) && /token|auth|session/i.test(c.name) && c.value.length > 10),
    testUrl: 'https://login.gupy.io/candidates/applications',
    loginWall: (url, text) => /login\.gupy\.io\/candidates\/signin|\/signin/.test(url) || /\b(entrar|fazer login)\b/i.test(text.slice(0, 500)),
  },
  linkedin: {
    url: 'https://www.linkedin.com/login',
    loggedIn: (cookies) => cookies.some((c) => c.name === 'li_at' && c.value.length > 10),
    testUrl: 'https://www.linkedin.com/feed/',
    loginWall: (url, text) => /\/(login|authwall|checkpoint|uas\/login)/.test(url) || /\b(sign in|entrar)\b/i.test(text.slice(0, 300)),
  },
};

export interface ConnectOptions {
  /** Headed Chromium on the user's desktop (tests: headless + a fake login page). */
  launch: () => Promise<Browser>;
  pollMs?: number;
  timeoutMs?: number;
  serve?: FixtureServer;
  login?: Partial<LoginSpec>;
}

const text = (page: Page) => page.evaluate('document.body ? document.body.innerText : ""').then(String).catch(() => '');

/**
 * Connect flow (research R2): opens the platform's own login page in a visible window and waits for
 * the user to sign in there. Nothing is typed or clicked by the system; the resulting session is
 * stored encrypted. Returns the final session status.
 */
export async function connectSession(deps: KbDeps, kind: SessionPlatform, opts: ConnectOptions): Promise<'connected' | 'disconnected' | 'expired'> {
  const { db } = deps;
  const spec = { ...LOGIN[kind], ...opts.login };
  const key = sessionKey();
  const before = await ensurePlatform(db, kind);
  if (!key) {
    await db.platform.update({ where: { kind }, data: { sessionStatus: before.sessionEnc ? 'expired' : 'disconnected', connectRequest: null } });
    throw new SessionKeyError('SESSION_ENCRYPTION_KEY missing or invalid');
  }
  await db.platform.update({ where: { kind }, data: { sessionStatus: 'connecting', connectRequest: null } });
  const restore = before.sessionEnc ? (before.sessionStatus === 'connected' ? 'connected' : 'expired') : 'disconnected';
  const browser = await opts.launch();
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ viewport: { width: 1100, height: 850 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    if (opts.serve) {
      const serve = opts.serve;
      await context.route('**/*', async (route) => {
        const r = serve(route.request().url(), route.request().method(), route.request().postData());
        return r ? route.fulfill({ status: r.status ?? 200, contentType: r.contentType, body: r.body }) : route.abort();
      });
    }
    const page = await context.newPage();
    let closed = false;
    page.on('close', () => (closed = true));
    await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    const deadline = Date.now() + (opts.timeoutMs ?? 600_000);
    let ok = false;
    while (Date.now() < deadline && !closed) {
      const cookies = await context.cookies();
      if (spec.loggedIn(cookies, page.url())) {
        ok = true;
        break;
      }
      const req = (await db.platform.findUniqueOrThrow({ where: { kind } })).connectRequest;
      if (req === 'cancel') break;
      if (req === 'done') {
        ok = spec.loggedIn(cookies, page.url()) || cookies.length > 0;
        break;
      }
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
    }
    if (!ok) {
      await db.platform.update({ where: { kind }, data: { sessionStatus: restore, connectRequest: null } });
      await db.runEvent.create({ data: { queue: 'apply', level: 'warn', message: `connect ${kind}: not connected (${closed ? 'window closed' : 'cancelled/timeout'})` } });
      return restore;
    }
    const label = (await page.title().catch(() => '')).replace(/\s*[|–-].*$/, '').trim() || null;
    const state = await context.storageState();
    await db.platform.update({
      where: { kind },
      data: { sessionEnc: encryptSession(state, key), sessionStatus: 'connected', connectedAt: new Date(), accountLabel: label, connectRequest: null, lastTestOk: true, lastTestAt: new Date() },
    });
    await db.runEvent.create({ data: { queue: 'apply', level: 'info', message: `connect ${kind}: connected` } });
    return 'connected';
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/** Decrypted session of a platform, or null (missing, wrong key → marked expired). */
export async function loadStorageState(deps: KbDeps, kind: SessionPlatform): Promise<StorageState | null> {
  const p = await ensurePlatform(deps.db, kind);
  if (!p.sessionEnc || p.sessionStatus === 'disconnected') return null;
  try {
    return decryptSession<StorageState>(p.sessionEnc);
  } catch (e) {
    if (e instanceof SessionKeyError) await deps.db.platform.update({ where: { kind }, data: { sessionStatus: 'expired' } });
    return null;
  }
}

export async function markSessionExpired(deps: KbDeps, kind: SessionPlatform) {
  await deps.db.platform.update({ where: { kind }, data: { sessionStatus: 'expired', lastTestOk: false, lastTestAt: new Date() } });
}

/** Read-only check (dry-run context) that the stored session still opens a logged-in page. */
export async function testSession(deps: KbDeps & { browser: () => Promise<Browser>; serve?: FixtureServer }, kind: SessionPlatform, login?: Partial<LoginSpec>): Promise<boolean> {
  const spec = { ...LOGIN[kind], ...login };
  const state = await loadStorageState(deps, kind);
  if (!state) {
    await markSessionExpired(deps, kind);
    return false;
  }
  const ctx = await openDryRunContext(await deps.browser(), { storageState: state, serve: deps.serve });
  try {
    await ctx.page.goto(spec.testUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const ok = !spec.loginWall(ctx.page.url(), await text(ctx.page));
    await deps.db.platform.update({ where: { kind }, data: { lastTestAt: new Date(), lastTestOk: ok, sessionStatus: ok ? 'connected' : 'expired' } });
    await deps.db.runEvent.create({ data: { queue: 'apply', level: ok ? 'info' : 'warn', message: `test ${kind}: ${ok ? 'valid' : 'expired'}` } });
    return ok;
  } finally {
    await ctx.close();
  }
}
