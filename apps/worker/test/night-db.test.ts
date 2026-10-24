import { beforeEach, describe, expect, it } from 'vitest';
import { nightCounters, prepareApplication, PrepareError, selectNightJobs, stopEverything } from '@autoapply/db';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { seedNightPrefs, seedScoredJobs } from './night-helpers.js';

beforeEach(async () => {
  await resetAll();
  await seedNightPrefs();
});

describe('selectNightJobs (research R4)', () => {
  it('best scored above threshold, never prepared; leftovers from window end come back', async () => {
    const [a, b, c, d] = await seedScoredJobs([95, 80, 75, 60]);
    await seedScoredJobs([99], { passed: false });
    expect(await selectNightJobs(db, { threshold: 70, take: 10 })).toEqual([a, b, c]);
    expect(await selectNightJobs(db, { threshold: 70, take: 2 })).toEqual([a, b]);
    expect(await selectNightJobs(db, { threshold: 70, take: 0 })).toEqual([]);

    const appA = await prepareApplication(db, a!);
    await db.application.update({ where: { id: appA.id }, data: { status: 'ready' } });
    const appB = await prepareApplication(db, b!);
    await db.application.update({ where: { id: appB.id }, data: { status: 'skipped', needsReasons: [{ code: 'window_end', message: 'x' }] } });
    const appC = await prepareApplication(db, c!);
    await db.application.update({ where: { id: appC.id }, data: { status: 'skipped', needsReasons: [{ code: 'cancelled', message: 'x' }] } });
    expect(await selectNightJobs(db, { threshold: 70, take: 10 })).toEqual([b]);
    expect(d).toBeTruthy();
  });

  it('rejected and submitted jobs are never selected nor re-prepared', async () => {
    const [a, b] = await seedScoredJobs([90, 85]);
    const appA = await prepareApplication(db, a!);
    await db.application.update({ where: { id: appA.id }, data: { status: 'rejected', rejectReason: 'não gosto' } });
    const appB = await prepareApplication(db, b!);
    await db.application.update({ where: { id: appB.id }, data: { status: 'submitted', submittedAt: new Date() } });
    expect(await selectNightJobs(db, { threshold: 70, take: 10 })).toEqual([]);
    await expect(prepareApplication(db, a!)).rejects.toMatchObject({ code: 'rejected' });
    await expect(prepareApplication(db, b!)).rejects.toBeInstanceOf(PrepareError);
  });
});

describe('nightCounters + stopEverything', () => {
  it('counts the run applications by status; stop cancels and pauses', async () => {
    const run = await db.nightRun.create({ data: { trigger: 'manual', nightDate: '2026-10-24', budget: 20, startedAt: new Date(Date.now() - 60_000) } });
    const [a, b, c] = await seedScoredJobs([90, 80, 50]);
    const ra = await prepareApplication(db, a!, { nightRunId: run.id });
    await db.application.update({ where: { id: ra.id }, data: { status: 'ready' } });
    const rb = await prepareApplication(db, b!, { nightRunId: run.id });
    await db.application.update({ where: { id: rb.id }, data: { status: 'approved', approvalHash: 'h', approvedAt: new Date() } });
    const counters = await nightCounters(db, run, 70);
    expect(counters).toMatchObject({ found: 3, aboveThreshold: 2, prepared: 2, ready: 1 });
    expect(c).toBeTruthy();

    const res = await stopEverything(db);
    expect(res.runStopped).toBe(run.id);
    expect((await db.nightRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('stopped');
    expect((await db.application.findUniqueOrThrow({ where: { id: rb.id } })).status).toBe('ready');
    expect((await db.searchPreference.findUniqueOrThrow({ where: { id: 'default' } })).pausedAt).not.toBeNull();
  });
});
