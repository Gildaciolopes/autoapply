import { beforeEach, describe, expect, it } from 'vitest';
import { resumeEverything, stopEverything } from '@autoapply/db';
import { tick, type TickDeps } from '../src/night/tick.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { seedNightPrefs, seedScoredJobs } from './night-helpers.js';

// São Paulo is UTC-3. 2026-10-24 is a Saturday.
const sp = (s: string) => new Date(`${s}-03:00`);

interface Calls {
  applies: string[];
  removed: string[];
  reports: string[];
  discoveries: number;
}

function fakeDeps(now: Date, calls: Calls, opts: { discoveryFails?: boolean } = {}): TickDeps {
  return {
    db,
    now,
    startDiscovery: async () => {
      calls.discoveries++;
      if (opts.discoveryFails) throw new Error('redis down');
      const r = await db.discoveryRun.create({ data: { trigger: 'schedule', localDate: '2026-10-24' } });
      return { runId: r.id };
    },
    enqueueApply: async (id) => {
      calls.applies.push(id);
    },
    removeApplyJobs: async (ids) => {
      calls.removed.push(...ids);
    },
    enqueueReport: async (id) => {
      calls.reports.push(id);
    },
  };
}

const newCalls = (): Calls => ({ applies: [], removed: [], reports: [], discoveries: 0 });
const run = () => db.nightRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } });
const finishDiscovery = (status: 'done' | 'failed' = 'done') => db.discoveryRun.updateMany({ data: { status } });
const settle = (status = 'ready') => db.application.updateMany({ where: { status: 'queued' }, data: { status: status as never } });

beforeEach(async () => {
  await resetAll();
  await seedNightPrefs();
});

describe('night tick (US1, FR-001..FR-008)', () => {
  it('full night: one run, budget respected, window end → ok + one report, zero approvals/submissions', async () => {
    await db.searchPreference.update({ where: { id: 'default' }, data: { nightBudget: 20 } });
    await seedScoredJobs([...Array(25)].map((_, i) => 75 + (i % 20)));
    const calls = newCalls();

    expect(await tick(fakeDeps(sp('2026-10-24T22:59'), calls))).toEqual({ action: 'idle' });
    const started = await tick(fakeDeps(sp('2026-10-24T23:00'), calls));
    expect(started.action).toBe('started');
    expect(await tick(fakeDeps(sp('2026-10-24T23:01'), calls))).toMatchObject({ action: 'advanced', phase: 'discovering' });
    expect(calls.discoveries).toBe(1);

    await finishDiscovery();
    expect(await tick(fakeDeps(sp('2026-10-24T23:10'), calls))).toMatchObject({ phase: 'preparing' });
    expect(calls.applies).toHaveLength(20);
    expect(await db.application.count({ where: { nightRunId: started.action === 'started' ? started.runId : '' } })).toBe(20);

    await settle('ready');
    expect(await tick(fakeDeps(sp('2026-10-25T01:00'), calls))).toMatchObject({ phase: 'waiting', status: 'running' });
    expect(await tick(fakeDeps(sp('2026-10-25T06:59'), calls))).toMatchObject({ phase: 'waiting' });
    expect(await tick(fakeDeps(sp('2026-10-25T07:00'), calls))).toMatchObject({ phase: 'done', status: 'ok' });
    await tick(fakeDeps(sp('2026-10-25T07:01'), calls));

    expect(await db.nightRun.count()).toBe(1);
    expect(calls.reports).toHaveLength(1);
    const r = await run();
    expect(r.counters).toMatchObject({ prepared: 20, ready: 20, submitted: 0 });
    expect(await db.application.count({ where: { status: { in: ['approved', 'submitting', 'submitted'] } } })).toBe(0);
  });

  it('disabled or day not enabled → nothing starts', async () => {
    await seedScoredJobs([90]);
    const calls = newCalls();
    await db.searchPreference.update({ where: { id: 'default' }, data: { nightEnabled: false } });
    expect(await tick(fakeDeps(sp('2026-10-24T23:30'), calls))).toEqual({ action: 'idle' });
    await db.searchPreference.update({ where: { id: 'default' }, data: { nightEnabled: true, nightDays: [1, 2, 3, 4, 5] } });
    expect(await tick(fakeDeps(sp('2026-10-24T23:30'), calls))).toEqual({ action: 'idle' });
    expect(await db.nightRun.count()).toBe(0);
  });

  it('window end with queued work → removed, skipped window_end, pending, partial; picked up next night', async () => {
    const [a, b] = await seedScoredJobs([95, 90]);
    const calls = newCalls();
    await tick(fakeDeps(sp('2026-10-24T23:00'), calls));
    await finishDiscovery();
    await tick(fakeDeps(sp('2026-10-24T23:05'), calls));
    // One finished, one still queued (e.g. waiting for the platform interval) when the window ends.
    await db.application.updateMany({ where: { jobId: a }, data: { status: 'ready' } });
    const res = await tick(fakeDeps(sp('2026-10-25T07:00'), calls));
    expect(res).toMatchObject({ phase: 'done', status: 'partial' });
    const leftover = await db.application.findUniqueOrThrow({ where: { jobId: b } });
    expect(leftover.status).toBe('skipped');
    expect(calls.removed).toEqual([leftover.id]);
    expect((await run()).pending).toEqual([leftover.id]);

    const next = newCalls();
    await tick(fakeDeps(sp('2026-10-25T23:00'), next));
    await finishDiscovery();
    await tick(fakeDeps(sp('2026-10-25T23:05'), next));
    expect(next.applies).toEqual([leftover.id]);
  });

  it('discovery failure → step error, preparation still runs on known jobs, partial', async () => {
    await seedScoredJobs([90]);
    const calls = newCalls();
    await tick(fakeDeps(sp('2026-10-24T23:00'), calls, { discoveryFails: true }));
    const res = await tick(fakeDeps(sp('2026-10-24T23:01'), calls));
    expect(res).toMatchObject({ phase: 'preparing' });
    expect(calls.applies).toHaveLength(1);
    await settle('needs_input');
    await tick(fakeDeps(sp('2026-10-25T07:00'), calls));
    const r = await run();
    expect(r.status).toBe('partial');
    expect((r.stepErrors as { step: string }[])[0]!.step).toBe('discover');
  });

  it('missed night recorded once when there was no tick inside the window', async () => {
    const calls = newCalls();
    await db.searchPreference.update({ where: { id: 'default' }, data: { nightLastTickAt: sp('2026-10-24T20:00') } });
    await tick(fakeDeps(sp('2026-10-25T09:00'), calls));
    await tick(fakeDeps(sp('2026-10-25T09:01'), calls));
    const runs = await db.nightRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'missed', scheduleKey: '2026-10-24' });
    expect(calls.reports).toHaveLength(1);
  });

  it('a manual run in progress absorbs the scheduled night (no second run)', async () => {
    const calls = newCalls();
    const manual = await db.nightRun.create({ data: { trigger: 'manual', nightDate: '2026-10-24', budget: 20, phase: 'waiting' } });
    await tick(fakeDeps(sp('2026-10-24T23:00'), calls));
    expect(await db.nightRun.count()).toBe(1);
    expect((await db.nightRun.findUniqueOrThrow({ where: { id: manual.id } })).scheduleKey).toBe('2026-10-24');
    expect(calls.discoveries).toBe(0);
  });
});

describe('kill switch across the night (US3, FR-013..FR-015)', () => {
  it('stop during preparation → stopped; ticks do nothing; resume only re-enables the next window', async () => {
    await seedScoredJobs([95, 90, 85]);
    const calls = newCalls();
    await tick(fakeDeps(sp('2026-10-24T23:00'), calls));
    await finishDiscovery();
    await tick(fakeDeps(sp('2026-10-24T23:05'), calls));
    const app = await db.application.findFirstOrThrow({ where: { status: 'queued' } });
    await db.application.update({ where: { id: app.id }, data: { status: 'approved', approvalHash: 'h', approvedAt: new Date() } });

    await stopEverything(db);
    const stopped = await run();
    expect(stopped.status).toBe('stopped');
    expect(await db.application.count({ where: { status: { in: ['queued', 'approved'] } } })).toBe(0);

    const before = calls.applies.length;
    expect(await tick(fakeDeps(sp('2026-10-24T23:30'), calls))).toEqual({ action: 'already_ran' });
    expect(await tick(fakeDeps(sp('2026-10-25T23:00'), calls))).toMatchObject({ action: 'skipped' });
    expect(calls.applies.length).toBe(before);

    await resumeEverything(db);
    const next = await tick(fakeDeps(sp('2026-10-26T23:00'), calls));
    expect(next.action).toBe('started');
    await finishDiscovery();
    await tick(fakeDeps(sp('2026-10-26T23:05'), calls));
    // Items cancelled by the stop never restart automatically.
    expect(await db.application.count({ where: { status: 'skipped', needsReasons: { array_contains: [{ code: 'cancelled' }] } } })).toBe(2);
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('ready'); // approval cancelled
    expect(calls.applies.length).toBe(before);
  });
});

describe('tick without preferences', () => {
  it('never creates the preferences row', async () => {
    await db.searchPreference.deleteMany();
    expect(await tick(fakeDeps(sp('2026-10-24T23:30'), newCalls()))).toEqual({ action: 'idle' });
    expect(await db.searchPreference.count()).toBe(0);
  });
});
