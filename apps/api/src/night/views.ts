import { emptyCounters, nightWindow } from '@autoapply/jobs';
import type { NightRun, RunEvent } from '@autoapply/db';
import { NightCounters, NightReport, type NightRunListItem, type NightRunView, type RunEventView, type WindowView } from '@autoapply/shared';

export function runListItem(r: NightRun): NightRunListItem {
  const parsed = NightCounters.safeParse(r.counters);
  return {
    id: r.id,
    trigger: r.trigger,
    nightDate: r.nightDate,
    status: r.status,
    phase: r.phase,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    windowEnd: r.windowEnd?.toISOString() ?? null,
    counters: parsed.success ? parsed.data : emptyCounters(),
    reportStatus: r.reportStatus,
  };
}

export function eventView(e: RunEvent): RunEventView {
  const data = (e.data ?? {}) as { step?: unknown };
  return {
    seq: e.seq,
    at: e.createdAt.toISOString(),
    level: e.level,
    step: typeof data.step === 'string' ? data.step : e.queue,
    message: e.message,
    applicationId: e.applicationId,
  };
}

export function runView(r: NightRun, events: RunEvent[]): NightRunView {
  const report = r.report ? NightReport.safeParse(r.report) : null;
  return {
    ...runListItem(r),
    budget: r.budget,
    stepErrors: (r.stepErrors as NightRunView['stepErrors']) ?? [],
    pending: (r.pending as string[]) ?? [],
    report: report?.success ? report.data : null,
    reportError: r.reportError,
    reportSentAt: r.reportSentAt?.toISOString() ?? null,
    events: events.map(eventView),
  };
}

export function nextWindow(s: { enabled: boolean; start: string; end: string; days: number[] }, now = new Date()): WindowView | null {
  if (!s.enabled) return null;
  const w = nightWindow(now, s);
  const n = w.current ?? w.next;
  return n ? { start: n.start.toISOString(), end: n.end.toISOString(), nightDate: n.nightDate } : null;
}
