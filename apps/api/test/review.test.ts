import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applicationFactsHash } from '@autoapply/apply';
import { resetJobs, selectNightJobs } from '@autoapply/db';
import { ApplyService } from '../src/apply/apply.service.js';
import type { StorageService } from '../src/kb/storage.service.js';
import { ReviewService } from '../src/review/review.service.js';
import { apiError, db, fakeQueue, fakeStorage, prisma, reset } from './helpers.js';

let queue: ReturnType<typeof fakeQueue> & { getJobs: () => Promise<never[]> };
let apply: ApplyService;
let svc: ReviewService;

async function prepared(i: number, score: number, status: string, extra: Record<string, unknown> = {}) {
  await db.fact.upsert({ where: { id: 'f-nest' }, create: { id: 'f-nest', kind: 'skill', key: 'skill:nestjs', value: { name: 'NestJS' }, verifiedByUser: true }, update: {} });
  const src = await db.source.upsert({ where: { type: 'gupy' }, create: { type: 'gupy', enabled: true }, update: {} });
  const c = await db.company.create({ data: { name: `Acme ${i}` } });
  const job = await db.job.create({ data: { sourceId: src.id, url: `https://jobs.lever.co/acme/${i}`, title: `Vaga ${i}`, companyId: c.id, dedupeHash: `h${i}` } });
  await db.jobScore.create({ data: { jobId: job.id, score, reasons: '', model: 'm', matched: [], missing: [], demoted: [] } });
  const fact = await db.fact.findUniqueOrThrow({ where: { id: 'f-nest' } });
  const app = await db.application.create({
    data: { jobId: job.id, mode: 'dry_run', status: status as never, ats: 'lever', platform: 'lever', formUrl: `https://jobs.lever.co/acme/${i}/apply`, factsHash: applicationFactsHash([fact], []), ...extra },
  });
  await db.formAnswer.createMany({
    data: [
      { applicationId: app.id, fieldKey: '#nest', fieldType: 'radio', question: 'Já usou NestJS?', options: ['Sim', 'Não'], answer: 'Sim', confidence: 0.9, source: 'regra', evidence: ['f-nest'], filled: true },
      { applicationId: app.id, fieldKey: '#why', fieldType: 'textarea', question: 'Por que esta vaga?', answer: 'Gosto de NestJS', confidence: 0.6, source: 'modelo', evidence: ['f-nest'], filled: true },
      ...(status === 'needs_input'
        ? [{ applicationId: app.id, fieldKey: '#how', fieldType: 'select', question: 'Como soube da vaga?', options: ['LinkedIn', 'Indicação'], required: true, answer: null, confidence: 0, source: 'modelo', evidence: [], blocking: true }]
        : []),
    ],
  });
  return app;
}

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  queue = Object.assign(fakeQueue(), { getJobs: async () => [] as never[] });
  apply = new ApplyService(prisma, fakeStorage() as unknown as StorageService, queue as never);
  svc = new ReviewService(prisma, apply);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('review queue (US2, FR-009..FR-012)', () => {
  it('groups, counts and score order; run filter', async () => {
    const run = await db.nightRun.create({ data: { trigger: 'manual', nightDate: '2026-10-24', budget: 20 } });
    await prepared(1, 70, 'ready', { nightRunId: run.id });
    await prepared(2, 90, 'ready', { nightRunId: run.id });
    await prepared(3, 80, 'needs_input', { nightRunId: run.id });
    await prepared(4, 60, 'approved', { needsReasons: [{ code: 'daily_cap', message: 'limite' }] });
    await prepared(5, 50, 'submitted');
    const q = await svc.queue();
    expect(q.counts).toEqual({ ready: 2, needs_input: 1, failed: 0, submit_uncertain: 0, waiting_limit: 1, approved: 0 });
    expect(q.groups.ready.map((i) => i.score)).toEqual([90, 70]);
    expect(q.groups.ready[0]).toMatchObject({ title: 'Vaga 2', company: 'Acme 2', platform: 'lever', lowConfidence: 1 });
    expect(q.groups.needs_input[0]!.needsQuestions).toEqual(['Como soube da vaga?']);
    const byRun = await svc.queue(run.id);
    expect(byRun.counts.waiting_limit).toBe(0);
    expect(byRun.run?.id).toBe(run.id);
  });

  it('batch approve of 3 → exactly 3 submit jobs; dry-run mode refuses', async () => {
    const apps = [await prepared(1, 90, 'ready'), await prepared(2, 85, 'ready'), await prepared(3, 80, 'ready')];
    await db.searchPreference.create({ data: { id: 'default', mode: 'dry_run' } });
    const refused = await apply.approveBatch(apps.map((a) => a.id));
    expect(refused.approved).toEqual([]);
    await db.searchPreference.update({ where: { id: 'default' }, data: { mode: 'review' } });
    const r = await apply.approveBatch(apps.map((a) => a.id));
    expect(r.approved).toHaveLength(3);
    expect(queue.added.filter((j) => j.name === 'submit')).toHaveLength(3);
    const est = await svc.estimate(apps.map((a) => a.id));
    expect(est.perPlatform).toEqual([expect.objectContaining({ kind: 'lever', count: 3, days: 0 })]);
  });

  it('reject keeps the reason and excludes the job forever; unreject re-prepares; sent ones cannot be rejected', async () => {
    const a = await prepared(1, 95, 'ready');
    const sent = await prepared(2, 90, 'submitted', { submittedAt: new Date() });
    const v = await svc.reject(a.id, 'empresa não me interessa');
    expect(v.status).toBe('rejected');
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).rejectReason).toBe('empresa não me interessa');
    expect(await selectNightJobs(db, { threshold: 0, take: 10 })).toEqual([]);
    expect((await apiError(svc.reject(sent.id, 'x'))).code).toBe('not_rejectable');
    expect((await apiError(apply.apply(a.jobId))).code).toBe('rejected');
    const back = await svc.unreject(a.id);
    expect(back.status).toBe('queued');
    expect(queue.added.at(-1)).toMatchObject({ name: 'apply' });
  });

  it('editing an answer of a ready application → memory origin edit, approval cleared, re-prepared', async () => {
    const a = await prepared(1, 90, 'approved', { approvalHash: 'h', approvedAt: new Date() });
    const v = await apply.answers(a.id, { answers: [{ fieldKey: '#why', answer: 'Trabalho com NestJS há 3 anos', factIds: ['f-nest'] }] });
    expect(v.status).toBe('queued');
    expect(v.approvedAt).toBeNull();
    const mem = await db.answerMemory.findFirstOrThrow();
    expect(mem).toMatchObject({ origin: 'edit', enabled: true, answer: 'Trabalho com NestJS há 3 anos' });
    const n = await prepared(2, 80, 'needs_input');
    await apply.answers(n.id, { answers: [{ fieldKey: '#how', answer: 'LinkedIn' }], from: 'review' });
    expect((await db.answerMemory.findFirstOrThrow({ where: { question: 'Como soube da vaga?' } })).origin).toBe('inline');
  });
});
