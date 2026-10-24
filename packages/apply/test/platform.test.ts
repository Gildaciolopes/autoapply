import { describe, expect, it } from 'vitest';
import { approvalHash, gateDecision, nextBackoff, PLATFORM_DEFAULTS, platformOf } from '../src/platform.js';
import { isAlreadyApplied, isPlatformActionPage, isSubmittedConfirmation, isUnusualActivity } from '../src/confirm.js';

const now = new Date('2026-10-24T15:00:00-03:00');
const midnight = new Date('2026-10-24T00:00:00-03:00');
const p = (over = {}) => ({ ...PLATFORM_DEFAULTS.gupy, lastActionAt: null, pausedUntil: null, pauseReason: null, ...over });

describe('gateDecision (FR-012)', () => {
  it('caps per action, tomorrow 00:05', () => {
    expect(gateDecision({ platform: p(), usage: { submitted: 14, simulated: 0 }, action: 'submit', now, midnight })).toEqual({ ok: true });
    const d = gateDecision({ platform: p(), usage: { submitted: 15, simulated: 0 }, action: 'submit', now, midnight });
    expect(d).toMatchObject({ ok: false, reason: 'daily_cap' });
    expect(new Date(now.getTime() + (d as { delayMs: number }).delayMs).toISOString()).toBe(new Date('2026-10-25T00:05:00-03:00').toISOString());
    expect(gateDecision({ platform: p(), usage: { submitted: 15, simulated: 0 }, action: 'simulate', now, midnight })).toEqual({ ok: true });
  });
  it('minimum interval and pauses', () => {
    expect(gateDecision({ platform: p({ lastActionAt: new Date(now.getTime() - 20_000) }), usage: { submitted: 0, simulated: 0 }, action: 'simulate', now, midnight })).toEqual({ ok: false, reason: 'interval', delayMs: 40_000 });
    expect(gateDecision({ platform: p({ pauseReason: 'errors', pausedUntil: new Date(now.getTime() + 60_000) }), usage: { submitted: 0, simulated: 0 }, action: 'submit', now, midnight })).toEqual({ ok: false, reason: 'platform_paused', delayMs: 60_000 });
    expect(gateDecision({ platform: p({ pauseReason: 'unusual_activity' }), usage: { submitted: 0, simulated: 0 }, action: 'submit', now, midnight })).toEqual({ ok: false, reason: 'platform_paused', delayMs: null });
    expect(gateDecision({ platform: p({ pauseReason: 'errors', pausedUntil: new Date(now.getTime() - 1) }), usage: { submitted: 0, simulated: 0 }, action: 'submit', now, midnight })).toEqual({ ok: true });
  });
  it('backoff 1 h → 4 h → manual; unusual activity → manual', () => {
    expect(nextBackoff(0, 'errors', now).pausedUntil!.getTime() - now.getTime()).toBe(3600_000);
    expect(nextBackoff(1, 'errors', now).pausedUntil!.getTime() - now.getTime()).toBe(4 * 3600_000);
    expect(nextBackoff(2, 'errors', now).pausedUntil).toBeNull();
    expect(nextBackoff(0, 'unusual_activity', now)).toMatchObject({ pausedUntil: null, reason: 'unusual_activity' });
  });
  it('platformOf and approvalHash', () => {
    expect(platformOf('lever')).toBe('lever');
    expect(platformOf(null)).toBe('generic');
    const base = { formUrl: 'u', answers: [{ fieldKey: 'b', answer: '2' }, { fieldKey: 'a', answer: '1' }], docs: [{ id: 'd', updatedAt: '2026-10-24T00:00:00Z' }] };
    expect(approvalHash(base)).toBe(approvalHash({ ...base, answers: [...base.answers].reverse() }));
    expect(approvalHash(base)).not.toBe(approvalHash({ ...base, answers: [{ fieldKey: 'a', answer: '9' }, { fieldKey: 'b', answer: '2' }] }));
    expect(approvalHash(base)).not.toBe(approvalHash({ ...base, docs: [{ id: 'd', updatedAt: '2026-10-25T00:00:00Z' }] }));
  });
});

describe('page signals', () => {
  it('confirmation / already applied / unusual / action', () => {
    expect(isSubmittedConfirmation('Sua candidatura foi enviada! Boa sorte.')).toBe(true);
    expect(isSubmittedConfirmation('Thank you for applying to Acme')).toBe(true);
    expect(isSubmittedConfirmation('x', 'https://boards.greenhouse.io/acme/jobs/1/confirmation')).toBe(true);
    expect(isSubmittedConfirmation('Enviar candidatura')).toBe(false);
    expect(isAlreadyApplied('Você já se candidatou para esta vaga')).toBe(true);
    expect(isAlreadyApplied('Applied 3 days ago')).toBe(true);
    expect(isAlreadyApplied('Candidatar-se')).toBe(false);
    expect(isUnusualActivity('Detectamos atividade incomum na sua conta')).toBe(true);
    expect(isUnusualActivity('ok', 429)).toBe(true);
    expect(isPlatformActionPage('Atualizamos nossos termos de uso. Aceite para continuar')).toBe(true);
  });
});
