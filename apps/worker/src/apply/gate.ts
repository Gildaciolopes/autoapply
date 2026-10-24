import { ERRORS_BEFORE_BACKOFF, REASON_LABELS, detectAts, gateDecision, nextBackoff, platformOf, type GateDecision } from '@autoapply/apply';
import { ensurePlatform, localMidnight, platformUsage, type Prisma, type PrismaClient } from '@autoapply/db';
import type { NeedsReason, PlatformKind } from '@autoapply/shared';

export { ensurePlatform, platformUsage };

/**
 * FR-012 gate before any simulation or submission on a platform: pause, daily cap, minimum interval.
 * When allowed, marks `lastActionAt` (concurrency 1 comes from the single `apply` worker).
 */
export async function platformGate(db: PrismaClient, kind: PlatformKind, action: 'simulate' | 'submit', now = new Date(), excludeId?: string): Promise<GateDecision> {
  const platform = await ensurePlatform(db, kind);
  const usage = await platformUsage(db, kind, now, excludeId);
  const d = gateDecision({ platform, usage, action, now, midnight: localMidnight(now) });
  if (d.ok) await db.platform.update({ where: { kind }, data: { lastActionAt: now } });
  return d;
}

/** Platform of an application (stored, else detected from the job URL). */
export async function applicationPlatform(db: PrismaClient, applicationId: string): Promise<PlatformKind> {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: true } });
  if (app.platform) return platformOf(app.platform);
  const kind = platformOf(app.ats ?? detectAts(app.job.applyUrl ?? app.job.url).ats);
  await db.application.update({ where: { id: applicationId }, data: { platform: kind } });
  return kind;
}

export function gateReason(kind: PlatformKind, d: Exclude<GateDecision, { ok: true }>, cap?: number): NeedsReason {
  if (d.reason === 'daily_cap') return { code: 'daily_cap', message: `${REASON_LABELS.daily_cap} (${kind}: ${cap}/dia)` };
  if (d.reason === 'interval') return { code: 'platform_paused', message: `aguardando o intervalo mínimo entre ações (${kind})` };
  return { code: 'platform_paused', message: `${REASON_LABELS.platform_paused} (${kind})` };
}

/** Successful platform action: error streak reset (backoff level kept until a manual resume). */
export async function recordPlatformOk(db: PrismaClient, kind: PlatformKind) {
  await ensurePlatform(db, kind);
  await db.platform.update({ where: { kind }, data: { consecutiveErrors: 0 } });
}

/** Platform error / warning → backoff (1 h, 4 h, manual) or manual pause on unusual activity. */
export async function recordPlatformError(db: PrismaClient, kind: PlatformKind, cause: 'errors' | 'unusual_activity', now = new Date()) {
  const p = await ensurePlatform(db, kind);
  const errors = p.consecutiveErrors + 1;
  const data: Prisma.PlatformUpdateInput = { consecutiveErrors: errors };
  if (cause === 'unusual_activity' || errors >= ERRORS_BEFORE_BACKOFF) {
    const b = nextBackoff(p.backoffLevel, cause, now);
    Object.assign(data, { backoffLevel: b.level, pausedUntil: b.pausedUntil, pauseReason: b.reason, consecutiveErrors: 0 });
  }
  await db.platform.update({ where: { kind }, data });
}
