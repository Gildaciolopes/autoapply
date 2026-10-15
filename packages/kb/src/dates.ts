import type { LooseDate } from '@autoapply/shared';
import { normalizeText } from './normalize.js';

const PRESENT = new Set([
  'atual', 'atualmente', 'presente', 'hoje', 'ate o momento', 'o momento', 'em andamento', 'cursando',
  'present', 'current', 'currently', 'now', 'today', 'ongoing',
]);

const MONTHS: Record<string, number> = {
  jan: 1, janeiro: 1, january: 1,
  fev: 2, fevereiro: 2, feb: 2, february: 2,
  mar: 3, marco: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  mai: 5, maio: 5, may: 5,
  jun: 6, junho: 6, june: 6,
  jul: 7, julho: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, setembro: 9, sep: 9, sept: 9, september: 9,
  out: 10, outubro: 10, oct: 10, october: 10,
  nov: 11, novembro: 11, november: 11,
  dez: 12, dezembro: 12, dec: 12, december: 12,
};

const validYear = (y: number) => y >= 1950 && y <= 2100;
const ym = (year: number, month?: number): LooseDate | null => {
  if (!validYear(year)) return null;
  if (month === undefined) return { year, precision: 'year' };
  return month >= 1 && month <= 12 ? { year, month, precision: 'month' } : null;
};

/**
 * Parses resume-style dates deterministically (constitution §I: dates by code, not LLM).
 * Returns null when it cannot be parsed; callers flag `date_ambiguous`.
 * Year-only input keeps precision 'year' (never invents a month).
 */
export function parseLooseDate(input: string | null | undefined): LooseDate | null {
  if (!input) return null;
  const t = normalizeText(input).replace(/\bde\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (PRESENT.has(t)) return 'present';

  let m = /^(\d{4})[ .](\d{1,2})(?:[ .]\d{1,2})?$/.exec(t); // 2021-03 / 2021-03-01 (dashes normalized to spaces)
  if (m) return ym(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[ .](\d{4})$/.exec(t); // 03/2021
  if (m) return ym(Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[ .](\d{1,2})[ .](\d{4})$/.exec(t); // 01/03/2021 (dd/mm/yyyy)
  if (m) return ym(Number(m[3]), Number(m[2]));
  m = /^([a-z]+)\.?\s*(\d{4})$/.exec(t); // mar 2021 / março 2021
  if (m && MONTHS[m[1]!]) return ym(Number(m[2]), MONTHS[m[1]!]);
  m = /^(\d{4})$/.exec(t);
  if (m) return ym(Number(m[1]));
  m = /^([a-z]+)\s*(\d{2})$/.exec(t); // mar/21 → too ambiguous on century? assume 20xx only when ≤ current yy
  if (m && MONTHS[m[1]!]) {
    const yy = Number(m[2]);
    const year = yy <= new Date().getFullYear() % 100 ? 2000 + yy : 1900 + yy;
    return ym(year, MONTHS[m[1]!]);
  }
  return null;
}

/** Splits "mar 2021 – atual" / "2019 - 2021" / "2021 até hoje" into [start, end] raw strings. */
export function splitRange(input: string): [string, string | null] {
  // Letter lookarounds instead of \b: without them "até" never matches (é is not a \w char).
  const parts = input.split(/\s*(?:–|—|-|(?<!\p{L})(?:ate|até|to|a)(?!\p{L}))\s*/iu).filter(Boolean);
  if (parts.length >= 2) return [parts[0]!, parts.slice(1).join(' ')];
  return [input, null];
}

export function formatLooseDate(d: LooseDate | null | undefined, lang: 'pt' | 'en' = 'pt'): string {
  if (!d) return '';
  if (d === 'present') return lang === 'pt' ? 'Atual' : 'Present';
  if (d.precision === 'year' || !d.month) return String(d.year);
  return `${String(d.month).padStart(2, '0')}/${d.year}`;
}

export function compareLooseDate(a: LooseDate | null, b: LooseDate | null): number {
  const v = (d: LooseDate | null) => (d === null ? -Infinity : d === 'present' ? Infinity : d.year * 100 + (d.month ?? 0));
  return v(a) - v(b);
}

export function sameLooseDate(a: LooseDate | null | undefined, b: LooseDate | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Calendar date (YYYY-MM-DD) in the user's timezone; drives the once-per-day sync rule. */
export function localDate(d: Date = new Date(), timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
