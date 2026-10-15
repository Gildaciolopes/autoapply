import 'reflect-metadata';
import { createTestPrismaClient, resetKnowledgeBase } from '@autoapply/db';
import type { PrismaService } from '../src/prisma/prisma.service.js';

export const db = createTestPrismaClient();
export const prisma = { client: db } as PrismaService;
export const reset = () => resetKnowledgeBase(db);

export function fakeQueue() {
  const added: { name: string; data: unknown; opts?: unknown }[] = [];
  return {
    added,
    async add(name: string, data: unknown, opts?: unknown) {
      added.push({ name, data, opts });
      return { id: String(added.length) };
    },
    async upsertJobScheduler() {
      return {};
    },
  };
}

export function fakeStorage() {
  const blobs = new Map<string, Buffer>();
  return {
    blobs,
    async put(key: string, body: Buffer) {
      blobs.set(key, body);
    },
    async get(key: string) {
      const b = blobs.get(key);
      if (!b) throw new Error(`no blob ${key}`);
      return b;
    },
  };
}

/** Status/code of an ApiError thrown by a service call. */
export async function apiError(p: Promise<unknown>): Promise<{ status: number; code: string; details?: unknown }> {
  try {
    await p;
  } catch (e) {
    const err = e as { getStatus(): number; code: string; details?: unknown };
    return { status: err.getStatus(), code: err.code, details: err.details };
  }
  throw new Error('expected ApiError');
}
