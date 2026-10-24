import { PLATFORM_DEFAULTS } from '@autoapply/apply';
import type { PlatformKind } from '@autoapply/shared';
import type { PrismaClient } from './generated/prisma/client.js';
import { localMidnight } from './discovery.js';

/** The platform row, created with the defaults of specs/005 research R1 on first use. */
export function ensurePlatform(db: PrismaClient, kind: PlatformKind) {
  return db.platform.upsert({ where: { kind }, create: { kind, ...PLATFORM_DEFAULTS[kind] }, update: {} });
}

/** Today's actions on a platform (simulations by run start, submissions by submit time / in flight). */
export async function platformUsage(db: PrismaClient, kind: PlatformKind, now = new Date(), excludeId?: string) {
  const since = localMidnight(now);
  const not = excludeId ? { id: { not: excludeId } } : {};
  const [simulated, submitted] = await Promise.all([
    db.application.count({ where: { ...not, platform: kind, lastRunAt: { gte: since } } }),
    db.application.count({ where: { ...not, platform: kind, OR: [{ submittedAt: { gte: since } }, { status: 'submitting' }] } }),
  ]);
  return { simulated, submitted };
}
