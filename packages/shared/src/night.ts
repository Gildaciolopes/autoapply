import { z } from 'zod';
import { PlatformKind } from './platforms.js';

/** F6 overnight runs: window settings, run views, report, review queue, memories, control. */

export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');

export const NightSettingsBody = z
  .object({
    enabled: z.boolean().optional(),
    start: HHMM.optional(),
    end: HHMM.optional(),
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .refine((d) => new Set(d).size === d.length, 'dias repetidos')
      .optional(),
    budget: z.number().int().min(1).max(40).optional(),
  })
  .refine((b) => !b.start || !b.end || b.start !== b.end, { message: 'início e fim iguais', path: ['end'] });
export type NightSettingsBody = z.infer<typeof NightSettingsBody>;

export const WindowView = z.object({ start: z.string(), end: z.string(), nightDate: z.string() });
export type WindowView = z.infer<typeof WindowView>;

export const NightSettings = z.object({
  enabled: z.boolean(),
  start: HHMM,
  end: HHMM,
  days: z.array(z.number().int()),
  budget: z.number().int(),
  paused: z.boolean(),
  next: WindowView.nullable(),
  telegram: z.boolean(),
});
export type NightSettings = z.infer<typeof NightSettings>;

export const NightTrigger = z.enum(['schedule', 'manual']);
export const NightStatus = z.enum(['running', 'ok', 'partial', 'failed', 'stopped', 'skipped', 'missed']);
export type NightStatus = z.infer<typeof NightStatus>;
export const NightPhase = z.enum(['discovering', 'preparing', 'waiting', 'finishing', 'done']);
export type NightPhase = z.infer<typeof NightPhase>;
export const ReportStatus = z.enum(['pending', 'sent', 'not_sent', 'not_configured']);
export type ReportStatus = z.infer<typeof ReportStatus>;

const count = z.number().int().default(0);
export const NightCounters = z.object({
  found: count,
  aboveThreshold: count,
  prepared: count,
  ready: count,
  needsInput: count,
  failed: count,
  submitted: count,
  uncertain: count,
  waitingLimit: count,
  windowEnd: count,
});
export type NightCounters = z.infer<typeof NightCounters>;

export const NightAlertKind = z.enum(['session_expired', 'platform_paused', 'stopped', 'failed', 'missed', 'skipped', 'partial', 'nothing_new']);
export const NightAlert = z.object({ kind: NightAlertKind, message: z.string() });
export type NightAlert = z.infer<typeof NightAlert>;

export const NightReport = z.object({
  alerts: z.array(NightAlert),
  counters: NightCounters,
  top: z.array(z.object({ title: z.string(), company: z.string(), score: z.number() })).max(5),
  link: z.string(),
});
export type NightReport = z.infer<typeof NightReport>;

export const StepError = z.object({ step: z.string(), message: z.string(), at: z.string() });
export type StepError = z.infer<typeof StepError>;

export const NightRunListItem = z.object({
  id: z.string(),
  trigger: NightTrigger,
  nightDate: z.string(),
  status: NightStatus,
  phase: NightPhase,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  windowEnd: z.string().nullable(),
  counters: NightCounters,
  reportStatus: ReportStatus,
});
export type NightRunListItem = z.infer<typeof NightRunListItem>;

export const RunEventView = z.object({
  seq: z.number().int(),
  at: z.string(),
  level: z.string(),
  step: z.string().nullable(),
  message: z.string(),
  applicationId: z.string().nullable(),
});
export type RunEventView = z.infer<typeof RunEventView>;

export const NightRunView = NightRunListItem.extend({
  budget: z.number().int(),
  stepErrors: z.array(StepError),
  pending: z.array(z.string()),
  report: NightReport.nullable(),
  reportError: z.string().nullable(),
  reportSentAt: z.string().nullable(),
  events: z.array(RunEventView),
});
export type NightRunView = z.infer<typeof NightRunView>;

// ---------- Review queue ----------

export const ReviewGroup = z.enum(['ready', 'needs_input', 'failed', 'submit_uncertain', 'waiting_limit', 'approved']);
export type ReviewGroup = z.infer<typeof ReviewGroup>;

export const ReviewItem = z.object({
  applicationId: z.string(),
  jobId: z.string(),
  title: z.string(),
  company: z.string().nullable(),
  score: z.number().nullable(),
  platform: z.string().nullable(),
  status: z.string(),
  group: ReviewGroup,
  runId: z.string().nullable(),
  lowConfidence: z.number().int(),
  needsQuestions: z.array(z.string()),
  reason: z.string().nullable(),
  updatedAt: z.string(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

export const ReviewQueue = z.object({
  groups: z.record(ReviewGroup, z.array(ReviewItem)),
  counts: z.record(ReviewGroup, z.number().int()),
  run: NightRunListItem.nullable(),
});
export type ReviewQueue = z.infer<typeof ReviewQueue>;

export const RejectBody = z.object({ reason: z.string().trim().min(1).max(300) });
export type RejectBody = z.infer<typeof RejectBody>;

export const EstimateBody = z.object({ ids: z.array(z.string()).min(1).max(50) });
export type EstimateBody = z.infer<typeof EstimateBody>;

export const SendEstimate = z.object({
  perPlatform: z.array(
    z.object({ kind: PlatformKind, count: z.number().int(), remainingToday: z.number().int(), days: z.number().int(), minutes: z.number().int() }),
  ),
});
export type SendEstimate = z.infer<typeof SendEstimate>;

// ---------- Answer memory ----------

export const MemoryOrigin = z.enum(['needs_input', 'inline', 'edit']);
export type MemoryOrigin = z.infer<typeof MemoryOrigin>;

export const MemoryView = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  fieldType: z.string().nullable(),
  origin: z.string(),
  enabled: z.boolean(),
  usedCount: z.number().int(),
  lastUsedAt: z.string().nullable(),
  updatedAt: z.string(),
  conflict: z.string().nullable(),
});
export type MemoryView = z.infer<typeof MemoryView>;

export const MemoryPatchBody = z
  .object({ answer: z.string().trim().min(1).max(2000).optional(), enabled: z.boolean().optional() })
  .refine((b) => b.answer !== undefined || b.enabled !== undefined, 'nada para alterar');
export type MemoryPatchBody = z.infer<typeof MemoryPatchBody>;

// ---------- Control (kill switch) ----------

export const ControlState = z.object({
  paused: z.boolean(),
  pausedAt: z.string().nullable(),
  running: NightRunListItem.nullable(),
  next: WindowView.nullable(),
});
export type ControlState = z.infer<typeof ControlState>;

// ---------- Queue payloads ----------

export const NightTickPayload = z.object({}).passthrough();
export const StartManualPayload = z.object({ nightRunId: z.string() });
export type StartManualPayload = z.infer<typeof StartManualPayload>;
export const ReportPayload = z.object({ nightRunId: z.string() });
export type ReportPayload = z.infer<typeof ReportPayload>;
