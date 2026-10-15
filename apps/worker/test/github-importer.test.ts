import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { importGithub } from '../src/kb/github-importer.js';
import { db, deps, json, reset } from './helpers.js';

function fakeFetch(pages: unknown[]) {
  const calls: unknown[] = [];
  const f = (async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body).variables);
    const body = pages.shift();
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function seed() {
  await db.profileSource.create({ data: { origin: 'github', enabled: true, account: 'ana-example' } });
  return (await db.syncRun.create({ data: { trigger: 'import', localDate: '2026-10-14' } })).id;
}

beforeEach(async () => {
  await reset();
  process.env.GITHUB_TOKEN = 'test-token';
});
afterAll(() => db.$disconnect());

describe('importGithub (US4)', () => {
  it('imports repos → unverified skill facts with repo/file provenance', async () => {
    const runId = await seed();
    const { f, calls } = fakeFetch([json('github/page1.json'), json('github/page2.json')]);
    const out = await importGithub(deps([], {}, { fetch: f }), runId);
    expect(out.status).toBe('success');
    expect(calls).toEqual([{ login: 'ana-example', cursor: null }, { login: 'ana-example', cursor: 'c1' }]);

    const facts = await db.fact.findMany({ include: { sources: true }, orderBy: { key: 'asc' } });
    expect(facts.every((x) => !x.verifiedByUser && x.sources.length > 0 && x.sources.every((s) => s.ref.startsWith('github:ana-example/')))).toBe(true);
    const keys = facts.map((x) => x.key);
    expect(keys).toEqual(
      expect.arrayContaining(['skill:typescript', 'skill:nestjs', 'skill:prisma', 'skill:vitest', 'skill:python', 'skill:fastapi', 'skill:pandas', 'skill:vue', 'skill:rails', 'skill:docker', 'skill:redis', 'skill:postgresql', 'skill:kubernetes', 'skill:terraform']),
    );
    expect(keys).not.toContain('skill:left-pad'); // unknown deps are ignored
    const nest = facts.find((x) => x.key === 'skill:nestjs')!;
    expect(nest.sources.map((s) => s.ref).sort()).toEqual(['github:ana-example/payments-api:README.md', 'github:ana-example/payments-api:package.json']);
    const vue = facts.find((x) => x.key === 'skill:vue')!;
    expect((vue.value as { evidence: { forkOnly: boolean } }).evidence.forkOnly).toBe(true);
    const rails = facts.find((x) => x.key === 'skill:rails')!;
    expect((rails.value as { evidence: { archivedOnly: boolean } }).evidence.archivedOnly).toBe(true);

    const run = await db.syncRun.findUniqueOrThrow({ where: { id: runId } });
    expect((run.outcomes as { github: { status: string } }).github.status).toBe('success');
    expect((await db.profileSource.findUniqueOrThrow({ where: { origin: 'github' } })).lastStatus).toBe('success');
  });

  it('low rate limit → partial, resumeAt set, delayed re-import queued, nothing flagged missing', async () => {
    const runId = await seed();
    const { f } = fakeFetch([json('github/page1-low-rate.json')]);
    const added: { name: string; opts: { delay: number } }[] = [];
    const queue = { add: async (name: string, _d: unknown, opts: { delay: number }) => (added.push({ name, opts }), {}) };
    const out = await importGithub(deps([], {}, { fetch: f }), runId, { queue: queue as never });
    expect(out.status).toBe('partial');
    const src = await db.profileSource.findUniqueOrThrow({ where: { origin: 'github' } });
    expect(src).toMatchObject({ lastStatus: 'partial', lastError: 'rate_limited' });
    expect(src.resumeAt?.toISOString()).toBe('2026-10-15T03:00:00.000Z');
    expect(added[0]!.name).toBe('import_github');
    expect(await db.fact.count({ where: { missingFrom: { has: 'github' } } })).toBe(0);
  });

  it('invalid token → failed unauthorized, no facts', async () => {
    const runId = await seed();
    const { f } = fakeFetch([new Response('bad', { status: 401 })]);
    expect(await importGithub(deps([], {}, { fetch: f }), runId)).toEqual({ status: 'failed', error: 'unauthorized' });
    expect(await db.fact.count()).toBe(0);
  });

  it('second complete import with a vanished repo flags missing, keeps the fact', async () => {
    const runId = await seed();
    await importGithub(deps([], {}, { fetch: fakeFetch([json('github/page1.json'), json('github/page2.json')]).f }), runId);
    const onlyPage1 = json<{ data: { user: { repositories: { pageInfo: { hasNextPage: boolean } } } } }>('github/page1.json');
    onlyPage1.data.user.repositories.pageInfo.hasNextPage = false;
    await importGithub(deps([], {}, { fetch: fakeFetch([onlyPage1]).f }), runId, { actor: 'sync' });
    const rails = await db.fact.findFirstOrThrow({ where: { key: 'skill:rails' } });
    expect(rails).toMatchObject({ status: 'active', missingFrom: ['github'] });
    const ts = await db.fact.findFirstOrThrow({ where: { key: 'skill:typescript' } });
    expect(ts.missingFrom).toEqual([]);
  });
});
