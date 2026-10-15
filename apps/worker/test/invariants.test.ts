/**
 * Cross-importer invariants (contracts/queue-sync-profile.md, SC-003, SC-005):
 * after resume confirm + GitHub + LinkedIn imports + sync, every fact has ≥1 source,
 * importers never verified anything, and verified values never changed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMerge } from '@autoapply/db';
import { draftToCandidates, mergeCandidates } from '@autoapply/kb';
import { ResumeDraft } from '@autoapply/shared';
import { importGithub } from '../src/kb/github-importer.js';
import { importLinkedin } from '../src/kb/linkedin-importer.js';
import { syncAll } from '../src/kb/sync-all.js';
import { db, deps, json, reset } from './helpers.js';

const ghFetch = () => {
  const pages = [json('github/page1.json'), json('github/page2.json')];
  return (async () => new Response(JSON.stringify(pages.shift()), { status: 200 })) as unknown as typeof fetch;
};
const mcp = { call: async () => json('linkedin/get_my_profile.json') };
let verifiedBefore: { id: string; value: unknown }[] = [];

beforeAll(async () => {
  await reset();
  process.env.GITHUB_TOKEN = 'test-token';
  const draft = ResumeDraft.parse({
    basics: { name: 'Ana' },
    work: [{ id: 'work-0', name: 'Xeno Tecnologia Ltda', position: 'Engenheira de Software Sênior', startDate: { year: 2021, month: 3, precision: 'month' }, endDate: 'present' }],
    skills: [{ id: 'skills-0', name: 'TypeScript' }, { id: 'skills-1', name: 'Python' }],
  });
  await applyMerge(db, mergeCandidates([], draftToCandidates(draft, 'r1')), { actor: 'user', verify: true });
  verifiedBefore = await db.fact.findMany({ where: { verifiedByUser: true }, select: { id: true, value: true } });

  await db.profileSource.create({ data: { origin: 'github', enabled: true, account: 'ana-example' } });
  await db.profileSource.create({ data: { origin: 'linkedin', enabled: true } });
  const run = await db.syncRun.create({ data: { trigger: 'import', localDate: '2026-10-14' } });
  await importGithub(deps([], {}, { fetch: ghFetch() }), run.id);
  await importLinkedin(deps([json('llm/linkedin-ana.json')]), run.id, mcp);
  await syncAll(deps([json('llm/linkedin-ana.json')], {}, { fetch: ghFetch() }), { kind: 'sync_all', trigger: 'manual' }, { linkedin: mcp });
});
afterAll(() => db.$disconnect());

describe('knowledge-base invariants', () => {
  it('every fact has at least one source (SC-003)', async () => {
    expect(await db.fact.count({ where: { sources: { none: {} } } })).toBe(0);
    expect(await db.fact.count()).toBeGreaterThan(10);
  });

  it('importers never verify: only the 3 user-confirmed facts are verified', async () => {
    const verified = await db.fact.findMany({ where: { verifiedByUser: true }, select: { id: true } });
    expect(verified.map((v) => v.id).sort()).toEqual(verifiedBefore.map((v) => v.id).sort());
    const importRevisions = await db.factRevision.count({ where: { action: 'verified', actor: { in: ['import', 'sync'] } } });
    expect(importRevisions).toBe(0);
  });

  it('verified values are unchanged; differences became conflicts (SC-005)', async () => {
    for (const v of verifiedBefore) {
      expect((await db.fact.findUniqueOrThrow({ where: { id: v.id } })).value).toEqual(v.value);
    }
    expect(await db.factConflict.count({ where: { status: 'open', type: 'value_mismatch' } })).toBeGreaterThanOrEqual(1);
  });

  it('every pipeline step emitted RunEvents', async () => {
    expect(await db.runEvent.count({ where: { queue: 'sync-profile' } })).toBeGreaterThanOrEqual(3);
  });
});
