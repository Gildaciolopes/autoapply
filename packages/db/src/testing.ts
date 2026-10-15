import { createPrismaClient } from './index.js';
import type { PrismaClient } from './generated/prisma/client.js';

/**
 * Integration-test DB (separate database, never the dev one). Create with `make test-db`.
 * Tests call resetKnowledgeBase() in beforeEach.
 */
export function createTestPrismaClient(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://autoapply:autoapply@localhost:5433/autoapply_test';
  if (!/_test\b/.test(url)) throw new Error(`refusing to use non-test database: ${url}`);
  return createPrismaClient(url);
}

export async function resetKnowledgeBase(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "FactRevision", "FactSource", "FactConflict", "Fact", "ResumeBase", "ProfileSource", "SyncRun", "Profile", "RunEvent" CASCADE',
  );
}

export async function resetJobs(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "JobScore", "JobOrigin", "Job", "Company", "DiscoveryRun", "ProfileVector", "Source", "SearchPreference", "RunEvent" CASCADE',
  );
}
