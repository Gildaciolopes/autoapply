import { FUNNEL_STAGES, type FunnelCounts, type FunnelRates } from '@autoapply/shared';
import { localParts, NIGHT_TZ, zoned } from './night.js';

/** Conversion of each stage from the previous one; `found` and divisions by zero → null ("—"). */
export function funnelRates(counts: FunnelCounts): FunnelRates {
  const out = {} as FunnelRates;
  FUNNEL_STAGES.forEach((stage, i) => {
    const prev = i === 0 ? 0 : counts[FUNNEL_STAGES[i - 1]!];
    out[stage] = i === 0 || prev === 0 ? null : counts[stage] / prev;
  });
  return out;
}

export function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function emptyCounts(): FunnelCounts {
  return { found: 0, above_threshold: 0, prepared: 0, approved: 0, submitted: 0, replied: 0, interview: 0 };
}

export function addCounts(a: FunnelCounts, b: FunnelCounts): FunnelCounts {
  const out = emptyCounts();
  for (const s of FUNNEL_STAGES) out[s] = a[s] + b[s];
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Monday (local date, `YYYY-MM-DD`) of the week containing `date`. */
export function weekKey(date: Date, timeZone = NIGHT_TZ): string {
  const p = localParts(date, timeZone);
  const back = (p.weekday + 6) % 7; // Mon=0 … Sun=6
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Start of the period: Monday 00:00 local of the current week, minus `weeks − 1` weeks. */
export function periodStart(now: Date, weeks: number, timeZone = NIGHT_TZ): Date {
  const [y, m, d] = weekKey(now, timeZone).split('-').map(Number) as [number, number, number];
  return zoned(y, m, d - (weeks - 1) * 7, 0, timeZone);
}

/** `DD/MM` label for a week key. */
export function weekLabel(key: string): string {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}
