import { z } from 'zod';

/**
 * Zero Fabrication contract (constitution §I): every LLM claim carries fact ids.
 * Empty evidence is invalid by schema.
 */
export const Evidence = z.array(z.string().min(1)).min(1);

export const GroundedText = z.object({ text: z.string().min(1), evidence: Evidence });
export type GroundedText = z.infer<typeof GroundedText>;

export const FormFieldAnswer = z.object({
  fieldId: z.string(),
  value: z.union([z.string(), z.array(z.string()), z.boolean()]).nullable(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['fact', 'memory', 'llm', 'user']),
  evidence: z.array(z.string()), // may be empty only when value is null (→ needs_input)
});
export type FormFieldAnswer = z.infer<typeof FormFieldAnswer>;

export const JobScoreResult = z.object({
  score: z.number().int().min(0).max(100),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  reasons: z.string(),
});
export type JobScoreResult = z.infer<typeof JobScoreResult>;
