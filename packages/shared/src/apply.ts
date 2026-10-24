import { z } from 'zod';
import { ValidationFinding } from './tailor.js';

// ---------- F4 apply engine (dry-run) ----------

export const AtsKind = z.enum(['greenhouse', 'lever', 'ashby', 'generic', 'gupy', 'linkedin']);
export type AtsKind = z.infer<typeof AtsKind>;

export const FieldType = z.enum(['text', 'email', 'tel', 'number', 'url', 'date', 'textarea', 'select', 'radio', 'checkbox', 'file']);
export type FieldType = z.infer<typeof FieldType>;

/** A field discovered on the form (extractor + adapter hints). `key` is the selector used to fill it. */
export const FormField = z.object({
  key: z.string(),
  type: FieldType,
  label: z.string(),
  required: z.boolean().default(false),
  options: z.array(z.string()).default([]),
  /** Multi-choice checkbox group (several options may be selected). */
  multiple: z.boolean().default(false),
  step: z.number().int().default(0),
  frameUrl: z.string().optional(),
  name: z.string().optional(),
  autocomplete: z.string().optional(),
  accept: z.string().optional(),
  maxLength: z.number().int().optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
});
export type FormField = z.infer<typeof FormField>;

export const AnswerSource = z.enum(['fato', 'memória', 'calculado', 'regra', 'modelo', 'usuário', 'anexo']);
export type AnswerSource = z.infer<typeof AnswerSource>;

export const NeedsReasonCode = z.enum([
  'captcha',
  'bot_protection',
  'login_required',
  'low_confidence',
  'no_evidence',
  'missing_fact',
  'validation_failed',
  'tailoring_needs_review',
  'cover_letter_required',
  'attachment_rejected',
  'daily_cap',
  'cancelled',
  'job_closed',
  'session_expired',
  'already_applied',
  'platform_action',
  'unusual_activity',
  'form_changed',
  'new_step',
  'human_check',
  'platform_paused',
  'window_end',
]);
export type NeedsReasonCode = z.infer<typeof NeedsReasonCode>;

export const NeedsReason = z.object({ code: NeedsReasonCode, fieldKey: z.string().optional(), message: z.string() });
export type NeedsReason = z.infer<typeof NeedsReason>;

/** Answer decided for one field before filling. `value` null = leave empty. */
export const PlannedAnswer = z.object({
  fieldKey: z.string(),
  value: z.union([z.string(), z.array(z.string())]).nullable(),
  source: AnswerSource,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  blocking: z.boolean().default(false),
  reason: NeedsReasonCode.optional(),
  findings: z.array(ValidationFinding).default([]),
  /** F6: AnswerMemory reused for this answer (usage counting). */
  memoryId: z.string().optional(),
});
export type PlannedAnswer = z.infer<typeof PlannedAnswer>;

/** LLM output schema for the batched field-answer call (research R4 stage 5). */
export const LlmFieldAnswers = z.object({
  answers: z
    .array(
      z.object({
        fieldId: z.string(),
        answer: z.string().nullable().default(null),
        optionIndex: z.number().int().nullable().default(null),
        factIds: z.array(z.string()).default([]),
        confidence: z.number().min(0).max(1).default(0),
      }),
    )
    .max(60),
});
export type LlmFieldAnswers = z.infer<typeof LlmFieldAnswers>;

export const ApplyPayload = z.object({ applicationId: z.string(), attempt: z.number().int().min(1) });
export type ApplyPayload = z.infer<typeof ApplyPayload>;

export const ApplicationStatus = z.enum(['queued', 'tailoring', 'ready', 'applying', 'needs_input', 'approved', 'submitting', 'submitted', 'submit_uncertain', 'already_applied', 'failed', 'skipped', 'rejected']);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const ApplyReport = z.object({
  steps: z.number().int().default(0),
  blockedRequests: z.array(z.object({ method: z.string(), url: z.string() })).default([]),
  /** Submits of the application form stopped by the trap (must be 0; > 0 fails the run). */
  submitAttempts: z.number().int().default(0),
  /** Submits by page scripts on unrelated forms (widgets, trackers), also stopped. */
  scriptSubmits: z.number().int().default(0),
  captchaOnSubmit: z.boolean().default(false),
  unverifiedFactIds: z.array(z.string()).default([]),
  durations: z.record(z.string(), z.number()).default({}),
});
export type ApplyReport = z.infer<typeof ApplyReport>;

export const FormAnswerView = z.object({
  id: z.string(),
  fieldKey: z.string(),
  fieldType: FieldType,
  question: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
  step: z.number(),
  answer: z.string().nullable(),
  source: AnswerSource,
  confidence: z.number(),
  evidence: z.array(z.string()),
  blocking: z.boolean(),
  reason: z.string().nullable(),
  findings: z.array(ValidationFinding),
  filled: z.boolean(),
});
export type FormAnswerView = z.infer<typeof FormAnswerView>;

export const ArtifactView = z.object({ id: z.string(), type: z.string(), label: z.string(), attempt: z.number(), createdAt: z.string() });
export type ArtifactView = z.infer<typeof ArtifactView>;

export const ApplicationListItem = z.object({
  id: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  company: z.string(),
  ats: AtsKind.nullable(),
  status: ApplicationStatus,
  mode: z.string(),
  needsReason: z.string().nullable(),
  reasonCodes: z.array(NeedsReasonCode),
  outdated: z.boolean(),
  attempts: z.number(),
  updatedAt: z.string(),
  /** F7: outcome from replies. */
  outcome: z.enum(['none', 'replied', 'interview', 'declined']),
});
export type ApplicationListItem = z.infer<typeof ApplicationListItem>;

export const ApplicationView = ApplicationListItem.extend({
  formUrl: z.string().nullable(),
  needsReasons: z.array(NeedsReason),
  report: ApplyReport,
  error: z.string().nullable(),
  answers: z.array(FormAnswerView),
  artifacts: z.array(ArtifactView),
  lastRunAt: z.string().nullable(),
  platform: z.string().nullable(),
  approvedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  submittedVia: z.string().nullable(),
  sentValues: z.array(z.object({ fieldKey: z.string(), question: z.string(), value: z.string() })).nullable(),
  submitError: z.string().nullable(),
  preparedAt: z.string().nullable(),
  firstReplyAt: z.string().nullable(),
  interviewAt: z.string().nullable(),
});
export type ApplicationView = z.infer<typeof ApplicationView>;

export const ApplicationSummary = z.object({
  ready: z.number(),
  needs_input: z.object({ total: z.number(), byReason: z.record(z.string(), z.number()) }),
  failed: z.number(),
  queued: z.number(),
  applying: z.number(),
  skipped: z.number(),
  approved: z.number(),
  submitted: z.number(),
  submit_uncertain: z.number(),
});
export type ApplicationSummary = z.infer<typeof ApplicationSummary>;

export const ApplyBatchBody = z
  .object({ jobIds: z.array(z.string()).max(50).optional(), topN: z.number().int().min(1).max(50).optional() })
  .refine((b) => Boolean(b.jobIds?.length) !== (b.topN !== undefined), { message: 'jobIds xor topN' });
export type ApplyBatchBody = z.infer<typeof ApplyBatchBody>;

export const UserAnswersBody = z.object({
  answers: z.array(z.object({ fieldKey: z.string(), answer: z.string().min(1), factIds: z.array(z.string()).optional() })).min(1),
  rerun: z.boolean().optional(),
  /** F6: answered inline in the review queue (memory origin `inline`). */
  from: z.enum(['review']).optional(),
});
export type UserAnswersBody = z.infer<typeof UserAnswersBody>;
