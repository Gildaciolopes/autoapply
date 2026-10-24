import { readFileSync } from 'node:fs';
import { FakeLlmProvider } from '@autoapply/llm';
import type { Browser } from 'playwright';
import type { FixtureServer } from '../src/apply/browser.js';
import type { ApplyDeps } from '../src/apply/run.js';
import { db } from './helpers.js';
import { seedTailorPersona } from './tailor-helpers.js';

const dir = (name: string) => new URL(`./fixtures/apply/${name}/`, import.meta.url);

interface Meta {
  url: string;
  finalUrl: string;
  frames: { url: string; file: string }[];
  api: Record<string, unknown>;
}
export const meta = (name: string): Meta => JSON.parse(readFileSync(new URL('meta.json', dir(name)), 'utf8'));

const noHash = (u: string) => u.split('#')[0]!;

/** Serves saved form snapshots at their original URLs (offline); everything else is aborted. */
export function fixtureServer(names: string[], extra: Record<string, string> = {}): FixtureServer {
  const pages = new Map<string, string>(Object.entries(extra).map(([u, html]) => [noHash(u), html]));
  for (const n of names) {
    const m = meta(n);
    for (const f of m.frames) pages.set(noHash(f.url), readFileSync(new URL(f.file, dir(n)), 'utf8'));
    pages.set(noHash(m.url), readFileSync(new URL(m.frames[0]!.file, dir(n)), 'utf8'));
  }
  return (url, method) => {
    if (method !== 'GET') return null;
    const html = pages.get(noHash(url));
    return html ? { body: html, contentType: 'text/html; charset=utf-8' } : null;
  };
}

/** Public JSON APIs from the snapshots' meta (adapter hints, posting checks). */
export function fixtureFetch(names: string[]): typeof fetch {
  const api = Object.assign({}, ...names.map((n) => meta(n).api)) as Record<string, unknown>;
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = api[url];
    return new Response(body === undefined ? '{}' : JSON.stringify(body), { status: body === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/** LLM fake: valid cited summary for tailoring; "don't know" for every form field. */
export function applyLlm(fieldAnswers: (m: { content: string }[]) => unknown = () => ({ answers: [] })) {
  return new FakeLlmProvider(((m: { role: string; content: string }[]) => {
    const sys = m[0]?.content ?? '';
    if (/professional summary/.test(sys)) return { sentences: [{ text: 'Engenheira de Software Sênior com experiência em NestJS e TypeScript.', factIds: ['f-exp1', 'f-ts'] }] };
    if (/application form/.test(sys)) return fieldAnswers(m);
    return { sentences: [] };
  }) as never);
}

/** Persona Ana + personal facts + full profile, job pointing to `applyUrl`, queued dry-run application. */
export async function seedApplyPersona(applyUrl: string, jobOver: { title?: string; company?: string; description?: string } = {}) {
  const job = await seedTailorPersona(jobOver);
  await db.profile.update({
    where: { id: 'me' },
    data: { phone: '+55 11 98765-4321', city: 'São Paulo', state: 'SP', linkedinUrl: 'https://www.linkedin.com/in/ana-souza-example', githubUser: 'ana-souza-example' },
  });
  const personal: [string, unknown][] = [
    ['salaryExpectation', { amount: 15000, currency: 'BRL', contract: 'clt', period: 'month' }],
    ['noticePeriodDays', 30],
    ['workAuthorization', { brazil: 'citizen', others: [] }],
    ['workModes', ['remote', 'hybrid']],
    ['relocate', 'no'],
  ];
  for (const [field, value] of personal) {
    await db.fact.create({ data: { id: `p-${field}`, kind: 'personal', key: `personal:${field}`, value: { field, value } as never, verifiedByUser: true } });
  }
  await db.fact.create({ data: { id: 'f-en', kind: 'language', key: 'language:en', value: { language: 'Inglês', fluency: 'Intermediário' }, verifiedByUser: true } });
  await db.job.update({ where: { id: job.id }, data: { applyUrl } });
  const app = await db.application.create({ data: { jobId: job.id, mode: 'dry_run', status: 'queued', attempts: 1 } });
  return { job, app };
}

export function applyDeps(browser: Browser, names: string[], opts: { extra?: Record<string, string>; llm?: FakeLlmProvider; blobs?: Record<string, Buffer> } = {}): ApplyDeps {
  const blobs = opts.blobs ?? {};
  return {
    db,
    llm: opts.llm ?? applyLlm(),
    storage: {
      get: async (k) => blobs[k] ?? Buffer.alloc(0),
      put: async (k, b) => {
        blobs[k] = b;
      },
    },
    models: { chat: 'fake-chat', vision: '' },
    browser: async () => browser,
    serve: fixtureServer(names, opts.extra),
    fetch: fixtureFetch(names),
  };
}
