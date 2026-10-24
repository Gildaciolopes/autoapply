import { z } from 'zod';
import { JobSourceType } from './jobs.js';

/** Pipeline: discover → normalize → enrich → embed → score → tailor → apply → notify */
export const QUEUES = {
  discover: 'discover', // worker: API/MCP sources (gupy, greenhouse, lever, linkedin_mcp...)
  discoverJobspy: 'discover-jobspy', // services/scraper (Python, JobSpy)
  normalize: 'normalize',
  enrich: 'enrich',
  embed: 'embed',
  score: 'score',
  tailor: 'tailor',
  apply: 'apply',
  notify: 'notify', // F6: morning report + Telegram commands
  night: 'night', // F6: overnight run state machine (night-tick)
  mail: 'mail', // F7: Gmail reply tracking (mail-check)
  syncProfile: 'sync-profile',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DiscoverPayload = z.object({
  runId: z.string(),
  source: JobSourceType,
  query: z.string(),
  location: z.string().default('Brasil'),
  limit: z.number().int().positive().default(50),
  hoursOld: z.number().int().positive().optional(),
});
export type DiscoverPayload = z.infer<typeof DiscoverPayload>;

/** Raw job as emitted by any source (Python scraper must emit this exact shape). */
export const RawJob = z.object({
  source: JobSourceType,
  /** Source id; when the source has none, the url is used as origin key. */
  externalId: z.string().optional(),
  url: z.string().url(),
  applyUrl: z.string().url().optional(),
  company: z.string(),
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  uf: z.string().optional(),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryText: z.string().optional(),
  postedAt: z.string().optional(),
});
export type RawJob = z.infer<typeof RawJob>;

/** Return value of every discover child job (worker and Python). */
export const DiscoverResult = z.object({
  source: JobSourceType,
  jobs: z.array(RawJob),
  error: z.string().optional(),
});
export type DiscoverResult = z.infer<typeof DiscoverResult>;

/** Parent of a discovery flow (queue `score`). */
export const ProcessRunPayload = z.object({
  runId: z.string(),
  rescore: z.boolean().default(false),
  judge: z.boolean().default(true),
});
export type ProcessRunPayload = z.infer<typeof ProcessRunPayload>;

export const JobIdPayload = z.object({ jobId: z.string() });
export const ApplicationIdPayload = z.object({ applicationId: z.string() });

/** Knowledge base background work (F1), all on the `sync-profile` queue, concurrency 1. */
export const SyncProfilePayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parse_resume'), resumeId: z.string(), mode: z.enum(['text', 'vision']).default('text') }),
  z.object({ kind: z.literal('import_github'), syncRunId: z.string() }),
  z.object({ kind: z.literal('import_linkedin'), syncRunId: z.string() }),
  z.object({
    kind: z.literal('sync_all'),
    syncRunId: z.string().optional(),
    trigger: z.enum(['schedule', 'manual']),
  }),
]);
export type SyncProfilePayload = z.infer<typeof SyncProfilePayload>;
