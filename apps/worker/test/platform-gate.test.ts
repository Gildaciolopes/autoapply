import { beforeEach, describe, expect, it } from 'vitest';
import { ensurePlatform, platformGate, recordPlatformError, recordPlatformOk } from '../src/apply/gate.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { seedApplyPersona } from './apply-helpers.js';

beforeEach(resetAll);
const now = new Date('2026-10-24T15:00:00-03:00');

describe('platform gate (US5, FR-012)', () => {
  it('daily submit cap counts submissions and in-flight submits; tomorrow 00:05', async () => {
    await ensurePlatform(db, 'gupy');
    await db.platform.update({ where: { kind: 'gupy' }, data: { submitCap: 1 } });
    const { app } = await seedApplyPersona('https://acme.gupy.io/jobs/1');
    expect(await platformGate(db, 'gupy', 'submit', now)).toEqual({ ok: true });
    await db.application.update({ where: { id: app.id }, data: { platform: 'gupy', status: 'submitted', submittedAt: now } });
    const later = new Date(now.getTime() + 120_000);
    const d = await platformGate(db, 'gupy', 'submit', later);
    expect(d).toMatchObject({ ok: false, reason: 'daily_cap' });
    expect(new Date(later.getTime() + (d as { delayMs: number }).delayMs).toISOString()).toBe(new Date('2026-10-25T00:05:00-03:00').toISOString());
    expect(await platformGate(db, 'gupy', 'simulate', new Date(later.getTime() + 120_000))).toEqual({ ok: true });
  });

  it('minimum interval between actions on the same platform', async () => {
    expect(await platformGate(db, 'linkedin', 'simulate', now)).toEqual({ ok: true });
    expect(await platformGate(db, 'linkedin', 'simulate', new Date(now.getTime() + 60_000))).toEqual({ ok: false, reason: 'interval', delayMs: 120_000 });
    expect(await platformGate(db, 'lever', 'simulate', new Date(now.getTime() + 60_000))).toEqual({ ok: true }); // other platform
  });

  it('errors back off 1 h → 4 h → manual; unusual activity pauses until resumed', async () => {
    await recordPlatformError(db, 'gupy', 'errors', now);
    expect((await db.platform.findUniqueOrThrow({ where: { kind: 'gupy' } })).pausedUntil).toBeNull(); // 1 error: no pause yet
    await recordPlatformError(db, 'gupy', 'errors', now);
    let p = await db.platform.findUniqueOrThrow({ where: { kind: 'gupy' } });
    expect(p.pausedUntil!.getTime() - now.getTime()).toBe(3600_000);
    expect(await platformGate(db, 'gupy', 'simulate', now)).toEqual({ ok: false, reason: 'platform_paused', delayMs: 3600_000 });
    await recordPlatformOk(db, 'gupy');
    await recordPlatformError(db, 'gupy', 'errors', now);
    await recordPlatformError(db, 'gupy', 'errors', now);
    p = await db.platform.findUniqueOrThrow({ where: { kind: 'gupy' } });
    expect(p.pausedUntil!.getTime() - now.getTime()).toBe(4 * 3600_000);

    await recordPlatformError(db, 'linkedin', 'unusual_activity', now);
    expect(await platformGate(db, 'linkedin', 'submit', new Date(now.getTime() + 10 * 24 * 3600_000))).toEqual({ ok: false, reason: 'platform_paused', delayMs: null });
  });
});
