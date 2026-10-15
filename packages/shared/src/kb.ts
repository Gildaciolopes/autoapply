import { z } from 'zod';

/**
 * Knowledge base contracts (F1). Facts are the only thing downstream features may claim
 * (constitution §I). See specs/001-knowledge-base/data-model.md.
 */

// ---------- primitives ----------

/** Dates keep their real precision: a year-only date never gets an invented month. */
export const LooseDate = z.union([
  z.object({
    year: z.number().int().min(1950).max(2100),
    month: z.number().int().min(1).max(12).optional(),
    precision: z.enum(['year', 'month']),
  }),
  z.literal('present'),
]);
export type LooseDate = z.infer<typeof LooseDate>;

export const ItemFlag = z.enum(['not_in_source', 'date_ambiguous']);
export type ItemFlag = z.infer<typeof ItemFlag>;

const ItemMeta = {
  /** Stable id inside the draft (e.g. "work-0"). */
  id: z.string(),
  /** Verbatim snippet from the source document backing this item. */
  quote: z.string().default(''),
  flags: z.array(ItemFlag).default([]),
};

export const FactOriginEnum = z.enum(['resume', 'linkedin', 'github', 'user']);
export type FactOrigin = z.infer<typeof FactOriginEnum>;

export const FactKindEnum = z.enum([
  'experience',
  'skill',
  'metric',
  'project',
  'education',
  'certification',
  'language',
  'personal',
  'preference',
]);
export type FactKind = z.infer<typeof FactKindEnum>;

// ---------- resume draft (JSON Resume subset + provenance) ----------

export const DraftWork = z.object({
  ...ItemMeta,
  name: z.string().min(1), // company
  position: z.string().min(1),
  location: z.string().optional(),
  startDate: LooseDate.nullable(),
  endDate: LooseDate.nullable(),
  highlights: z.array(z.string()).default([]),
});
export const DraftEducation = z.object({
  ...ItemMeta,
  institution: z.string().min(1),
  studyType: z.string().optional(), // degree
  area: z.string().optional(),
  startDate: LooseDate.nullable(),
  endDate: LooseDate.nullable(),
});
export const DraftSkill = z.object({ ...ItemMeta, name: z.string().min(1), category: z.string().optional() });
export const DraftLanguage = z.object({ ...ItemMeta, language: z.string().min(1), fluency: z.string().optional() });
export const DraftCertificate = z.object({
  ...ItemMeta,
  name: z.string().min(1),
  issuer: z.string().optional(),
  date: LooseDate.nullable().optional(),
});
export const DraftProject = z.object({
  ...ItemMeta,
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});

export const DraftBasics = z.object({
  name: z.string().default(''),
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  summary: z.string().optional(),
  profiles: z.array(z.object({ network: z.string(), url: z.string() })).default([]),
});

export const ResumeDraft = z.object({
  /** Language of the source document; content is never translated. */
  lang: z.enum(['pt', 'en', 'other']).default('pt'),
  basics: DraftBasics,
  work: z.array(DraftWork).default([]),
  education: z.array(DraftEducation).default([]),
  skills: z.array(DraftSkill).default([]),
  languages: z.array(DraftLanguage).default([]),
  certificates: z.array(DraftCertificate).default([]),
  projects: z.array(DraftProject).default([]),
});
export type ResumeDraft = z.infer<typeof ResumeDraft>;
export type DraftWork = z.infer<typeof DraftWork>;
export type DraftEducation = z.infer<typeof DraftEducation>;
export type DraftSkill = z.infer<typeof DraftSkill>;

export const DRAFT_SECTIONS = ['work', 'education', 'skills', 'languages', 'certificates', 'projects'] as const;
export type DraftSection = (typeof DRAFT_SECTIONS)[number];

// ---------- personal facts ----------

export const PersonalFacts = z.object({
  salaryExpectation: z
    .object({
      amount: z.number().positive(),
      currency: z.enum(['BRL', 'USD', 'EUR']),
      contract: z.enum(['clt', 'pj', 'both']),
      period: z.enum(['month', 'year']),
    })
    .nullable()
    .default(null),
  noticePeriodDays: z.number().int().min(0).nullable().default(null),
  availableFrom: z.iso.date().nullable().default(null),
  workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).default([]),
  pcd: z.enum(['yes', 'no', 'prefer_not', 'not_provided']).default('not_provided'),
  pcdDetails: z.string().nullable().default(null),
  workAuthorization: z
    .object({
      brazil: z.enum(['citizen', 'permanent', 'visa', 'not_provided']).default('not_provided'),
      others: z.array(z.string()).default([]),
    })
    .default({ brazil: 'not_provided', others: [] }),
  relocate: z.enum(['yes', 'no', 'depends', 'not_provided']).default('not_provided'),
});
export type PersonalFacts = z.infer<typeof PersonalFacts>;
export const PERSONAL_FIELDS = Object.keys(PersonalFacts.shape) as (keyof PersonalFacts)[];
export type PersonalField = keyof PersonalFacts;

// ---------- fact values (by kind) ----------

export const GithubEvidence = z.object({
  repoCount: z.number().int().min(0),
  lastActivity: z.string().nullable(), // ISO date, computed by code
  repos: z.array(z.string()),
  forkOnly: z.boolean(),
  archivedOnly: z.boolean(),
  via: z.array(z.enum(['language', 'manifest', 'readme'])),
});
export type GithubEvidence = z.infer<typeof GithubEvidence>;

export const FactValueSchemas = {
  experience: z.object({
    company: z.string(),
    title: z.string(),
    location: z.string().optional(),
    start: LooseDate.nullable(),
    end: LooseDate.nullable(),
    highlights: z.array(z.string()).default([]),
  }),
  skill: z.object({
    name: z.string(),
    category: z.string().optional(),
    evidence: GithubEvidence.optional(),
  }),
  education: z.object({
    institution: z.string(),
    degree: z.string().optional(),
    area: z.string().optional(),
    start: LooseDate.nullable(),
    end: LooseDate.nullable(),
  }),
  certification: z.object({ name: z.string(), issuer: z.string().optional(), date: LooseDate.nullable().optional() }),
  language: z.object({ language: z.string(), fluency: z.string().optional() }),
  project: z.object({
    name: z.string(),
    description: z.string().optional(),
    url: z.string().optional(),
    highlights: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
  }),
  metric: z.object({ label: z.string(), value: z.string() }),
  personal: z.object({ field: z.string(), value: z.unknown() }),
  preference: z.object({ name: z.string(), value: z.unknown() }),
} satisfies Record<FactKind, z.ZodType>;

export type FactValueOf<K extends FactKind> = z.infer<(typeof FactValueSchemas)[K]>;
export type AnyFactValue = { [K in FactKind]: FactValueOf<K> }[FactKind];

export function parseFactValue<K extends FactKind>(kind: K, value: unknown): FactValueOf<K> {
  return FactValueSchemas[kind].parse(value) as FactValueOf<K>;
}

// ---------- API DTOs ----------

export const FactSourceView = z.object({
  id: z.string(),
  origin: FactOriginEnum,
  ref: z.string(),
  rawValue: z.unknown(),
  snippet: z.string().nullable(),
  importedAt: z.string(),
  lastSeenAt: z.string(),
});
export type FactSourceView = z.infer<typeof FactSourceView>;

export const FactView = z.object({
  id: z.string(),
  kind: FactKindEnum,
  key: z.string(),
  value: z.unknown(),
  verifiedByUser: z.boolean(),
  status: z.enum(['active', 'archived']),
  hasOpenConflict: z.boolean(),
  missingFrom: z.array(z.string()),
  sources: z.array(FactSourceView),
  openConflictId: z.string().nullable(),
  updatedAt: z.string(),
});
export type FactView = z.infer<typeof FactView>;

export const FactRevisionView = z.object({
  id: z.string(),
  action: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  actor: z.enum(['user', 'import', 'sync']),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type FactRevisionView = z.infer<typeof FactRevisionView>;

export const FactsQuery = z.object({
  kind: FactKindEnum.optional(),
  origin: FactOriginEnum.optional(),
  verified: z.enum(['true', 'false']).optional(),
  conflict: z.enum(['true', 'false']).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  q: z.string().optional(),
});
export type FactsQuery = z.infer<typeof FactsQuery>;

export const CreateFactBody = z.object({ kind: FactKindEnum, value: z.unknown() });
export const PatchFactBody = z.object({ value: z.unknown().optional(), verified: z.boolean().optional() });
export const BulkFactsBody = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(['verify', 'unverify', 'archive', 'restore']),
});

export const ConflictCandidate = z.object({
  origin: FactOriginEnum,
  ref: z.string(),
  value: z.unknown(),
  importedAt: z.string(),
});
export type ConflictCandidate = z.infer<typeof ConflictCandidate>;

export const ConflictView = z.object({
  id: z.string(),
  factId: z.string(),
  kind: FactKindEnum,
  key: z.string(),
  type: z.enum(['value_mismatch', 'possible_duplicate']),
  candidates: z.array(ConflictCandidate),
  otherFactId: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  createdAt: z.string(),
});
export type ConflictView = z.infer<typeof ConflictView>;

export const ResolveConflictBody = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('choose'), chosenIndex: z.number().int().min(0) }),
  z.object({ strategy: z.literal('edit'), value: z.unknown() }),
  z.object({ strategy: z.literal('split') }),
  z.object({ strategy: z.literal('merge') }),
  z.object({ strategy: z.literal('keep_separate') }),
]);
export type ResolveConflictBody = z.infer<typeof ResolveConflictBody>;

export const ResumeStatusEnum = z.enum([
  'uploaded',
  'parsing',
  'image_only',
  'failed',
  'review',
  'confirmed',
  'discarded',
]);
export type ResumeStatus = z.infer<typeof ResumeStatusEnum>;

export const ResumeSummary = z.object({
  id: z.string(),
  fileName: z.string(),
  status: ResumeStatusEnum,
  extraction: z.enum(['text', 'vision', 'manual']),
  version: z.number(),
  active: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type ResumeSummary = z.infer<typeof ResumeSummary>;

export const ResumeDiff = z.object({
  added: z.array(z.string()), // draft item ids
  changed: z.array(z.object({ itemId: z.string(), factId: z.string(), before: z.unknown(), after: z.unknown() })),
  removed: z.array(z.object({ factId: z.string(), key: z.string() })),
  unchanged: z.array(z.string()),
});
export type ResumeDiff = z.infer<typeof ResumeDiff>;

export const ResumeDetail = ResumeSummary.extend({
  draft: ResumeDraft.nullable(),
  diff: ResumeDiff.nullable(),
});
export type ResumeDetail = z.infer<typeof ResumeDetail>;

export const ConfirmResumeBody = z.object({ acceptFlagged: z.array(z.string()).default([]) });
export const RetryResumeBody = z.object({ mode: z.enum(['text', 'vision']).default('text') });

export const ProfileSourceView = z.object({
  origin: z.enum(['github', 'linkedin']),
  enabled: z.boolean(),
  configured: z.boolean(),
  account: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastStatus: z.enum(['success', 'partial', 'failed']).nullable(),
  lastError: z.string().nullable(),
});
export type ProfileSourceView = z.infer<typeof ProfileSourceView>;

export const SourceOutcome = z.object({
  status: z.enum(['success', 'partial', 'failed', 'skipped']),
  error: z.string().optional(),
  counts: z.object({ added: z.number(), sourced: z.number(), conflicts: z.number(), missing: z.number() }).optional(),
});
export type SourceOutcome = z.infer<typeof SourceOutcome>;

export const SyncSummary = z.object({
  added: z.array(z.string()).default([]),
  conflicted: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
});
export type SyncSummary = z.infer<typeof SyncSummary>;

export const SyncRunView = z.object({
  id: z.string(),
  trigger: z.enum(['schedule', 'manual', 'import']),
  localDate: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcomes: z.record(z.string(), SourceOutcome),
  summary: SyncSummary,
});
export type SyncRunView = z.infer<typeof SyncRunView>;

export const RenderRequest = z.object({
  hiddenItemIds: z.array(z.string()).default([]),
  lang: z.enum(['pt', 'en']).default('pt'),
  dryRun: z.boolean().default(false),
});
export type RenderRequest = z.infer<typeof RenderRequest>;

export const RenderItem = z.object({ id: z.string(), section: z.string(), label: z.string() });
export type RenderItem = z.infer<typeof RenderItem>;

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
