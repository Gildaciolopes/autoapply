import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMerge } from '@autoapply/db';
import { draftToCandidates, mergeCandidates } from '@autoapply/kb';
import { ResumeDraft } from '@autoapply/shared';
import { importLinkedin } from '../src/kb/linkedin-importer.js';
import { db, deps, json, reset } from './helpers.js';

const profileOutput = json('linkedin/get_my_profile.json');
const recordedMapping = json('llm/linkedin-ana.json');

/** Persona Ana's confirmed resume facts (verified). */
async function seedResumeFacts() {
  const draft = ResumeDraft.parse({
    basics: { name: 'Ana Beatriz Souza' },
    work: [
      { id: 'work-0', name: 'Xeno Tecnologia Ltda', position: 'Engenheira de Software Sênior', startDate: { year: 2021, month: 3, precision: 'month' }, endDate: 'present' },
      { id: 'work-1', name: 'Loja Fácil', position: 'Desenvolvedora Pleno', startDate: { year: 2018, month: 6, precision: 'month' }, endDate: { year: 2021, month: 2, precision: 'month' } },
    ],
    skills: [{ id: 'skills-0', name: 'TypeScript' }],
  });
  await applyMerge(db, mergeCandidates([], draftToCandidates(draft, 'r1')), { actor: 'user', verify: true });
}

const mcp = (impl: () => Promise<unknown>) => {
  const calls: string[] = [];
  return { calls, call: async (name: string) => (calls.push(name), impl()) };
};

beforeEach(async () => {
  await reset();
  await seedResumeFacts();
});
afterAll(() => db.$disconnect());

async function run(enabled: boolean, client: ReturnType<typeof mcp>, llm: unknown[] = [recordedMapping]) {
  await db.profileSource.create({ data: { origin: 'linkedin', enabled } });
  const runId = (await db.syncRun.create({ data: { trigger: 'import', localDate: '2026-10-14' } })).id;
  return importLinkedin(deps(llm), runId, client);
}

describe('importLinkedin (US5)', () => {
  it('disabled → no MCP call at all (opt-in, FR-016)', async () => {
    const client = mcp(async () => profileOutput);
    expect(await run(false, client)).toEqual({ status: 'skipped' });
    expect(client.calls).toEqual([]);
  });

  it('equal items add a LinkedIn source; differing title opens a conflict; new items unverified', async () => {
    const client = mcp(async () => profileOutput);
    const out = await run(true, client);
    expect(out.status).toBe('success');
    expect(client.calls).toEqual(['get_my_profile']);

    const loja = await db.fact.findFirstOrThrow({ where: { key: 'experience:loja-facil:2018' }, include: { sources: true } });
    expect(loja.sources.map((s) => s.origin).sort()).toEqual(['linkedin', 'resume']);
    expect(loja.verifiedByUser).toBe(true);

    const xeno = await db.fact.findFirstOrThrow({ where: { key: 'experience:xeno-tecnologia:2021' }, include: { conflicts: true } });
    expect((xeno.value as { title: string }).title).toBe('Engenheira de Software Sênior'); // verified value untouched
    expect(xeno.hasOpenConflict).toBe(true);
    const cands = xeno.conflicts[0]!.candidates as { origin: string; value: { title: string } }[];
    expect(cands.map((c) => [c.origin, c.value.title])).toEqual([
      ['resume', 'Engenheira de Software Sênior'],
      ['linkedin', 'Tech Lead'],
    ]);

    const ts = await db.fact.findFirstOrThrow({ where: { key: 'skill:typescript' }, include: { sources: true } });
    expect(ts.sources).toHaveLength(2);
    const gql = await db.fact.findFirstOrThrow({ where: { key: 'skill:graphql' }, include: { sources: true } });
    expect(gql.verifiedByUser).toBe(false);
    expect(gql.sources[0]!.ref).toMatch(/^linkedin:skills\[\d+\]$/);
    expect(await db.fact.count({ where: { key: { startsWith: 'experience:' } } })).toBe(2); // no duplicates
  });

  it('items the LLM invents that are not in the tool output are dropped', async () => {
    const tampered = { ...recordedMapping as object, skills: [...(recordedMapping as { skills: unknown[] }).skills, { name: 'Kubernetes', quote: 'Kubernetes' }] };
    await run(true, mcp(async () => profileOutput), [tampered]);
    expect(await db.fact.findFirst({ where: { key: 'skill:kubernetes' } })).toBeNull();
    expect(await db.runEvent.count({ where: { message: { contains: 'dropped' } } })).toBe(1);
  });

  it('session error → failed session_expired, nothing written', async () => {
    const before = await db.fact.count();
    const out = await run(true, mcp(async () => Promise.reject(new Error('linkedin-mcp get_my_profile failed: please log in again'))));
    expect(out).toEqual({ status: 'failed', error: 'session_expired' });
    expect(await db.fact.count()).toBe(before);
    expect((await db.profileSource.findUniqueOrThrow({ where: { origin: 'linkedin' } })).lastError).toBe('session_expired');
  });

  it('extraction failure records a failed outcome (and rethrows for retry)', async () => {
    await expect(run(true, mcp(async () => profileOutput), [new Error('ollama down')])).rejects.toThrow('ollama down');
    const r = await db.syncRun.findFirstOrThrow();
    expect(r.outcomes).toMatchObject({ linkedin: { status: 'failed', error: 'extraction_failed' } });
    expect(r.finishedAt).not.toBeNull();
  });

  it('a dropped (misread) item does not flag existing facts of that kind as missing', async () => {
    await run(true, mcp(async () => profileOutput)); // first import: LinkedIn sources on skills/experience
    const misread = structuredClone(recordedMapping) as { skills: { name: string; quote: string }[] };
    misread.skills = misread.skills.map((s) => (s.name === 'GraphQL' ? { name: 'GraphQLL', quote: 'GraphQLL' } : s));
    const runId = (await db.syncRun.create({ data: { trigger: 'manual', localDate: '2026-10-15' } })).id;
    await importLinkedin(deps([misread]), runId, mcp(async () => profileOutput));
    const gql = await db.fact.findFirstOrThrow({ where: { key: 'skill:graphql' } });
    expect(gql.missingFrom).toEqual([]);
  });
});
