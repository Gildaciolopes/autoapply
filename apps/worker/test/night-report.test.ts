import { beforeEach, describe, expect, it } from 'vitest';
import { deliverReport } from '../src/night/report.js';
import { pollTelegram } from '../src/night/commands.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { seedApplyPersona } from './apply-helpers.js';
import { seedNightPrefs } from './night-helpers.js';

const CFG = { token: 'TEST-TOKEN', chatId: '4242' };

function fakeTelegram(opts: { fail?: boolean; updates?: unknown[] } = {}) {
  const sent: { method: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const method = String(url).split('/').pop()!;
    const body = JSON.parse(String(init.body));
    sent.push({ method, body });
    if (opts.fail && method === 'sendMessage') return new Response(JSON.stringify({ ok: false, description: 'Bad Request' }), { status: 400 });
    if (method === 'getUpdates') return new Response(JSON.stringify({ ok: true, result: body.offset > 0 ? [] : (opts.updates ?? []) }));
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as unknown as typeof fetch;
  return { sent, impl, messages: () => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body.text)) };
}

async function seedRun() {
  const run = await db.nightRun.create({ data: { trigger: 'schedule', scheduleKey: '2026-10-24', nightDate: '2026-10-24', budget: 20, startedAt: new Date(Date.now() - 3600_000), status: 'ok', phase: 'done', finishedAt: new Date() } });
  const { app } = await seedApplyPersona('https://test-ats.local.example/job/1', { title: 'Dev Full-Stack Pleno', company: 'Acme Tecnologia' });
  await db.application.update({ where: { id: app.id }, data: { nightRunId: run.id, status: 'ready' } });
  await db.formAnswer.create({ data: { applicationId: app.id, fieldKey: '#sal', fieldType: 'text', question: 'Pretensão salarial', answer: 'R$ 15.000 mensal (CLT)', confidence: 1, source: 'fato', evidence: ['p-salaryExpectation'] } });
  await db.platform.create({ data: { kind: 'gupy', submitCap: 15, simulateCap: 30, submitMax: 40, minIntervalSec: 60, sessionStatus: 'expired' } });
  return run;
}

beforeEach(async () => {
  await resetAll();
  await seedNightPrefs();
});

describe('morning report (US4, FR-016..FR-018)', () => {
  it('exactly one message with matching counters, alerts first, and no personal data', async () => {
    const run = await seedRun();
    const tg = fakeTelegram();
    expect(await deliverReport(db, run.id, { final: false, config: CFG, fetchImpl: tg.impl })).toBe('sent');
    expect(await deliverReport(db, run.id, { final: false, config: CFG, fetchImpl: tg.impl })).toBe('already_sent');
    const msgs = tg.messages();
    expect(msgs).toHaveLength(1);
    const text = msgs[0]!;
    expect(text.split('\n')[1]).toContain('Sessão do Gupy expirou');
    expect(text).toContain('Prontas para revisar: 1');
    expect(text).toContain('• Dev Full-Stack Pleno — Acme Tecnologia');
    expect(text).toContain(`/revisao?run=${run.id}`);
    // SC-006: no contact data, salary, answers or documents.
    for (const pii of ['ana.souza@example.com', '98765-4321', 'Ana Beatriz', '15.000', '15000', 'CLT', 'linkedin.com/in', '.pdf']) expect(text).not.toContain(pii);
    const stored = await db.nightRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored).toMatchObject({ reportStatus: 'sent' });
    expect(stored.report).toMatchObject({ counters: { ready: 1, prepared: 1 } });
  });

  it('not configured → not_configured; send failure → retry, then not_sent on the last attempt (run untouched)', async () => {
    const run = await seedRun();
    expect(await deliverReport(db, run.id, { final: false, config: null })).toBe('not_configured');
    await db.nightRun.update({ where: { id: run.id }, data: { reportStatus: 'pending' } });
    const tg = fakeTelegram({ fail: true });
    await expect(deliverReport(db, run.id, { final: false, config: CFG, fetchImpl: tg.impl })).rejects.toThrow(/recusou/);
    expect(await deliverReport(db, run.id, { final: true, config: CFG, fetchImpl: tg.impl })).toBe('not_sent');
    const stored = await db.nightRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored).toMatchObject({ status: 'ok', reportStatus: 'not_sent' });
    expect(stored.reportError).not.toContain('TEST-TOKEN');
  });
});

describe('Telegram commands (FR-019)', () => {
  const up = (id: number, text: string, chat = 4242) => ({ update_id: id, message: { chat: { id: chat }, text } });

  it('commands from another chat are ignored; parar from the configured chat stops everything', async () => {
    const run = await db.nightRun.create({ data: { trigger: 'manual', nightDate: '2026-10-24', budget: 20 } });
    const reports: string[] = [];
    const tg = fakeTelegram({ updates: [up(10, 'parar', 999), up(11, 'Parar')] });
    const res = await pollTelegram({ db, config: CFG, fetchImpl: tg.impl, drainQueues: async () => 0, enqueueReport: async (id) => void reports.push(id) });
    expect(res).toEqual({ updates: 2, commands: ['stop'] });
    expect((await db.nightRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('stopped');
    expect((await db.searchPreference.findUniqueOrThrow({ where: { id: 'default' } })).telegramOffset).toBe(12);
    expect(reports).toEqual([run.id]);
    expect(tg.messages()[0]).toContain('Parado');
    expect(tg.sent.filter((s) => s.method === 'sendMessage').every((s) => s.body.chat_id === '4242')).toBe(true);
  });

  it('status and retomar', async () => {
    await db.searchPreference.update({ where: { id: 'default' }, data: { pausedAt: new Date() } });
    const tg = fakeTelegram({ updates: [up(1, 'status'), up(2, '/retomar')] });
    await pollTelegram({ db, config: CFG, fetchImpl: tg.impl, drainQueues: async () => 0, enqueueReport: async () => undefined });
    expect(tg.messages()[0]).toContain('Pausado desde');
    expect(tg.messages()[1]).toContain('Retomado');
    expect((await db.searchPreference.findUniqueOrThrow({ where: { id: 'default' } })).pausedAt).toBeNull();
  });
});
