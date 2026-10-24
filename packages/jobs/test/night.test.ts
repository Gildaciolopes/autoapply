import { describe, expect, it } from 'vitest';
import { buildReport, emptyCounters, formatReport, missedNight, nightWindow, parseHHMM, sendEstimate } from '../src/night.js';

// São Paulo is UTC-3 (no DST since 2019).
const sp = (s: string) => new Date(`${s}-03:00`);
const S = { start: '23:00', end: '06:59', days: [0, 1, 2, 3, 4, 5, 6] };

describe('nightWindow (F6 FR-001)', () => {
  it('window crossing midnight belongs to the night it started', () => {
    expect(nightWindow(sp('2026-10-24T22:59'), S).inside).toBe(false);
    const at23 = nightWindow(sp('2026-10-24T23:00'), S);
    expect(at23.inside).toBe(true);
    expect(at23.current!.nightDate).toBe('2026-10-24');
    const at2 = nightWindow(sp('2026-10-25T02:00'), S);
    expect(at2.current!.nightDate).toBe('2026-10-24');
    expect(at2.current!.end.toISOString()).toBe(sp('2026-10-25T07:00').toISOString());
    expect(nightWindow(sp('2026-10-25T06:59'), S).inside).toBe(true);
    const at7 = nightWindow(sp('2026-10-25T07:00'), S);
    expect(at7.inside).toBe(false);
    expect(at7.last!.nightDate).toBe('2026-10-24');
    expect(at7.next!.nightDate).toBe('2026-10-25');
  });

  it('same-day window and 23:59 end', () => {
    const s = { start: '01:00', end: '05:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(nightWindow(sp('2026-10-24T03:00'), s).current!.nightDate).toBe('2026-10-24');
    expect(nightWindow(sp('2026-10-24T05:01'), s).inside).toBe(false);
    const late = nightWindow(sp('2026-10-24T23:59'), { start: '20:00', end: '23:59', days: [6] });
    expect(late.current!.end.toISOString()).toBe(sp('2026-10-25T00:00').toISOString());
  });

  it('days are checked on the start day', () => {
    // 2026-10-24 is a Saturday (6).
    const onlyFri = { ...S, days: [5] };
    expect(nightWindow(sp('2026-10-24T23:30'), onlyFri).inside).toBe(false);
    expect(nightWindow(sp('2026-10-24T02:00'), onlyFri).current!.nightDate).toBe('2026-10-23');
    expect(nightWindow(sp('2026-10-24T23:30'), onlyFri).next!.nightDate).toBe('2026-10-30');
  });

  it('parseHHMM rejects bad input', () => {
    expect(parseHHMM('06:59')).toBe(419);
    expect(() => parseHHMM('24:00')).toThrow();
  });
});

describe('missedNight (R3)', () => {
  it('no tick inside the last window → missed; a tick inside → not; fresh install → not', () => {
    const now = sp('2026-10-25T09:00');
    expect(missedNight(sp('2026-10-24T20:00'), now, S)!.nightDate).toBe('2026-10-24');
    expect(missedNight(sp('2026-10-25T03:00'), now, S)).toBeNull();
    expect(missedNight(null, now, S)).toBeNull();
  });
});

describe('report (FR-016, FR-018)', () => {
  it('alerts first, counts, top, link; nothing new', () => {
    const c = { ...emptyCounters(), found: 12, aboveThreshold: 5, prepared: 5, ready: 3, needsInput: 2 };
    const r = buildReport({
      counters: c,
      alerts: [{ kind: 'session_expired', message: 'Sessão do Gupy expirou: reconecte em Plataformas.' }],
      top: [{ title: 'Dev Full-Stack', company: 'Acme', score: 88.4 }],
      link: 'http://localhost:3000/revisao?run=r1',
    });
    const text = formatReport(r, '2026-10-24');
    expect(text.split('\n')[1]).toContain('Sessão do Gupy expirou');
    expect(text).toContain('Prontas para revisar: 3');
    expect(text).toContain('• Dev Full-Stack — Acme (88)');
    expect(text).toContain('Revisar: http://localhost:3000/revisao?run=r1');
    const empty = buildReport({ counters: emptyCounters(), alerts: [], top: [], link: 'x' });
    expect(empty.alerts[0]!.kind).toBe('nothing_new');
    expect(formatReport(empty, '2026-10-24')).toContain('Nada novo nesta noite.');
  });
});

describe('sendEstimate (R9)', () => {
  it('today within remaining cap, extra days at the daily cap', () => {
    const items = [...Array(5)].map(() => ({ kind: 'linkedin' })).concat([{ kind: 'gupy' }]);
    const est = sendEstimate(items, [
      { kind: 'linkedin', remainingToday: 2, submitCap: 2, minIntervalSec: 180 },
      { kind: 'gupy', remainingToday: 15, submitCap: 15, minIntervalSec: 60 },
    ]);
    expect(est.find((e) => e.kind === 'linkedin')).toEqual({ kind: 'linkedin', count: 5, remainingToday: 2, days: 2, minutes: 6 });
    expect(est.find((e) => e.kind === 'gupy')).toMatchObject({ count: 1, days: 0, minutes: 1 });
  });
});

describe('telegram commands (FR-019)', async () => {
  const { parseTelegramCommand, sendTelegramMessage, TelegramError } = await import('../src/telegram.js');
  const up = (text: string, chat: number | string = 42) => ({ update_id: 1, message: { chat: { id: chat }, text } });
  it('only the configured chat, only parar/retomar/status', () => {
    expect(parseTelegramCommand(up('parar'), '42')).toBe('stop');
    expect(parseTelegramCommand(up('/stop@AutoApplyBot'), '42')).toBe('stop');
    expect(parseTelegramCommand(up('  Retomar '), '42')).toBe('resume');
    expect(parseTelegramCommand(up('STATUS'), '42')).toBe('status');
    expect(parseTelegramCommand(up('parar', 7), '42')).toBeNull();
    expect(parseTelegramCommand(up('aprovar tudo'), '42')).toBeNull();
    expect(parseTelegramCommand({ update_id: 2 }, '42')).toBeNull();
  });
  it('errors never leak the token', async () => {
    const fail = (async () => {
      throw new Error('getaddrinfo api.telegram.org/botSECRET');
    }) as unknown as typeof fetch;
    const err = await sendTelegramMessage({ token: 'SECRET', chatId: '1' }, 'x', fail).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect(String(err.message)).not.toContain('SECRET');
  });
});
