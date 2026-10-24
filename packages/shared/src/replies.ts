import { z } from 'zod';

/** F7 — reply tracking (Gmail read-only + manual replies). */
export const ReplyType = z.enum(['interview', 'rejection', 'info_request', 'confirmation', 'other']);
export type ReplyType = z.infer<typeof ReplyType>;
export const ReplyOrigin = z.enum(['email', 'manual']);
export type ReplyOrigin = z.infer<typeof ReplyOrigin>;
export const ReplyOutcome = z.enum(['none', 'replied', 'interview', 'declined']);
export type ReplyOutcome = z.infer<typeof ReplyOutcome>;
export const MailStatus = z.enum(['disconnected', 'connected', 'expired']);
export type MailStatus = z.infer<typeof MailStatus>;

export const REPLY_TYPE_LABELS: Record<ReplyType, string> = {
  interview: 'entrevista',
  rejection: 'recusa',
  info_request: 'pedido de informação',
  confirmation: 'confirmação automática',
  other: 'outro',
};

export const ReplyView = z.object({
  id: z.string(),
  applicationId: z.string(),
  jobId: z.string(),
  title: z.string(),
  company: z.string(),
  origin: ReplyOrigin,
  type: ReplyType,
  confidence: z.number().nullable(),
  needsReview: z.boolean(),
  userEdited: z.boolean(),
  receivedAt: z.string(),
  sender: z.string().nullable(),
  subject: z.string().nullable(),
  excerpt: z.string().nullable(),
  note: z.string().nullable(),
  link: z.string().nullable(),
});
export type ReplyView = z.infer<typeof ReplyView>;

export const ManualReplyBody = z.object({
  type: ReplyType,
  receivedAt: z.iso.datetime({ offset: true }),
  note: z.string().max(500).optional(),
});
export type ManualReplyBody = z.infer<typeof ManualReplyBody>;

export const ReplyPatchBody = z
  .object({ type: ReplyType.optional(), applicationId: z.string().min(1).optional(), needsReview: z.boolean().optional() })
  .refine((b) => b.type !== undefined || b.applicationId !== undefined || b.needsReview !== undefined, { message: 'nothing to change' });
export type ReplyPatchBody = z.infer<typeof ReplyPatchBody>;

export const MailAccountView = z.object({
  configured: z.boolean(),
  status: MailStatus,
  email: z.string().nullable(),
  connectedAt: z.string().nullable(),
  lastCheckAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type MailAccountView = z.infer<typeof MailAccountView>;

/** Queue `mail`, job `mail-check`. */
export const MailCheckPayload = z.object({});
export type MailCheckPayload = z.infer<typeof MailCheckPayload>;

/** LLM output for a matched email: an enum and a confidence, nothing else (research R5). */
export const ReplyClassification = z.object({ type: ReplyType, confidence: z.number().min(0).max(1) });
export type ReplyClassification = z.infer<typeof ReplyClassification>;

export const AssistantSettings = z.object({ approveEnabled: z.boolean(), url: z.string() });
export type AssistantSettings = z.infer<typeof AssistantSettings>;
export const AssistantSettingsBody = z.object({ approveEnabled: z.boolean() });
export type AssistantSettingsBody = z.infer<typeof AssistantSettingsBody>;
