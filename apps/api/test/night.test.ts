import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom, toArray, take } from 'rxjs';
import { resetJobs } from '@autoapply/db';
import { NightService, type SseMessage } from '../src/night/night.service.js';
import { ControlService } from '../src/control/control.service.js';
import { apiError, db, fakeQueue, prisma, reset } from './helpers.js';

let night: ReturnType<typeof fakeQueue>;
let svc: NightService;

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  night = fakeQueue();
  svc = new NightService(prisma, night as never);
});
afterAll(async () => {
  await db.$disconnect();
});

const old = () => new Date(Date.now() - 5_000);

describe('night settings + manual run (US1)', () => {
  it('defaults off; validates the window; next window when enabled', async () => {
    expect(await svc.settings()).toMatchObject({ enabled: false, start: '23:00', end: '06:59', budget: 20, next: null, paused: false });
    expect((await apiError(svc.updateSettings({ start: '06:59' }))).code).toBe('invalid_window');
    const s = await svc.updateSettings({ enabled: true, budget: 10, days: [5, 1] });
    expect(s).toMatchObject({ enabled: true, budget: 10, days: [1, 5] });
    expect(s.next?.start).toBeTruthy();
  });

  it('Rodar agora: one at a time, refused while paused', async () => {
    const v = await svc.startManual();
    expect(v).toMatchObject({ trigger: 'manual', status: 'running' });
    expect(night.added[0]).toMatchObject({ name: 'start-manual', data: { nightRunId: v.id } });
    expect((await apiError(svc.startManual())).code).toBe('already_running');
    await db.nightRun.updateMany({ data: { status: 'ok' } });
    await db.searchPreference.upsert({ where: { id: 'default' }, create: { id: 'default', pausedAt: new Date() }, update: { pausedAt: new Date() } });
    expect((await apiError(svc.startManual())).code).toBe('paused');
  });

  it('Testar Telegram: not configured without env; sent with a fake fetch', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await svc.testTelegram()).toEqual({ status: 'not_configured' });
    process.env.TELEGRAM_BOT_TOKEN = 't';
    process.env.TELEGRAM_CHAT_ID = '1';
    const sent: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }) as unknown as typeof fetch;
    expect(await svc.testTelegram(fake)).toEqual({ status: 'sent' });
    expect(sent[0]).toContain('AutoApply conectado');
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });
});

describe('live log SSE (US6, FR-024/025)', () => {
  async function seedRun(status: 'running' | 'ok' = 'ok') {
    const run = await db.nightRun.create({ data: { trigger: 'manual', nightDate: '2026-10-24', budget: 5, status } });
    const other = await db.nightRun.create({ data: { trigger: 'manual', nightDate: '2026-10-23', budget: 5, status: 'ok' } });
    const src = await db.source.create({ data: { type: 'gupy', enabled: true, dailyCap: 5 } });
    const job = await db.job.create({ data: { sourceId: src.id, url: 'https://x.local/1', title: 'Dev', dedupeHash: 'h1' } });
    const app = await db.application.create({ data: { jobId: job.id, mode: 'dry_run', nightRunId: run.id } });
    await db.runEvent.create({ data: { nightRunId: run.id, level: 'info', message: 'start', data: { step: 'start' }, createdAt: old() } });
    await db.runEvent.create({ data: { applicationId: app.id, queue: 'apply', level: 'info', message: 'form filled', createdAt: old() } });
    await db.runEvent.create({ data: { nightRunId: other.id, level: 'info', message: 'other run', createdAt: old() } });
    await db.runEvent.create({ data: { nightRunId: run.id, level: 'info', message: 'end', data: { step: 'end' }, createdAt: old() } });
    return run;
  }

  it('replays in seq order, includes linked applications, excludes other runs, ends when final', async () => {
    const run = await seedRun();
    const msgs = await firstValueFrom(svc.events(run.id, 0).pipe(toArray()));
    const events = msgs.filter((m) => m.type === 'event').map((m) => (m.data as { message: string }).message);
    expect(events).toEqual(['start', 'form filled', 'end']);
    expect(msgs.at(-1)).toMatchObject({ type: 'end' });
    const ids = msgs.filter((m) => m.id).map((m) => Number(m.id));
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('resume after Last-Event-ID: no duplicates, no gaps', async () => {
    const run = await seedRun();
    const first: SseMessage[] = await firstValueFrom(svc.events(run.id, 0).pipe(take(2), toArray()));
    const resumed = await firstValueFrom(svc.events(run.id, Number(first[1]!.id)).pipe(toArray()));
    const all = [...first, ...resumed].filter((m) => m.type === 'event').map((m) => (m.data as { message: string }).message);
    expect(all).toEqual(['start', 'form filled', 'end']);
    expect((await svc.run(run.id)).events.map((e) => e.message)).toEqual(['start', 'form filled', 'end']);
  });

  it('a running run streams new events as they arrive', async () => {
    const run = await seedRun('running');
    const got: string[] = [];
    const sub = svc.events(run.id, 0).subscribe((m) => m.type === 'event' && got.push((m.data as { message: string }).message));
    await new Promise((r) => setTimeout(r, 300));
    await db.runEvent.create({ data: { nightRunId: run.id, level: 'info', message: 'live one', data: { step: 'prepare' } } });
    await new Promise((r) => setTimeout(r, 2_500));
    sub.unsubscribe();
    expect(got).toEqual(['start', 'form filled', 'end', 'live one']);
  });
});

describe('control (US3)', () => {
  it('stop drains queues, stops the run, pauses, enqueues its report; resume only unpauses', async () => {
    const q = () => Object.assign(fakeQueue(), { getJobs: async () => [{ remove: async () => undefined }] });
    const notify = q();
    const ctl = new ControlService(prisma, q() as never, q() as never, q() as never, q() as never, notify as never);
    const run = await db.nightRun.create({ data: { trigger: 'schedule', scheduleKey: '2026-10-24', nightDate: '2026-10-24', budget: 5 } });
    expect((await ctl.state()).running?.id).toBe(run.id);
    const res = await ctl.stop();
    expect(res).toMatchObject({ runStopped: run.id, removedJobs: 4 });
    expect(notify.added[0]).toMatchObject({ name: 'report', opts: { jobId: `report-${run.id}` } });
    expect(await ctl.state()).toMatchObject({ paused: true, running: null });
    expect(await ctl.resume()).toMatchObject({ paused: false });
    expect((await db.nightRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('stopped');
  });
});
