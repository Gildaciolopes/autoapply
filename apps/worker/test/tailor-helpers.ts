import { FakeLlmProvider } from '@autoapply/llm';
import { db } from './helpers.js';
import persona from './fixtures/eval-tailor/persona.json' with { type: 'json' };
import type { KbDeps } from '../src/kb/deps.js';

/** Seeds persona Ana as verified facts with the same ids as the eval fixtures, plus a profile and a job. */
export async function seedTailorPersona(jobOver: { title?: string; description?: string; company?: string } = {}) {
  for (const f of persona.facts) {
    await db.fact.create({
      data: { id: f.id, kind: f.kind as never, key: `${f.kind}:${f.id}`, value: f.value as never, verifiedByUser: true, sources: { create: { origin: 'resume', ref: `resume:r1#${f.id}`, rawValue: {} } } },
    });
  }
  await db.profile.create({ data: { id: 'me', fullName: 'Ana Beatriz Souza', email: 'ana.souza@example.com', phone: '+55 11 90000-0000', city: 'São Paulo, SP' } });
  const src = await db.source.upsert({ where: { type: 'gupy' }, create: { type: 'gupy', enabled: true }, update: {} });
  const company = await db.company.create({ data: { name: jobOver.company ?? 'Acme Pagamentos' } });
  return db.job.create({
    data: {
      sourceId: src.id,
      url: 'https://x/job',
      title: jobOver.title ?? 'Desenvolvedora Back-end Sênior',
      description: jobOver.description ?? 'Construa APIs com NestJS e TypeScript, PostgreSQL, Redis e filas BullMQ. Remoto.',
      companyId: company.id,
      dedupeHash: `h-${Math.random()}`,
    },
  });
}

export const tailorDeps = (responses: unknown[] | ((m: { content: string }[]) => unknown)): KbDeps => ({
  db,
  llm: new FakeLlmProvider(responses as never),
  storage: { get: async () => Buffer.alloc(0) },
  models: { chat: 'fake-chat', vision: '' },
});
