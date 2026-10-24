import { describe, expect, it } from 'vitest';
import { addCounts, emptyCounts, funnelRates, median, periodStart, ratio, weekKey, weekLabel } from '../src/analytics.js';

describe('funnel helpers (F7 US1)', () => {
  it('rates vs previous stage, null for found and divide by zero', () => {
    const c = { found: 100, above_threshold: 40, prepared: 20, approved: 10, submitted: 0, replied: 0, interview: 0 };
    const r = funnelRates(c);
    expect(r.found).toBeNull();
    expect(r.above_threshold).toBe(0.4);
    expect(r.approved).toBe(0.5);
    expect(r.submitted).toBe(0);
    expect(r.replied).toBeNull();
    expect(funnelRates(emptyCounts()).above_threshold).toBeNull();
  });

  it('ratio, median, addCounts', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const one = { ...emptyCounts(), found: 2, submitted: 1 };
    expect(addCounts(one, one)).toMatchObject({ found: 4, submitted: 2, replied: 0 });
  });

  it('weekKey is the local Monday (São Paulo)', () => {
    expect(weekKey(new Date('2026-10-21T15:00:00Z'))).toBe('2026-10-19'); // Wednesday
    expect(weekKey(new Date('2026-10-19T03:30:00Z'))).toBe('2026-10-19'); // Mon 00:30 local
    expect(weekKey(new Date('2026-10-19T02:30:00Z'))).toBe('2026-10-12'); // Sun 23:30 local
    expect(weekKey(new Date('2026-11-01T12:00:00Z'))).toBe('2026-10-26'); // Sunday
    expect(weekLabel('2026-10-19')).toBe('19/10');
  });

  it('periodStart = Monday 00:00 local, weeks − 1 weeks back', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    expect(periodStart(now, 1).toISOString()).toBe('2026-10-19T03:00:00.000Z');
    expect(periodStart(now, 8).toISOString()).toBe('2026-08-31T03:00:00.000Z');
  });
});
