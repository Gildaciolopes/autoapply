import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeQuestion } from '@autoapply/apply';
import { resetJobs } from '@autoapply/db';
import { MemoriesService } from '../src/memories/memories.service.js';
import { apiError, db, prisma, reset } from './helpers.js';

let svc: MemoriesService;
beforeEach(async () => {
  await reset();
  await resetJobs(db);
  svc = new MemoriesService(prisma);
});
afterAll(async () => {
  await db.$disconnect();
});

const mem = (question: string, answer: string, fieldType: string, extra: Record<string, unknown> = {}) =>
  db.answerMemory.create({ data: { question, normalized: normalizeQuestion(question), answer, fieldType, evidence: [], approved: true, source: 'user', ...extra } });

describe('memories API (US5, FR-023)', () => {
  it('lists and searches confirmed memories; edit, disable, delete', async () => {
    const a = await mem('Como soube da vaga?', 'LinkedIn', 'select', { origin: 'inline', usedCount: 3 });
    await mem('Pretensão PJ', 'R$ 20.000', 'text');
    await db.answerMemory.create({ data: { question: 'não confirmada', normalized: 'nao confirmada', answer: 'x', evidence: [], approved: false } });
    expect((await svc.list()).map((m) => m.question).sort()).toEqual(['Como soube da vaga?', 'Pretensão PJ']);
    expect(await svc.list('linked')).toEqual([expect.objectContaining({ id: a.id, origin: 'inline', usedCount: 3, enabled: true })]);

    expect(await svc.patch(a.id, { enabled: false })).toMatchObject({ enabled: false });
    expect((await svc.list(undefined, true)).map((m) => m.id)).not.toContain(a.id);
    expect(await svc.patch(a.id, { answer: 'Indicação' })).toMatchObject({ answer: 'Indicação' });
    await svc.remove(a.id);
    expect((await apiError(svc.remove(a.id))).status).toBe(404);
  });

  it('shows a fact conflict seen in a prepared answer', async () => {
    await mem('Quantos anos de experiência com React?', '5', 'number');
    const src = await db.source.create({ data: { type: 'gupy', enabled: true } });
    const job = await db.job.create({ data: { sourceId: src.id, url: 'https://x.local/1', title: 'Dev', dedupeHash: 'h' } });
    const app = await db.application.create({ data: { jobId: job.id, mode: 'dry_run' } });
    await db.formAnswer.create({
      data: { applicationId: app.id, fieldKey: '#y', fieldType: 'number', question: 'Quantos anos de experiência com React?', answer: '2', confidence: 1, source: 'calculado', evidence: ['f-exp0'], findings: [{ sentenceIndex: 0, type: 'memory_conflict', token: '5' }] },
    });
    const [m] = await svc.list();
    expect(m!.conflict).toContain('"2"');
  });
});
