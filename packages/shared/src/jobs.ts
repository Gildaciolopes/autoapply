import { z } from 'zod';

/** F2 discovery & scoring contracts. See specs/002-job-discovery-scoring. */

export const Seniority = z.enum(['intern', 'junior', 'mid', 'senior', 'lead']);
export type Seniority = z.infer<typeof Seniority>;
export const WorkMode = z.enum(['remote', 'hybrid', 'onsite']);
export type WorkMode = z.infer<typeof WorkMode>;
export const JobSourceType = z.enum(['gupy', 'indeed', 'glassdoor', 'google_jobs', 'linkedin_mcp']);
export type JobSourceType = z.infer<typeof JobSourceType>;
export const JOB_SOURCES = JobSourceType.options;

export const Preferences = z.object({
  roles: z.array(z.string().min(1)).default([]),
  seniority: z.array(Seniority).default([]),
  stack: z.array(z.string().min(1)).default([]),
  /** "<city>/<UF>", "<UF>" or "remote" */
  locations: z.array(z.string().min(1)).default([]),
  workModes: z.array(WorkMode).default([]),
  minSalary: z.number().int().positive().nullable().default(null),
  minSalaryContract: z.enum(['clt', 'pj', 'any']).nullable().default(null),
  blockedCompanies: z.array(z.string().min(1)).default([]),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  judgeTopN: z.number().int().min(0).max(50).default(20),
  autoDiscover: z.boolean().default(false),
  discoveryCron: z.string().default('0 7 * * *'),
  saved: z.boolean().default(false),
});
export type Preferences = z.infer<typeof Preferences>;

export const SourceView = z.object({
  type: JobSourceType,
  enabled: z.boolean(),
  dailyCap: z.number().int(),
  usedToday: z.number().int(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  warning: z.string().nullable(),
});
export type SourceView = z.infer<typeof SourceView>;
export const PatchSourceBody = z.object({
  enabled: z.boolean().optional(),
  dailyCap: z.number().int().min(0).max(200).optional(),
  acceptTerms: z.boolean().optional(),
});

export const FilterReason = z.enum(['blocked_company', 'excluded_keyword', 'location_mode', 'salary_below_min', 'seniority', 'off_target']);
export type FilterReason = z.infer<typeof FilterReason>;

export const JobSourceOutcome = z.object({
  status: z.enum(['success', 'failed', 'skipped']),
  found: z.number().int().default(0),
  new: z.number().int().default(0),
  duplicates: z.number().int().default(0),
  filtered: z.number().int().default(0),
  error: z.string().optional(),
});
export type JobSourceOutcome = z.infer<typeof JobSourceOutcome>;

export const DiscoveryRunView = z.object({
  id: z.string(),
  trigger: z.enum(['manual', 'schedule', 'rescore']),
  localDate: z.string(),
  status: z.enum(['running', 'done', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcomes: z.record(z.string(), JobSourceOutcome),
  judged: z.number().int(),
});
export type DiscoveryRunView = z.infer<typeof DiscoveryRunView>;

export const MatchedEvidence = z.object({ skill: z.string(), factIds: z.array(z.string()) });
export type MatchedEvidence = z.infer<typeof MatchedEvidence>;

export const JobCard = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  city: z.string().nullable(),
  uf: z.string().nullable(),
  remote: z.boolean(),
  workMode: z.string().nullable(),
  seniority: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryText: z.string().nullable(),
  url: z.string(),
  applyUrl: z.string().nullable(),
  postedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  possiblyClosed: z.boolean(),
  hidden: z.boolean(),
  interesting: z.boolean(),
  origins: z.array(z.object({ source: z.string(), url: z.string() })),
  score: z
    .object({
      score: z.number(),
      passed: z.boolean(),
      filterReason: FilterReason.nullable(),
      similarity: z.number().nullable(),
      judged: z.boolean(),
      matched: z.array(MatchedEvidence),
      missing: z.array(z.string()),
      reasons: z.string(),
    })
    .nullable(),
});
export type JobCard = z.infer<typeof JobCard>;

export const JobsQuery = z.object({
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  source: JobSourceType.optional(),
  workMode: WorkMode.optional(),
  judged: z.enum(['true', 'false']).optional(),
  newSince: z.iso.datetime().optional(),
  showFiltered: z.enum(['true', 'false']).optional(),
  showHidden: z.enum(['true', 'false']).optional(),
  interesting: z.enum(['true', 'false']).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type JobsQuery = z.infer<typeof JobsQuery>;

export const PatchJobBody = z.object({ hidden: z.boolean().optional(), interesting: z.boolean().optional() });

/** LLM judge output (validated, then grounded by code before storing). */
export const JudgeResult = z.object({
  score: z.number().int().min(0).max(100),
  matched: z.array(z.object({ skill: z.string(), factIds: z.array(z.string()) })),
  missing: z.array(z.string()),
  reasons: z.string().max(600),
});
export type JudgeResult = z.infer<typeof JudgeResult>;
