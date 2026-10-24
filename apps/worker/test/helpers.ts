import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestPrismaClient, resetKnowledgeBase, type PrismaClient } from '@autoapply/db';
import { FakeLlmProvider } from '@autoapply/llm';
import type { KbDeps } from '../src/kb/deps.js';

export const fixture = (rel: string) => fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url));
export const resumeFixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../packages/resume/test/fixtures/${name}`, import.meta.url)));
export const json = <T = unknown>(rel: string): T => JSON.parse(readFileSync(fixture(rel), 'utf8')) as T;

export const db: PrismaClient = createTestPrismaClient();
export const reset = () => resetKnowledgeBase(db);

export function deps(llmResponses: unknown[], blobs: Record<string, Buffer> = {}, extra: Partial<KbDeps> = {}): KbDeps {
  return {
    db,
    llm: new FakeLlmProvider(llmResponses),
    storage: {
      async get(key) {
        const b = blobs[key];
        if (!b) throw new Error(`no blob ${key}`);
        return b;
      },
      async put(key, body) {
        blobs[key] = body;
      },
    },
    models: { chat: 'fake-chat', vision: 'fake-vision' },
    ...extra,
  };
}
