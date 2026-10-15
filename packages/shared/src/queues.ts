import { z } from 'zod';

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
  notify: 'notify',
  syncProfile: 'sync-profile',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DiscoverPayload = z.object({
  source: z.enum(['linkedin_mcp', 'jobspy', 'gupy', 'greenhouse', 'lever', 'ashby', 'workable', 'remotive']),
  query: z.string(),
  location: z.string().default('Brasil'),
  limit: z.number().int().positive().default(50),
});
export type DiscoverPayload = z.infer<typeof DiscoverPayload>;

/** Raw job as emitted by any source (Python scraper must emit this exact shape). */
export const RawJob = z.object({
  source: DiscoverPayload.shape.source,
  externalId: z.string().optional(),
  url: z.string().url(),
  applyUrl: z.string().url().optional(),
  company: z.string(),
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  postedAt: z.string().optional(),
});
export type RawJob = z.infer<typeof RawJob>;

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
