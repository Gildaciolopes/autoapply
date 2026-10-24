import { z } from 'zod';

/** F3 tailoring contracts. See specs/003-tailoring. */

export const SentenceRole = z.enum(['greeting', 'body', 'closing']);
export type SentenceRole = z.infer<typeof SentenceRole>;

export const ComputedValue = z.object({ token: z.string(), value: z.string(), source: z.array(z.string()) });
export type ComputedValue = z.infer<typeof ComputedValue>;

/** A generated sentence: always cites fact ids (constitution §I). */
export const TailorSentence = z.object({
  text: z.string().min(1),
  factIds: z.array(z.string()),
  role: SentenceRole.optional(),
  computed: z.array(ComputedValue).optional(),
});
export type TailorSentence = z.infer<typeof TailorSentence>;

/** LLM output schema (validated, then checked by the deterministic validator). */
export const LlmSentences = z.object({
  sentences: z
    .array(z.object({ text: z.string().min(1), factIds: z.array(z.string()), role: SentenceRole.optional() }))
    .min(1)
    .max(14),
});
export type LlmSentences = z.infer<typeof LlmSentences>;

export const TailorPlan = z.object({
  /** factId → indexes of its highlights in display order */
  bulletOrder: z.record(z.string(), z.array(z.number().int())).default({}),
  /** section → fact ids in display order (projects, certifications) */
  entryOrder: z.record(z.string(), z.array(z.string())).default({}),
  skillOrder: z.array(z.string()).default([]),
  hiddenItemIds: z.array(z.string()).default([]),
  relevance: z.record(z.string(), z.number()).default({}),
});
export type TailorPlan = z.infer<typeof TailorPlan>;

export const FindingType = z.enum([
  'uncited',
  'unusable_fact',
  'tech_without_evidence',
  'org_without_evidence',
  'title_without_evidence',
  'cert_without_evidence',
  'number_without_evidence',
  'placeholder_unresolved',
  'too_long',
  /** F6: an enabled memory disagrees with the fact-backed answer (the fact wins). token = memory answer. */
  'memory_conflict',
]);
export type FindingType = z.infer<typeof FindingType>;

export const ValidationFinding = z.object({ sentenceIndex: z.number().int(), type: FindingType, token: z.string() });
export type ValidationFinding = z.infer<typeof ValidationFinding>;

export const ValidationReport = z.object({
  ok: z.boolean(),
  attempts: z.number().int().default(1),
  findings: z.array(ValidationFinding).default([]),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export const TailoredStatus = z.enum(['queued', 'generating', 'draft', 'needs_review', 'approved', 'outdated', 'failed']);
export type TailoredStatus = z.infer<typeof TailoredStatus>;

export const TailoredDocumentView = z.object({
  id: z.string(),
  jobId: z.string(),
  kind: z.enum(['resume', 'cover_letter']),
  status: TailoredStatus,
  lang: z.string(),
  plan: TailorPlan,
  sentences: z.array(TailorSentence),
  validation: ValidationReport,
  userEdited: z.boolean(),
  approvedAt: z.string().nullable(),
  error: z.string().nullable(),
  updatedAt: z.string(),
});
export type TailoredDocumentView = z.infer<typeof TailoredDocumentView>;

export const TailorPayload = z.object({ jobId: z.string(), documentIds: z.array(z.string()).min(1) });
export type TailorPayload = z.infer<typeof TailorPayload>;

export const TailorRequest = z.object({ coverLetter: z.boolean().optional() });
export const PatchTailoredBody = z.object({
  hiddenItemIds: z.array(z.string()).optional(),
  sentences: z.array(z.object({ text: z.string().min(1), factIds: z.array(z.string()), role: SentenceRole.optional() })).optional(),
});

export const EvalRunView = z.object({
  id: z.string(),
  suite: z.string(),
  model: z.string(),
  cases: z.number(),
  fabrications: z.number(),
  passed: z.boolean(),
  report: z.unknown(),
  createdAt: z.string(),
});
export type EvalRunView = z.infer<typeof EvalRunView>;
