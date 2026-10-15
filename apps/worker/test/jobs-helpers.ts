import { createHash } from 'node:crypto';
import { resetJobs, resetKnowledgeBase } from '@autoapply/db';
import { FakeLlmProvider } from '@autoapply/llm';
import type { RawJob } from '@autoapply/shared';
import { db } from './helpers.js';
import type { KbDeps } from '../src/kb/deps.js';

/** Bag-of-words 1024-d embedding: deterministic, makes shared vocabulary ⇒ higher cosine. */
export function bowEmbed(texts: string[]): number[][] {
  return texts.map((t) => {
    const v = new Array<number>(1024).fill(0);
    for (const w of t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9.+#]+/).filter((x) => x.length > 2)) {
      v[createHash('md5').update(w).digest().readUInt16BE(0) % 1024]! += 1;
    }
    return v;
  });
}

export function jobsDeps(judge: unknown[] | ((m: { content: string }[]) => unknown) = []): KbDeps {
  return {
    db,
    llm: new FakeLlmProvider(judge as never, bowEmbed),
    storage: { get: async () => Buffer.alloc(0) },
    models: { chat: 'fake-chat', vision: 'fake-vision' },
  };
}

export async function resetAll() {
  await resetKnowledgeBase(db);
  await resetJobs(db);
}

export async function seedSources(caps: Partial<Record<string, number>> = {}, enabled: Partial<Record<string, boolean>> = {}) {
  for (const type of ['gupy', 'indeed', 'glassdoor', 'google_jobs', 'linkedin_mcp'] as const) {
    await db.source.create({ data: { type, enabled: enabled[type] ?? type !== 'linkedin_mcp', dailyCap: caps[type] ?? (type === 'linkedin_mcp' ? 15 : 50) } });
  }
}

export async function seedPrefs(over: Record<string, unknown> = {}) {
  await db.searchPreference.create({
    data: {
      id: 'default',
      roles: ['Desenvolvedor Full Stack'],
      seniority: [],
      stack: ['TypeScript', 'React', 'Node.js'],
      locations: ['São Paulo/SP', 'remote'],
      workModes: ['remote', 'hybrid'],
      blockedCompanies: [],
      excludeKeywords: [],
      ...over,
    },
  });
}

/** Persona Ana usable facts. */
export async function seedFacts() {
  const mk = (kind: 'skill' | 'experience', key: string, value: unknown) =>
    db.fact.create({ data: { kind, key, value: value as never, verifiedByUser: true, sources: { create: { origin: 'resume', ref: `resume:r1#${key}`, rawValue: {} } } } });
  const ids: Record<string, string> = {};
  for (const [k, n] of [['ts', 'TypeScript'], ['react', 'React'], ['node', 'Node.js'], ['pg', 'PostgreSQL']] as const) ids[k] = (await mk('skill', `skill:${k}`, { name: n })).id;
  ids.exp = (
    await mk('experience', 'experience:xeno:2021', {
      company: 'Xeno',
      title: 'Engenheira de Software Sênior',
      start: { year: 2021, precision: 'year' },
      end: 'present',
      highlights: ['APIs em NestJS e filas com BullMQ'],
    })
  ).id;
  return ids;
}

export const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'gupy',
  externalId: Math.random().toString(36).slice(2),
  url: `https://example.com/${Math.random().toString(36).slice(2)}`,
  company: 'Acme',
  title: 'Desenvolvedor Full Stack',
  description: 'TypeScript React Node.js',
  workMode: 'remote',
  ...over,
});
