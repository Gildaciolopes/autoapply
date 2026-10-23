import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeRenderer } from '@autoapply/resume';
import { resetJobs } from '@autoapply/db';
import { TailorService } from '../src/tailor/tailor.service.js';
import { apiError, db, fakeQueue, prisma, reset } from './helpers.js';

let queue: ReturnType<typeof fakeQueue>;
let svc: TailorService;

const facts = [
  { id: 'f-exp1', kind: 'experience', value: { company: 'Xeno Tecnologia', title: 'Engenheira de Software Sênior', start: { year: 2021, month: 3, precision: 'month' }, end: 'present', highlights: ['Migrei a API de pagamentos de Express para NestJS, reduzindo a latência p95 em 40%.', 'Implantei filas com BullMQ e Redis.'] } },
  { id: 'f-nest', kind: 'skill', value: { name: 'NestJS' } },
  { id: 'f-ts', kind: 'skill', value: { name: 'TypeScript' } },
];

async function seed(description = 'NestJS e Redis.') {
  for (const f of facts) {
    await db.fact.create({ data: { id: f.id, kind: f.kind as never, key: f.id, value: f.value as never, verifiedByUser: true, sources: { create: { origin: 'resume', ref: f.id, rawValue: {} } } } });
  }
  await db.profile.create({ data: { id: 'me', fullName: 'Ana Souza', email: 'ana@example.com', phone: '+55 11 90000-0000' } });
  const src = await db.source.create({ data: { type: 'gupy', enabled: true } });
  const c = await db.company.create({ data: { name: 'Acme' } });
  return db.job.create({ data: { sourceId: src.id, url: 'https://x', title: 'Back-end Sênior', description, companyId: c.id, dedupeHash: 'h1' } });
}

/** Simulates the worker output for a resume document. */
async function generated(jobId: string, status: 'draft' | 'needs_review' = 'draft') {
  const { factsHash } = await import('@autoapply/tailor');
  const rows = await db.fact.findMany({ where: { id: { in: ['f-exp1', 'f-nest', 'f-ts'] } } });
  return db.tailoredDocument.create({
    data: {
      jobId,
      kind: 'resume',
      status,
      plan: { bulletOrder: { 'f-exp1': [1, 0] }, entryOrder: {}, skillOrder: ['f-nest', 'f-ts'], hiddenItemIds: [], relevance: {} },
      sentences: [{ text: 'Engenheira de Software Sênior com NestJS.', factIds: ['f-exp1', 'f-nest'] }],
      validation: { ok: true, attempts: 1, findings: [] },
      factIds: rows.map((r) => r.id),
      factsHash: factsHash(rows),
    },
  });
}

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  queue = fakeQueue();
  svc = new TailorService(prisma, queue as never);
});
afterAll(async () => {
  await closeRenderer();
  await db.$disconnect();
});

describe('tailor API (US1/US4)', () => {
  it('queues resume; letter only when the job asks or the user requests; no facts → 409', async () => {
    const job = await seed();
    const r = await svc.tailor(job.id);
    expect(r.documents.map((d) => [d.kind, d.status])).toEqual([['resume', 'queued']]);
    expect(queue.added[0]).toMatchObject({ name: 'tailor', data: { jobId: job.id } });
    expect((await svc.tailor(job.id, true)).documents.map((d) => d.kind).sort()).toEqual(['cover_letter', 'resume']);
    await db.fact.updateMany({ data: { verifiedByUser: false } });
    expect(await apiError(svc.tailor(job.id))).toMatchObject({ status: 409, code: 'no_facts' });
  });

  it('job text asking for a cover letter creates it automatically', async () => {
    const job = await seed('Envie sua carta de apresentação.');
    expect((await svc.tailor(job.id)).documents).toHaveLength(2);
  });
});

describe('review (US3)', () => {
  it('diff, edit (re-validated), approve, outdated after fact change, PDF', async () => {
    const job = await seed();
    const d = await generated(job.id);
    const diff = await svc.diff(d.id);
    expect(diff.changes.summary.after).toBe('Engenheira de Software Sênior com NestJS.');
    expect(diff.changes.moved.length).toBeGreaterThan(0);

    const bad = await apiError(svc.patch(d.id, { sentences: [{ text: 'Especialista em Kubernetes.', factIds: ['f-exp1'] }] }));
    expect(bad).toMatchObject({ status: 422, code: 'validation_failed' });
    expect((bad.details as { type: string }[]).map((f) => f.type)).toContain('tech_without_evidence');
    expect((await svc.forJob(job.id)).resume!.sentences[0]!.text).toBe('Engenheira de Software Sênior com NestJS.'); // nothing saved

    const ok = await svc.patch(d.id, { sentences: [{ text: 'Migrei a API de pagamentos para NestJS, reduzindo a latência p95 em 40%.', factIds: ['f-exp1'] }] });
    expect(ok).toMatchObject({ status: 'draft', userEdited: true });
    expect((await svc.approve(d.id)).status).toBe('approved');

    const pdf = await svc.pdf(d.id);
    expect(pdf.pdf.subarray(0, 5).toString()).toBe('%PDF-');

    await db.fact.update({ where: { id: 'f-exp1' }, data: { value: { ...facts[0]!.value, title: 'Tech Lead' } } });
    expect((await svc.forJob(job.id)).resume!.status).toBe('outdated');
    expect(await apiError(svc.approve(d.id))).toMatchObject({ status: 409 });
    expect(await apiError(svc.pdf(d.id))).toMatchObject({ status: 409, code: 'outdated' });
  }, 60_000);

  it('needs_review cannot be approved; hiding items keeps the status', async () => {
    const job = await seed();
    const d = await generated(job.id, 'needs_review');
    expect(await apiError(svc.approve(d.id))).toMatchObject({ status: 409, code: 'not_approvable' });
    expect((await svc.patch(d.id, { hiddenItemIds: ['f-exp1#h0'] })).status).toBe('needs_review');
  });
});
