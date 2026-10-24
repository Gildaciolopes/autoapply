/**
 * Saves an offline copy of a real public application form for adapter tests (research R11).
 *   pnpm exec tsx scripts/snapshot-form.ts <url> <name> [--api <url> ...]
 * Runs inside the dry-run context (GET only, nothing submitted). The rendered DOM of every frame is
 * saved with scripts removed (static, offline); `--api` URLs (public JSON used by adapters) are saved
 * too. Forms are empty: no personal data is stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { openDryRunContext } from '../src/apply/browser.js';

const [url, name, ...rest] = process.argv.slice(2);
if (!url || !name) {
  console.error('usage: snapshot-form.ts <url> <name> [--api <url> ...]');
  process.exit(1);
}
const apis = rest.filter((_, i) => rest[i - 1] === '--api');
const dir = join(import.meta.dirname, '../test/fixtures/apply', name);
mkdirSync(dir, { recursive: true });

const strip = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*rel=["']?(?:preload|modulepreload|prefetch|preconnect|dns-prefetch)["']?[^>]*>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');

const browser = await chromium.launch({ headless: true });
const ctx = await openDryRunContext(browser);
try {
  await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await ctx.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await ctx.page.locator('input, textarea, select').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  await ctx.page.waitForTimeout(1500);
  const frames = [];
  let i = 0;
  for (const f of ctx.page.frames()) {
    const fu = f.url();
    if (!/^https?:/.test(fu)) continue;
    const file = i === 0 ? 'page.html' : `frame-${i}.html`;
    writeFileSync(join(dir, file), strip(await f.content()));
    frames.push({ url: fu, file });
    i++;
  }
  const api: Record<string, unknown> = {};
  for (const a of apis) {
    const res = await fetch(a, { headers: { accept: 'application/json' } });
    api[a] = res.ok ? await res.json() : { status: res.status };
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ url, finalUrl: ctx.page.url(), capturedAt: new Date().toISOString().slice(0, 10), frames, api, blocked: ctx.blockedRequests.length }, null, 1));
  console.log(`saved ${name}: ${frames.length} frame(s), ${apis.length} api, blocked ${ctx.blockedRequests.length} non-GET`);
} finally {
  await ctx.close();
  await browser.close();
}
