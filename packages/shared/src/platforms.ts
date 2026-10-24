import { z } from 'zod';

// ---------- F5 apply platforms, sessions and submission ----------

export const PlatformKind = z.enum(['gupy', 'linkedin', 'greenhouse', 'lever', 'ashby', 'generic']);
export type PlatformKind = z.infer<typeof PlatformKind>;

/** Platforms that need the user's logged-in session. */
export const SESSION_PLATFORMS = ['gupy', 'linkedin'] as const;
export const SessionPlatform = z.enum(SESSION_PLATFORMS);
export type SessionPlatform = z.infer<typeof SessionPlatform>;

export const SessionStatus = z.enum(['disconnected', 'connecting', 'connected', 'expired']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const PlatformView = z.object({
  kind: PlatformKind,
  needsSession: z.boolean(),
  sessionStatus: SessionStatus,
  accountLabel: z.string().nullable(),
  connectedAt: z.string().nullable(),
  lastTestAt: z.string().nullable(),
  lastTestOk: z.boolean().nullable(),
  needsOptIn: z.boolean(),
  optInAt: z.string().nullable(),
  submitCap: z.number().int(),
  simulateCap: z.number().int(),
  submitMax: z.number().int(),
  minIntervalSec: z.number().int(),
  usage: z.object({ submitted: z.number().int(), simulated: z.number().int() }),
  paused: z.object({ until: z.string().nullable(), reason: z.string() }).nullable(),
  nextRunAt: z.string().nullable(),
});
export type PlatformView = z.infer<typeof PlatformView>;

export const PlatformLimitsBody = z.object({
  submitCap: z.number().int().min(0).optional(),
  simulateCap: z.number().int().min(0).max(200).optional(),
  minIntervalSec: z.number().int().min(10).max(3600).optional(),
});
export type PlatformLimitsBody = z.infer<typeof PlatformLimitsBody>;

export const LINKEDIN_OPT_IN_TEXT = 'Entendo e quero usar';
export const OptInBody = z.object({ confirm: z.literal(LINKEDIN_OPT_IN_TEXT) });
export const ConnectDoneBody = z.object({ cancel: z.boolean().optional() });
export const ApproveBatchBody = z.object({ ids: z.array(z.string()).min(1).max(50) });
export type ApproveBatchBody = z.infer<typeof ApproveBatchBody>;
export const MarkBody = z.object({ sent: z.boolean() });

export const SubmitPayload = z.object({ applicationId: z.string(), approvalHash: z.string() });
export type SubmitPayload = z.infer<typeof SubmitPayload>;
export const SessionJobPayload = z.object({ kind: SessionPlatform });
export type SessionJobPayload = z.infer<typeof SessionJobPayload>;
