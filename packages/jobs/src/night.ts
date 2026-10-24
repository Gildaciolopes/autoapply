import type { NightAlert, NightCounters, NightReport } from '@autoapply/shared';

/** F6 pure night logic: window math (São Paulo), missed nights, budget, report text, send estimate. */

export const NIGHT_TZ = 'America/Sao_Paulo';

export interface NightWindowSettings {
  start: string; // HH:MM
  end: string; // HH:MM, inclusive minute ("06:59" runs until 07:00)
  days: number[]; // weekday of the window START, 0 = Sunday
}

export interface NightWindow {
  start: Date;
  end: Date; // exclusive
  nightDate: string; // YYYY-MM-DD of the window start (local)
}

export function parseHHMM(s: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) throw new Error(`invalid HH:MM: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  minutes: number;
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(date: Date, timeZone = NIGHT_TZ): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday!),
  };
}

/** UTC instant of a local wall-clock time (handles any fixed or DST offset via Intl). */
export function zoned(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const p = localParts(new Date(guess), timeZone);
  const asLocal = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60);
  return new Date(guess - (asLocal - guess));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Window that starts on local date (y, m, d), or null when that weekday is not enabled. */
function windowOn(y: number, m: number, d: number, s: NightWindowSettings, timeZone: string): NightWindow | null {
  const startMin = parseHHMM(s.start);
  const endMin = parseHHMM(s.end) + 1;
  const start = zoned(y, m, d, startMin, timeZone);
  if (!s.days.includes(localParts(start, timeZone).weekday)) return null;
  const crosses = endMin <= startMin;
  const endDay = new Date(Date.UTC(y, m - 1, d + (crosses ? 1 : 0)));
  const end = zoned(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), endMin % 1440, timeZone);
  // "23:59" end → minute 1440 = midnight of the next day.
  const fixedEnd = endMin === 1440 ? zoned(y, m, d + 1, 0, timeZone) : end;
  return { start, end: fixedEnd, nightDate: `${y}-${pad(m)}-${pad(d)}` };
}

export interface WindowState {
  inside: boolean;
  current: NightWindow | null;
  /** Most recent window that already ended. */
  last: NightWindow | null;
  next: NightWindow | null;
}

export function nightWindow(now: Date, s: NightWindowSettings, timeZone = NIGHT_TZ): WindowState {
  const today = localParts(now, timeZone);
  const windows: NightWindow[] = [];
  for (let off = -8; off <= 8; off++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + off));
    const w = windowOn(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s, timeZone);
    if (w) windows.push(w);
  }
  const t = now.getTime();
  const current = windows.find((w) => w.start.getTime() <= t && t < w.end.getTime()) ?? null;
  const last = [...windows].reverse().find((w) => w.end.getTime() <= t) ?? null;
  const next = windows.find((w) => w.start.getTime() > t) ?? null;
  return { inside: current !== null, current, last, next };
}

/**
 * The previous window was missed when the system did not tick at all inside it (machine off/asleep).
 * No last tick at all = fresh install, nothing missed.
 */
export function missedNight(lastTickAt: Date | null, now: Date, s: NightWindowSettings, timeZone = NIGHT_TZ): NightWindow | null {
  if (!lastTickAt) return null;
  const { last } = nightWindow(now, s, timeZone);
  if (!last) return null;
  return lastTickAt.getTime() < last.start.getTime() ? last : null;
}

export function remainingBudget(budget: number, preparedThisNight: number): number {
  return Math.max(0, budget - preparedThisNight);
}

export const emptyCounters = (): NightCounters => ({
  found: 0,
  aboveThreshold: 0,
  prepared: 0,
  ready: 0,
  needsInput: 0,
  failed: 0,
  submitted: 0,
  uncertain: 0,
  waitingLimit: 0,
  windowEnd: 0,
});

export function buildReport(input: { counters: NightCounters; alerts: NightAlert[]; top: NightReport['top']; link: string }): NightReport {
  const alerts = [...input.alerts];
  const c = input.counters;
  if (!alerts.length && c.found === 0 && c.prepared === 0 && c.submitted === 0) alerts.push({ kind: 'nothing_new', message: 'Nada novo nesta noite.' });
  return { alerts, counters: c, top: input.top.slice(0, 5), link: input.link };
}

/**
 * Plain-text pt-BR message (no parse mode: job titles cannot inject markup). Only counts, titles and
 * companies: never contact data, salary, answers or documents (FR-018).
 */
export function formatReport(r: NightReport, nightDate: string): string {
  const c = r.counters;
  const lines = [`AutoApply — noite de ${nightDate}`];
  for (const a of r.alerts.filter((x) => x.kind !== 'nothing_new')) lines.push(`⚠️ ${a.message}`);
  if (r.alerts.some((a) => a.kind === 'nothing_new')) lines.push('Nada novo nesta noite.');
  lines.push(
    '',
    `Vagas encontradas: ${c.found}`,
    `Acima do seu limite: ${c.aboveThreshold}`,
    `Preparadas: ${c.prepared}`,
    `Prontas para revisar: ${c.ready}`,
    `Precisam de resposta: ${c.needsInput}`,
    `Falharam: ${c.failed}`,
    `Enviadas (aprovadas por você): ${c.submitted}`,
  );
  if (c.uncertain) lines.push(`Envio incerto: ${c.uncertain}`);
  if (c.waitingLimit) lines.push(`Aguardando limite: ${c.waitingLimit}`);
  if (c.windowEnd) lines.push(`Ficaram para a próxima noite: ${c.windowEnd}`);
  const replies = Object.values(c.replies ?? {}).reduce((a, b) => a + b, 0);
  if (replies) lines.push(`Respostas de empresas: ${replies} (entrevistas ${c.replies?.interview ?? 0}, recusas ${c.replies?.rejection ?? 0})`);
  if (r.top.length) {
    lines.push('', 'Melhores prontas:');
    for (const t of r.top) lines.push(`• ${t.title} — ${t.company} (${Math.round(t.score)})`);
  }
  lines.push('', `Revisar: ${r.link}`);
  return lines.join('\n');
}

export interface EstimatePlatform {
  kind: string;
  remainingToday: number;
  submitCap: number;
  minIntervalSec: number;
}

/** Per platform: how many go today, extra days needed at the daily cap, minutes at the minimum interval. */
export function sendEstimate(items: { kind: string }[], platforms: EstimatePlatform[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => {
    const p = platforms.find((x) => x.kind === kind) ?? { kind, remainingToday: 0, submitCap: 0, minIntervalSec: 30 };
    const today = Math.min(count, Math.max(0, p.remainingToday));
    const rest = count - today;
    const days = rest === 0 ? 0 : p.submitCap > 0 ? Math.ceil(rest / p.submitCap) : -1;
    return { kind, count, remainingToday: p.remainingToday, days, minutes: Math.ceil((today * p.minIntervalSec) / 60) };
  });
}
