import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processRun } from '../src/jobs/run.js';
import { db } from './helpers.js';
import { jobsDeps, raw, resetAll, seedFacts, seedPrefs, seedSources } from './jobs-helpers.js';

async function newRun() {
  return (await db.discoveryRun.create({ data: { trigger: 'manual', localDate: '2026-10-15' } })).id;
}

beforeEach(async () => {
  await resetAll();
  await seedSources({ indeed: 2 });
  await seedPrefs();
  await seedFacts();
});
afterAll(() => db.$disconnect());

describe('process-run (US2)', () => {
  it('merges the same posting from two boards into one job with two origins', async () => {
    const runId = await newRun();
    const children = {
      a: { source: 'gupy', jobs: [raw({ externalId: 'g1', company: 'Víssimo', title: 'Desenvolvedor(a) Full Stack (com ênfase em Frontend)', workMode: 'remote' })] },
      b: { source: 'indeed', jobs: [raw({ source: 'indeed', externalId: 'in1', company: 'Vissimo Ltda.', title: 'Desenvolvedor Full Stack', workMode: undefined, location: '100% remoto' })] },
    };
    await processRun(jobsDeps(), { runId, rescore: false, judge: false }, children);
    const jobs = await db.job.findMany({ include: { origins: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.origins.map((o) => o.source).sort()).toEqual(['gupy', 'indeed']);
    const run = await db.discoveryRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('done');
    expect(run.outcomes).toMatchObject({ gupy: { found: 1, new: 1, duplicates: 0 }, indeed: { found: 1, new: 0, duplicates: 1 } });
  });

  it('a failing source is recorded and does not stop others', async () => {
    const runId = await newRun();
    await processRun(jobsDeps(), { runId, rescore: false, judge: false }, {
      a: { source: 'gupy', jobs: [raw({})] },
      b: { source: 'linkedin_mcp', jobs: [], error: 'session_expired' },
    });
    const run = await db.discoveryRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.outcomes).toMatchObject({ gupy: { status: 'success', new: 1 }, linkedin_mcp: { status: 'failed', error: 'session_expired' } });
    expect((await db.source.findUniqueOrThrow({ where: { type: 'linkedin_mcp' } })).lastError).toBe('session_expired');
  });

  it('daily cap counts NEW jobs per source (indeed cap 2)', async () => {
    const runId = await newRun();
    const jobs = [1, 2, 3, 4].map((i) => raw({ source: 'indeed', externalId: `in${i}`, title: `Desenvolvedor Full Stack ${i}`, company: `Co ${i}`, postedAt: `2026-10-1${i}` }));
    await processRun(jobsDeps(), { runId, rescore: false, judge: false }, { a: { source: 'indeed', jobs } });
    const kept = await db.jobOrigin.findMany({ where: { source: 'indeed' } });
    expect(kept.map((o) => o.externalId).sort()).toEqual(['in3', 'in4']); // newest first
  });

  it('seeing the same origin again is a duplicate and updates lastSeenAt', async () => {
    const j = raw({ externalId: 'g9' });
    await processRun(jobsDeps(), { runId: await newRun(), rescore: false, judge: false }, { a: { source: 'gupy', jobs: [j] } });
    const before = (await db.job.findFirstOrThrow()).lastSeenAt;
    await new Promise((r) => setTimeout(r, 10));
    const runId = await newRun();
    await processRun(jobsDeps(), { runId, rescore: false, judge: false }, { a: { source: 'gupy', jobs: [j] } });
    expect(await db.job.count()).toBe(1);
    expect((await db.job.findFirstOrThrow()).lastSeenAt.getTime()).toBeGreaterThan(before.getTime());
    expect((await db.discoveryRun.findUniqueOrThrow({ where: { id: runId } })).outcomes).toMatchObject({ gupy: { new: 0, duplicates: 1 } });
  });
});
