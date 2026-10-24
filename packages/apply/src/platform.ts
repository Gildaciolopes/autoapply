import { createHash } from 'node:crypto';
import type { AtsKind, PlatformKind } from '@autoapply/shared';

export interface PlatformDefaults {
  submitCap: number;
  simulateCap: number;
  submitMax: number;
  minIntervalSec: number;
}

/** Conservative defaults and safe maxima per platform (specs/005 research R1). */
export const PLATFORM_DEFAULTS: Record<PlatformKind, PlatformDefaults> = {
  gupy: { submitCap: 15, simulateCap: 30, submitMax: 40, minIntervalSec: 60 },
  linkedin: { submitCap: 5, simulateCap: 10, submitMax: 15, minIntervalSec: 180 },
  greenhouse: { submitCap: 20, simulateCap: 30, submitMax: 50, minIntervalSec: 30 },
  lever: { submitCap: 20, simulateCap: 30, submitMax: 50, minIntervalSec: 30 },
  ashby: { submitCap: 20, simulateCap: 30, submitMax: 50, minIntervalSec: 30 },
  generic: { submitCap: 20, simulateCap: 30, submitMax: 50, minIntervalSec: 30 },
};

export const platformOf = (ats: AtsKind | string | null | undefined): PlatformKind =>
  (ats && ats in PLATFORM_DEFAULTS ? ats : 'generic') as PlatformKind;

export interface GateInput {
  platform: PlatformDefaults & { lastActionAt: Date | null; pausedUntil: Date | null; pauseReason: string | null };
  usage: { submitted: number; simulated: number };
  action: 'simulate' | 'submit';
  now: Date;
  /** Local midnight of `now` (America/Sao_Paulo). */
  midnight: Date;
}

export type GateDecision = { ok: true } | { ok: false; reason: 'daily_cap' | 'interval' | 'platform_paused'; delayMs: number | null };

const DAY = 24 * 3600_000;

/**
 * Whether an action may run on a platform now (FR-012). Manual pauses (unusual activity, 3rd backoff)
 * never resume by themselves: `delayMs: null`.
 */
export function gateDecision({ platform, usage, action, now, midnight }: GateInput): GateDecision {
  if (platform.pauseReason) {
    if (!platform.pausedUntil) return { ok: false, reason: 'platform_paused', delayMs: null };
    if (platform.pausedUntil > now) return { ok: false, reason: 'platform_paused', delayMs: platform.pausedUntil.getTime() - now.getTime() };
  }
  const used = action === 'submit' ? usage.submitted : usage.simulated;
  const cap = action === 'submit' ? platform.submitCap : platform.simulateCap;
  if (used >= cap) return { ok: false, reason: 'daily_cap', delayMs: midnight.getTime() + DAY + 5 * 60_000 - now.getTime() };
  if (platform.lastActionAt) {
    const wait = platform.lastActionAt.getTime() + platform.minIntervalSec * 1000 - now.getTime();
    if (wait > 0) return { ok: false, reason: 'interval', delayMs: wait };
  }
  return { ok: true };
}

/** Backoff after platform errors: 1 h, then 4 h, then manual. Unusual activity → manual at once. */
export function nextBackoff(level: number, cause: 'errors' | 'unusual_activity', now: Date): { level: number; pausedUntil: Date | null; reason: string } {
  if (cause === 'unusual_activity') return { level: Math.max(level, 2) + 1, pausedUntil: null, reason: 'unusual_activity' };
  const next = level + 1;
  if (next === 1) return { level: next, pausedUntil: new Date(now.getTime() + 3600_000), reason: 'errors' };
  if (next === 2) return { level: next, pausedUntil: new Date(now.getTime() + 4 * 3600_000), reason: 'errors' };
  return { level: next, pausedUntil: null, reason: 'errors' };
}

/** Errors in a row before backing off. */
export const ERRORS_BEFORE_BACKOFF = 2;

/** Fingerprint of exactly what the user approved (research R4). */
export function approvalHash(input: { formUrl: string | null; answers: { fieldKey: string; answer: string | null }[]; docs: { id: string; updatedAt: Date | string }[] }): string {
  const answers = [...input.answers].sort((a, b) => a.fieldKey.localeCompare(b.fieldKey)).map((a) => `${a.fieldKey}=${a.answer ?? ''}`);
  const docs = [...input.docs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => `${d.id}@${new Date(d.updatedAt).toISOString()}`);
  return createHash('sha256').update(JSON.stringify([input.formUrl ?? '', answers, docs])).digest('hex');
}
