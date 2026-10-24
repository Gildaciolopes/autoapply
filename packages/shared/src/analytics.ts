import { z } from 'zod';
import { ReplyType } from './replies.js';

/** F7 — cohort funnel (research R1). */
export const FUNNEL_STAGES = ['found', 'above_threshold', 'prepared', 'approved', 'submitted', 'replied', 'interview'] as const;
export const FunnelStage = z.enum(FUNNEL_STAGES);
export type FunnelStage = z.infer<typeof FunnelStage>;

export const FunnelSplit = z.enum(['source', 'platform', 'week']);
export type FunnelSplit = z.infer<typeof FunnelSplit>;

export const FunnelQuery = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(8),
  split: FunnelSplit.optional(),
});
export type FunnelQuery = z.infer<typeof FunnelQuery>;

export const FunnelCounts = z.object({
  found: z.number().int(),
  above_threshold: z.number().int(),
  prepared: z.number().int(),
  approved: z.number().int(),
  submitted: z.number().int(),
  replied: z.number().int(),
  interview: z.number().int(),
});
export type FunnelCounts = z.infer<typeof FunnelCounts>;

/** Conversion from the previous stage; null for `found` and for divisions by zero ("—"). */
export const FunnelRates = z.record(FunnelStage, z.number().nullable());
export type FunnelRates = Record<FunnelStage, number | null>;

export const FunnelBucket = z.object({ key: z.string(), label: z.string(), counts: FunnelCounts, rates: FunnelRates });
export type FunnelBucket = z.infer<typeof FunnelBucket>;

export const FunnelView = z.object({
  from: z.string(),
  to: z.string(),
  weeks: z.number().int(),
  threshold: z.number().int(),
  split: FunnelSplit.nullable(),
  totals: FunnelCounts,
  rates: FunnelRates,
  buckets: z.array(FunnelBucket),
  responseRate: z.number().nullable(),
  medianDaysToReply: z.number().nullable(),
  replyTypes: z.record(ReplyType, z.number().int()),
  missingSkills: z.array(z.object({ skill: z.string(), count: z.number().int() })),
});
export type FunnelView = z.infer<typeof FunnelView>;
