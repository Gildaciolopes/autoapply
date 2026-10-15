import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syncAll } from '../src/kb/sync-all.js';
import { db, deps, json, reset } from './helpers.js';

const now = () => new Date('2026-10-14T09:00:00Z'); // 06:00 in São Paulo
const ghFetch = () => {
  const pages = [json('github/page1.json'), json('github/page2.json')];
  return (async () => new Response(JSON.stringify(pages.shift()), { status: 200 })) as unknown as typeof fetch;
};
const brokenMcp = { call: async () => Promise.reject(new Error('should not be called')) };

beforeEach(async () => {
  await reset();
  process.env.GITHUB_TOKEN = 'test-token';
  await db.profileSource.create({ data: { origin: 'github', enabled: true, account: 'ana-example' } });
  await db.profileSource.create({ data: { origin: 'linkedin', enabled: false } });
});
afterAll(() => db.$disconnect());

describe('syncAll (US7)', () => {
  it('scheduled run happens at most once per local day; manual always runs', async () => {
    const d = deps([], {}, { fetch: ghFetch(), now });
    const first = await syncAll(d, { kind: 'sync_all', trigger: 'schedule' }, { linkedin: brokenMcp });
    expect(first.skipped).toBe(false);
    const second = await syncAll(deps([], {}, { fetch: ghFetch(), now }), { kind: 'sync_all', trigger: 'schedule' }, { linkedin: brokenMcp });
    expect(second).toEqual({ skipped: true, syncRunId: first.syncRunId });
    const manual = await syncAll(deps([], {}, { fetch: ghFetch(), now }), { kind: 'sync_all', trigger: 'manual' }, { linkedin: brokenMcp });
    expect(manual.skipped).toBe(false);
    expect(await db.syncRun.count()).toBe(2);
    const run = await db.syncRun.findUniqueOrThrow({ where: { id: first.syncRunId } });
    expect(run.localDate).toBe('2026-10-14');
    expect(run.outcomes).toMatchObject({ github: { status: 'success' }, linkedin: { status: 'skipped', error: 'source_disabled' } });
    expect((run.summary as { added: string[] }).added.length).toBeGreaterThan(0);
  });

  it('a failing source does not stop the others', async () => {
    await db.profileSource.update({ where: { origin: 'linkedin' }, data: { enabled: true } });
    const failingFetch = (async () => new Response('down', { status: 401 })) as unknown as typeof fetch;
    const mcp = { call: async () => Promise.reject(new Error('Session expired, please log in')) };
    const r = await syncAll(deps([], {}, { fetch: failingFetch, now }), { kind: 'sync_all', trigger: 'manual' }, { linkedin: mcp });
    const run = await db.syncRun.findUniqueOrThrow({ where: { id: r.syncRunId } });
    expect(run.outcomes).toMatchObject({ github: { status: 'failed', error: 'unauthorized' }, linkedin: { status: 'failed', error: 'session_expired' } });
    expect(run.finishedAt).not.toBeNull();
  });

  it('never modifies verified facts: differing source value → conflict', async () => {
    const f = await db.fact.create({
      data: {
        kind: 'skill',
        key: 'skill:typescript',
        value: { name: 'TypeScript' },
        verifiedByUser: true,
        sources: { create: { origin: 'resume', ref: 'resume:r1#skills[0]', rawValue: {} } },
      },
    });
    const before = await db.fact.findUniqueOrThrow({ where: { id: f.id } });
    await syncAll(deps([], {}, { fetch: ghFetch(), now }), { kind: 'sync_all', trigger: 'manual' }, { linkedin: brokenMcp });
    const after = await db.fact.findUniqueOrThrow({ where: { id: f.id }, include: { sources: true } });
    expect(after.value).toEqual(before.value);
    expect(after.verifiedByUser).toBe(true);
    expect(new Set(after.sources.map((s) => s.origin))).toEqual(new Set(['github', 'resume'])); // evidence added as sources only
  });
});
