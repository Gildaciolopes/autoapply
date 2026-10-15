import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processRun } from '../src/jobs/run.js';
import { db } from './helpers.js';
import { jobsDeps, raw, resetAll, seedFacts, seedPrefs, seedSources } from './jobs-helpers.js';

let facts: Record<string, string>;
beforeEach(async () => {
  await resetAll();
  await seedSources();
  await seedPrefs({ blockedCompanies: ['Empresa Ruim'], excludeKeywords: ['php'], judgeTopN: 2 });
  facts = await seedFacts();
});
afterAll(() => db.$disconnect());

const run = async () => (await db.discoveryRun.create({ data: { trigger: 'manual', localDate: '2026-10-15' } })).id;

describe('scoring stage (US3)', () => {
  it('filters with reasons, ranks by similarity, judges only top N, grounds matched skills', async () => {
    const judged: string[] = [];
    const deps = jobsDeps((messages: { content: string }[]) => {
      const user = messages[1]!.content;
      judged.push(/Title: (.*)/.exec(user)![1]!);
      return {
        score: 88,
        matched: [
          { skill: 'TypeScript', factIds: [facts.ts] },
          { skill: 'Kubernetes', factIds: [facts.node] }, // not proven by that fact
        ],
        missing: ['AWS'],
        reasons: 'Boa aderência.',
      };
    });
    const children = {
      a: {
        source: 'gupy',
        jobs: [
          raw({ title: 'Desenvolvedor Full Stack TypeScript React Node.js', description: 'TypeScript React Node.js NestJS PostgreSQL' }),
          raw({ title: 'Desenvolvedor Full Stack', description: 'React TypeScript', company: 'Outra' }),
          raw({ title: 'Desenvolvedor Full Stack', description: 'Java Spring Oracle', company: 'Terceira' }),
          raw({ title: 'Desenvolvedor Full Stack', company: 'Empresa Ruim Ltda' }),
          raw({ title: 'Desenvolvedor Full Stack PHP', description: 'PHP Laravel', company: 'Php Co' }),
        ],
      },
    };
    await processRun(deps, { runId: await run(), rescore: false, judge: true }, children);

    const scores = await db.jobScore.findMany({ include: { job: { include: { company: true } } } });
    const by = (c: string) => scores.find((s) => s.job.company?.name === c)!;
    expect(by('Empresa Ruim Ltda')).toMatchObject({ passed: false, filterReason: 'blocked_company', judged: false });
    expect(by('Php Co')).toMatchObject({ passed: false, filterReason: 'excluded_keyword' });
    expect(judged).toHaveLength(2); // top N only, filtered never reach the LLM
    expect(judged).not.toContain('Desenvolvedor Full Stack PHP');
    expect(by('Terceira').judged).toBe(false); // lowest similarity, not judged
    const top = by('Acme');
    expect(top).toMatchObject({ judged: true, score: 88, matched: ['TypeScript'], demoted: ['Kubernetes'] });
    expect(top.missing).toEqual(['AWS', 'Kubernetes']);
    expect(top.matchedEvidence).toEqual([{ skill: 'TypeScript', factIds: [facts.ts] }]);
    expect(by('Terceira').similarity!).toBeLessThan(top.similarity!);
  });

  it('LLM failure keeps similarity-based scores', async () => {
    const deps = jobsDeps(() => {
      throw new Error('ollama down');
    });
    await processRun(deps, { runId: await run(), rescore: false, judge: true }, { a: { source: 'gupy', jobs: [raw({})] } });
    const s = await db.jobScore.findFirstOrThrow();
    expect(s).toMatchObject({ passed: true, judged: false });
    expect(s.similarity).not.toBeNull();
    expect(await db.runEvent.count({ where: { message: { contains: 'judge failed' } } })).toBe(1);
  });

  it('no verified facts → judge skipped with explanation', async () => {
    await db.fact.deleteMany();
    await processRun(jobsDeps([]), { runId: await run(), rescore: false, judge: true }, { a: { source: 'gupy', jobs: [raw({})] } });
    expect((await db.jobScore.findFirstOrThrow()).judged).toBe(false);
    expect(await db.runEvent.count({ where: { message: { contains: 'no verified skill' } } })).toBe(1);
  });

  it('rescore after a new verified skill re-judges with the new profile (US5)', async () => {
    let call = 0;
    const deps = jobsDeps(() => ({ score: 50 + call++, matched: [{ skill: 'Kafka', factIds: ['nope'] }], missing: [], reasons: 'x' }));
    await processRun(deps, { runId: await run(), rescore: false, judge: true }, { a: { source: 'gupy', jobs: [raw({ description: 'Kafka TypeScript' })] } });
    expect((await db.jobScore.findFirstOrThrow()).matched).toEqual([]);
    const kafka = await db.fact.create({
      data: { kind: 'skill', key: 'skill:kafka', value: { name: 'Kafka' }, verifiedByUser: true, sources: { create: { origin: 'user', ref: 'user:manual', rawValue: {} } } },
    });
    const deps2 = jobsDeps(() => ({ score: 90, matched: [{ skill: 'Kafka', factIds: [kafka.id] }], missing: [], reasons: 'y' }));
    const before = (await db.jobScore.findFirstOrThrow()).profileHash;
    await processRun(deps2, { runId: (await db.discoveryRun.create({ data: { trigger: 'rescore', localDate: '2026-10-15' } })).id, rescore: true, judge: true }, {});
    const after = await db.jobScore.findFirstOrThrow();
    expect(after.profileHash).not.toBe(before);
    expect(after).toMatchObject({ score: 90, matched: ['Kafka'] });
  });
});
