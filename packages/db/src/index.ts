import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';
export * from './vector.js';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
export * from './facts.js';
export * from './fact-writer.js';
export * from './testing.js';
export * from './discovery.js';
export * from './tailor.js';
export * from './platforms.js';
export * from './night.js';
export * from './secret.js';
export * from './analytics.js';
export * from './replies.js';
