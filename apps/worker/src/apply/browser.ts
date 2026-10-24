import type { Browser, BrowserContext, Page } from 'playwright';

/** Offline fixture server used by tests: returns a response for a URL, or null (→ aborted). */
export type FixtureServer = (url: string, method: string, body: string | null) => { body: string | Buffer; contentType: string; status?: number } | null;

export interface DryRunContext {
  context: BrowserContext;
  page: Page;
  /** Non-GET requests and websockets stopped by the guard (FR-001 evidence). */
  blockedRequests: { method: string; url: string }[];
  close(): Promise<void>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Hosts whose job pages load the form through GraphQL POST *queries* (Ashby). */
const READ_ONLY_GRAPHQL = [/^https:\/\/jobs\.ashbyhq\.com\/api\/non-user-graphql(\?|$)/];

/**
 * The single exception to "GET only" (research R1): a GraphQL request on an allow-listed ATS host whose
 * body is JSON with one read operation (`query …`), no mutation, no file. Anything else is blocked.
 */
export function isReadOnlyGraphql(url: string, contentType: string | undefined, body: string | null): boolean {
  if (!READ_ONLY_GRAPHQL.some((re) => re.test(url)) || !body || !/application\/json/i.test(contentType ?? '')) return false;
  try {
    const ops = ([] as unknown[]).concat(JSON.parse(body));
    return ops.every((op) => {
      const q = typeof (op as { query?: unknown }).query === 'string' ? ((op as { query: string }).query as string) : '';
      const name = String((op as { operationName?: unknown }).operationName ?? '');
      return /^\s*query\b/.test(q) && !/\bmutation\b|\bsubscription\b/i.test(q) && !/submit|create|upload|apply|update|delete/i.test(name);
    });
  } catch {
    return false;
  }
}

/**
 * Runs in every frame before page scripts: no form can be submitted from this context
 * (submit events cancelled, programmatic submit() / requestSubmit() turned into counters).
 */
const SUBMIT_TRAP = `(() => {
  if (window.__aaTrap) return;
  window.__aaTrap = true;
  window.__aaSubmitAttempts = 0;
  window.__aaSubmits = [];
  const count = (form) => {
    window.__aaSubmitAttempts = (window.__aaSubmitAttempts || 0) + 1;
    try {
      const els = form ? [...form.elements] : [];
      window.__aaSubmits.push({ action: form ? String(form.action || '') : '', fields: els.filter((e) => e.type !== 'hidden').length, hasEmail: els.some((e) => e.type === 'email' || /mail/i.test(e.name || '')) });
    } catch (_) {}
  };
  window.addEventListener('submit', (e) => { count(e.target); e.preventDefault(); e.stopImmediatePropagation(); }, true);
  HTMLFormElement.prototype.submit = function () { count(this); };
  HTMLFormElement.prototype.requestSubmit = function () { count(this); };
})();`;

/**
 * The ONLY way the apply engine may open a page (research R1). Every request that is not
 * GET/HEAD/OPTIONS is aborted for every host, websockets are closed, service workers blocked,
 * and form submission is trapped in every frame. Plain Chromium: no stealth, default user agent.
 */
export async function openDryRunContext(browser: Browser, opts: { serve?: FixtureServer } = {}): Promise<DryRunContext> {
  const blockedRequests: { method: string; url: string }[] = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await context.addInitScript(SUBMIT_TRAP);
  await context.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    if (!SAFE_METHODS.has(method) && !(method === 'POST' && isReadOnlyGraphql(req.url(), req.headers()['content-type'], req.postData()))) {
      blockedRequests.push({ method, url: req.url() });
      return route.abort('blockedbyclient');
    }
    if (opts.serve) {
      const res = opts.serve(req.url(), method, req.postData());
      if (!res) return route.abort('internetdisconnected');
      return route.fulfill({ status: res.status ?? 200, contentType: res.contentType, body: res.body });
    }
    return route.continue();
  });
  await context.routeWebSocket(/.*/, (ws) => {
    blockedRequests.push({ method: 'WEBSOCKET', url: ws.url() });
    void ws.close();
  });
  const page = await context.newPage();
  return {
    context,
    page,
    blockedRequests,
    close: () => context.close(),
  };
}

export interface SubmitAttempt {
  action: string;
  fields: number;
  hasEmail: boolean;
}

/** Every submit the trap stopped, across frames (page scripts included, e.g. resume-parse forms). */
export async function submitLog(page: Page): Promise<SubmitAttempt[]> {
  const out: SubmitAttempt[] = [];
  for (const frame of page.frames()) {
    const list = await frame.evaluate('window.__aaSubmits || []').catch(() => []);
    out.push(...(list as SubmitAttempt[]));
  }
  return out;
}

/** Submit attempts recorded by the trap across all frames (must stay 0). */
export async function submitAttempts(page: Page): Promise<number> {
  let total = 0;
  for (const frame of page.frames()) {
    total += await frame.evaluate(() => (window as unknown as { __aaSubmitAttempts?: number }).__aaSubmitAttempts ?? 0).catch(() => 0);
  }
  return total;
}

export async function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
}
