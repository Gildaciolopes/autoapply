import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJobs } from '@autoapply/db';
import { applicationFactsHash } from '@autoapply/apply';
import { ApplyService } from '../src/apply/apply.service.js';
import type { StorageService } from '../src/kb/storage.service.js';
import { apiError, db, fakeQueue, fakeStorage, prisma, reset } from './helpers.js';

let queue: ReturnType<typeof fakeQueue> & { removed: number; getJobs: () => Promise<{ remove: () => Promise<void> }[]> };
let storage: ReturnType<typeof fakeStorage>;
let svc: ApplyService;

async function seed(i = 1, score = 80) {
  await db.fact.upsert({
    where: { id: 'f-nest' },
    create: { id: 'f-nest', kind: 'skill', key: 'skill:nestjs', value: { name: 'NestJS' }, verifiedByUser: true },
    update: {},
  });
  const src = await db.source.upsert({ where: { type: 'gupy' }, create: { type: 'gupy', enabled: true }, update: {} });
  const c = await db.company.create({ data: { name: `Acme ${i}` } });
  const job = await db.job.create({ data: { sourceId: src.id, url: `https://jobs.lever.co/acme/${i}`, title: `Back-end ${i}`, companyId: c.id, dedupeHash: `h${i}` } });
  await db.jobScore.create({ data: { jobId: job.id, score, reasons: '', model: 'm', matched: [], missing: [], demoted: [] } });
  return job;
}

/** Simulates a finished worker run that left one blocking question. */
async function finished(appId: string) {
  const fact = await db.fact.findUniqueOrThrow({ where: { id: 'f-nest' } });
  await db.formAnswer.createMany({
    data: [
      { applicationId: appId, fieldKey: '#email', fieldType: 'email', question: 'Email', answer: 'ana@example.com', confidence: 1, source: 'fato', evidence: ['profile:me'], filled: true },
      { applicationId: appId, fieldKey: '#nest', fieldType: 'radio', question: 'Já usou NestJS?', options: ['Sim', 'Não'], answer: 'Sim', confidence: 0.9, source: 'regra', evidence: ['f-nest'], filled: true },
      { applicationId: appId, fieldKey: '#how', fieldType: 'select', question: 'Como soube da vaga?', options: ['LinkedIn', 'Indicação'], required: true, answer: null, confidence: 0, source: 'modelo', evidence: [], blocking: true, reason: 'no_evidence' },
    ],
  });
  await db.artifact.create({ data: { applicationId: appId, type: 'screenshot_before', label: 'before', attempt: 1, minioKey: `applications/${appId}/1/before.png` } });
  storage.blobs.set(`applications/${appId}/1/before.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await db.application.update({
    where: { id: appId },
    data: {
      status: 'needs_input',
      ats: 'lever',
      needsReasons: [{ code: 'no_evidence', fieldKey: '#how', message: '"Como soube da vaga?": sem fato que comprove' }],
      needsReason: '"Como soube da vaga?": sem fato que comprove',
      factsHash: applicationFactsHash([fact], []),
      report: { steps: 1, blockedRequests: [], submitAttempts: 0 },
    },
  });
}

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  const base = fakeQueue();
  queue = Object.assign(base, { removed: 0, getJobs: async () => [{ remove: async () => void queue.removed++ }, { remove: async () => void queue.removed++ }] });
  storage = fakeStorage();
  svc = new ApplyService(prisma, storage as unknown as StorageService, queue as never);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('apply API (US1/US3/US5)', () => {
  it('simulate → queued dry-run application; running → 409; unknown job → 404', async () => {
    const job = await seed();
    const v = await svc.apply(job.id);
    expect(v).toMatchObject({ jobId: job.id, status: 'queued', mode: 'dry_run', attempts: 1, outdated: false });
    expect(queue.added[0]).toMatchObject({ name: 'apply', data: { applicationId: v.id, attempt: 1 } });
    expect((await apiError(svc.apply(job.id))).code).toBe('already_running');
    expect((await apiError(svc.apply('nope'))).status).toBe(404);
  });

  it('view: answers, reasons, artifacts; outdated when a cited fact changes', async () => {
    const job = await seed();
    const v = await svc.apply(job.id);
    await finished(v.id);
    const view = await svc.view(v.id);
    expect(view.status).toBe('needs_input');
    expect(view.answers.map((a) => a.fieldKey)).toEqual(['#email', '#nest', '#how']);
    expect(view.reasonCodes).toEqual(['no_evidence']);
    expect(view.outdated).toBe(false);
    expect((await svc.artifact(v.id, view.artifacts[0]!.id)).subarray(1, 4).toString()).toBe('PNG');
    await db.fact.update({ where: { id: 'f-nest' }, data: { value: { name: 'NestJS', category: 'backend' } } });
    expect((await svc.view(v.id)).outdated).toBe(true);
  });

  it('answers become approved memories (+ rerun); bad field/option/fact → 422', async () => {
    const job = await seed();
    const v = await svc.apply(job.id);
    await finished(v.id);
    expect((await apiError(svc.answers(v.id, { answers: [{ fieldKey: '#x', answer: 'a' }] }))).code).toBe('unknown_field');
    expect((await apiError(svc.answers(v.id, { answers: [{ fieldKey: '#how', answer: 'Jornal' }] }))).code).toBe('invalid_option');
    expect((await apiError(svc.answers(v.id, { answers: [{ fieldKey: '#how', answer: 'LinkedIn', factIds: ['ghost'] }] }))).code).toBe('unusable_fact');
    const r = await svc.answers(v.id, { answers: [{ fieldKey: '#how', answer: 'LinkedIn' }], rerun: true });
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(2);
    const mem = await db.answerMemory.findMany();
    expect(mem).toEqual([expect.objectContaining({ question: 'Como soube da vaga?', normalized: 'como soube da vaga', answer: 'LinkedIn', approved: true, source: 'user', fieldType: 'select' })]);
    // answering again updates the same memory
    await db.application.update({ where: { id: v.id }, data: { status: 'needs_input' } });
    await svc.answers(v.id, { answers: [{ fieldKey: '#how', answer: 'Indicação' }] });
    expect((await db.answerMemory.findMany()).map((m) => m.answer)).toEqual(['Indicação']);
  });

  it('batch topN: best scored jobs with a ready tailored resume; summary; kill switch', async () => {
    const a = await seed(1, 90);
    const b = await seed(2, 70);
    const c = await seed(3, 95); // no tailored resume → not picked
    for (const j of [a, b]) await db.tailoredDocument.create({ data: { jobId: j.id, kind: 'resume', status: 'draft' } });
    const r = await svc.batch({ topN: 5 });
    expect(r.queued.map((x) => x.jobId)).toEqual([a.id, b.id]);
    expect(r.queued.map((x) => x.jobId)).not.toContain(c.id);
    expect((await svc.batch({ jobIds: [a.id] })).queued).toEqual([]); // already running: skipped
    expect(await svc.summary()).toMatchObject({ queued: 2, ready: 0 });
    const stop = await svc.stop();
    expect(stop.cancelled).toBe(2);
    expect(queue.removed).toBe(2);
    expect((await svc.list('skipped')).map((x) => x.reasonCodes)).toEqual([['cancelled'], ['cancelled']]);
  });

  it('approve: review mode only, ready only, not outdated, platform connected; then submit is queued', async () => {
    const job = await seed();
    const v = await svc.apply(job.id);
    await finished(v.id);
    await db.formAnswer.deleteMany({ where: { applicationId: v.id, blocking: true } });
    await db.application.update({ where: { id: v.id }, data: { status: 'ready', needsReasons: [], platform: 'lever', formUrl: 'https://jobs.lever.co/acme/1/apply' } });

    await db.searchPreference.create({ data: { id: 'default', mode: 'dry_run' } });
    expect((await apiError(svc.approve(v.id))).code).toBe('dry_run_mode');
    await db.searchPreference.update({ where: { id: 'default' }, data: { mode: 'review' } });

    const ok = await svc.approve(v.id);
    expect(ok).toMatchObject({ status: 'approved', platform: 'lever' });
    expect(ok.approvedAt).not.toBeNull();
    const sub = queue.added.find((a) => a.name === 'submit')!;
    expect(sub.data).toMatchObject({ applicationId: v.id });
    expect((sub.data as { approvalHash: string }).approvalHash).toHaveLength(64);
    expect((await apiError(svc.approve(v.id))).code).toBe('not_ready');

    // kill switch clears the approval
    await svc.stop();
    expect(await db.application.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ status: 'ready', approvalHash: null });

    // session platforms must be connected
    await db.application.update({ where: { id: v.id }, data: { platform: 'gupy' } });
    expect((await apiError(svc.approve(v.id))).code).toBe('platform_not_connected');

    // outdated → refused
    await db.application.update({ where: { id: v.id }, data: { platform: 'lever' } });
    await db.fact.update({ where: { id: 'f-nest' }, data: { value: { name: 'NestJS', category: 'x' } } });
    expect((await apiError(svc.approve(v.id))).code).toBe('outdated');
  });

  it('batch approve reports refusals; mark only from submit_uncertain; re-simulation drops approval', async () => {
    await db.searchPreference.create({ data: { id: 'default', mode: 'review' } });
    const job = await seed();
    const v = await svc.apply(job.id);
    const r = await svc.approveBatch([v.id, 'ghost']);
    expect(r.approved).toEqual([]);
    expect(r.refused.map((x) => x.code)).toEqual(['not_ready', 'not_found']);

    expect((await apiError(svc.mark(v.id, true))).code).toBe('not_uncertain');
    await db.application.update({ where: { id: v.id }, data: { status: 'submit_uncertain' } });
    expect(await svc.mark(v.id, true)).toMatchObject({ status: 'submitted', submittedVia: 'manual' });
    expect((await apiError(svc.apply(job.id))).code).toBe('already_submitted');

    await db.application.update({ where: { id: v.id }, data: { status: 'ready', approvalHash: 'x', approvedAt: new Date() } });
    const again = await svc.apply(job.id);
    expect(again.approvedAt).toBeNull();
  });
});
