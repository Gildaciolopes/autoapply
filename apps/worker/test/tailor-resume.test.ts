import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { queueTailorDocuments } from '@autoapply/db';
import { closeRenderer } from '@autoapply/resume';
import { runTailor } from '../src/processors/tailor.processor.js';
import { autoTailor } from '../src/tailor/auto.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { seedTailorPersona, tailorDeps } from './tailor-helpers.js';

const summary = {
  sentences: [
    { text: 'Engenheira de Software Sênior na Xeno Tecnologia, com APIs em NestJS e filas BullMQ e Redis.', factIds: ['f-exp1'] },
    { text: 'Experiência com PostgreSQL e TypeScript.', factIds: ['f-exp0', 'f-ts'] },
  ],
};

beforeEach(resetAll);
afterAll(async () => {
  await closeRenderer();
  await db.$disconnect();
});

describe('tailor resume (US1) + letter (US4)', () => {
  it('ranks verbatim bullets, validates the summary, fits one page, records dependencies', async () => {
    const job = await seedTailorPersona();
    const [docId] = await queueTailorDocuments(db, job.id, ['resume']);
    await runTailor(tailorDeps([summary]), { jobId: job.id, documentIds: [docId!] });
    const d = await db.tailoredDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(d.status).toBe('draft');
    const plan = d.plan as { bulletOrder: Record<string, number[]>; skillOrder: string[] };
    expect(plan.bulletOrder['f-exp1']).toEqual([1, 0]); // BullMQ/Redis bullet first for this job
    expect(plan.skillOrder.indexOf('f-nest')).toBeLessThan(plan.skillOrder.indexOf('f-py'));
    expect(d.factIds).toEqual(expect.arrayContaining(['f-exp1', 'f-exp0', 'f-ts']));
    expect(d.factsHash).toHaveLength(64);
  }, 60_000);

  it('cover letter: target company allowed only in greeting/closing; no facts → failed no_facts', async () => {
    const job = await seedTailorPersona({ description: 'Envie sua carta de apresentação. NestJS e Redis.' });
    const [letterId] = await queueTailorDocuments(db, job.id, ['cover_letter']);
    const letter = {
      sentences: [
        { text: 'Prezada equipe da Acme Pagamentos,', factIds: ['f-exp1'], role: 'greeting' },
        { text: 'Migrei a API de pagamentos para NestJS, reduzindo a latência p95 em 40%.', factIds: ['f-exp1'], role: 'body' },
        { text: 'Atenciosamente, Ana Beatriz Souza.', factIds: ['f-exp1'], role: 'closing' },
      ],
    };
    await runTailor(tailorDeps([letter]), { jobId: job.id, documentIds: [letterId!] });
    expect((await db.tailoredDocument.findUniqueOrThrow({ where: { id: letterId } })).status).toBe('draft');

    await db.fact.updateMany({ data: { verifiedByUser: false } });
    const [again] = await queueTailorDocuments(db, job.id, ['cover_letter']);
    await runTailor(tailorDeps([letter]), { jobId: job.id, documentIds: [again!] });
    expect(await db.tailoredDocument.findUniqueOrThrow({ where: { id: again } })).toMatchObject({ status: 'failed', error: 'no_facts' });
  }, 60_000);
});

describe('auto-tailor (US6)', () => {
  async function scoredJobs(n: number, score: number) {
    const src = await db.source.upsert({ where: { type: 'gupy' }, create: { type: 'gupy', enabled: true }, update: {} });
    for (let i = 0; i < n; i++) {
      await db.job.create({
        data: { sourceId: src.id, url: `https://x/${i}`, title: `Dev ${i}`, dedupeHash: `a-${i}-${score}`, score: { create: { score: score - i, passed: true, matched: [], missing: [], reasons: '', model: 't' } } },
      });
    }
  }

  it('off by default; on → top N ≥ threshold get queued documents', async () => {
    await scoredJobs(8, 90);
    const enqueued: unknown[] = [];
    await db.searchPreference.create({ data: { id: 'default', roles: [], seniority: [], stack: [], locations: [], workModes: [], blockedCompanies: [], excludeKeywords: [] } });
    expect(await autoTailor(db, async (p) => enqueued.push(p))).toEqual([]);
    await db.searchPreference.update({ where: { id: 'default' }, data: { autoTailor: true, autoTailorN: 5, scoreThreshold: 85 } });
    const ids = await autoTailor(db, async (p) => enqueued.push(p));
    expect(ids).toHaveLength(5);
    expect(enqueued).toHaveLength(5);
    expect(await db.tailoredDocument.count({ where: { status: 'queued' } })).toBe(5);
    expect(await autoTailor(db, async (p) => enqueued.push(p))).toHaveLength(1); // only "Dev 5" (score 85) left ≥ 85
  });
});
