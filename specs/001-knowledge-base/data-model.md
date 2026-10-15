# Data Model: Knowledge Base (F1)

Changes to `packages/db/prisma/schema.prisma` (migration `knowledge_base`). Single user → no
`profileId` foreign keys. Existing `Source`/`SourceType` stay for **job** sources; knowledge sources
get their own table to avoid mixing concerns.

## Modified

### Profile
Unchanged fields + `headline String?`, `summary String?`. Contact fields come from the confirmed
resume (and user edits). Exactly one row (upsert by fixed id `me`).

### ResumeBase
| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| minioKey | String | `resumes/<id>/original.pdf` |
| fileName | String | original name |
| rawText | String? | extracted text (unpdf); basis for `foundInSource()` |
| extraction | enum `ResumeExtraction` `text` \| `vision` \| `manual` | |
| status | enum `ResumeStatus` | see state machine |
| parsed | Json? | `ResumeDraft` (packages/shared) incl. per-item `quote`, `flags` |
| error | String? | last failure reason |
| version | Int | increments per upload |
| active | Boolean | only the last confirmed is active |
| createdAt / confirmedAt | DateTime / DateTime? | |

State machine `ResumeStatus`:
```
uploaded → parsing → review → confirmed
            │  └──→ failed (llm down / unreadable) → parsing (retry)
            └──→ image_only → parsing (vision) | review (manual entry, empty draft)
review → review (draft saved) ; review → discarded
```
Only `review → confirmed` creates/updates verified facts (FR-007).

### Fact
| Field | Type | Notes |
|---|---|---|
| id | cuid | referenced as evidence everywhere |
| kind | FactKind | existing enum, unchanged |
| key | String | deterministic `factKey()` (research R7) |
| value | Json | Zod-typed per kind (`FactValue` discriminated union in packages/shared) |
| verifiedByUser | Boolean | default false |
| status | enum `FactStatus` `active` \| `archived` | archive instead of delete (FR-004) |
| hasOpenConflict | Boolean | denormalized for fast filters; true while any `FactConflict.open` |
| missingFrom | String[] | source origins where the item vanished on last sync (FR-025) |
| createdAt / updatedAt | | |

Remove `sources Json`, `conflict Json?`, `confidence` (replaced by tables below). `@@unique([kind,key])`
kept. **Usable outside dry-run** ⇔ `verifiedByUser && status=active && !hasOpenConflict` — exported
as `usableFactsWhere` helper from `packages/db` so F3/F4 can't forget it (FR-003, FR-020).

## New

### FactSource (FR-002)
| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| factId | → Fact (cascade) | |
| origin | enum `FactOrigin` `resume` \| `linkedin` \| `github` \| `user` | |
| ref | String | `resume:<resumeId>#work[2].highlights[0]`, `github:<owner/repo>:package.json`, `linkedin:experience[1]`, `user:form` |
| rawValue | Json | value exactly as seen in that source |
| snippet | String? | verbatim quote (resume/linkedin/README line) |
| importedAt | DateTime | |
| lastSeenAt | DateTime | updated by sync; drives `missingFrom` |

`@@unique([factId, origin, ref])`.

### FactRevision (FR-004 history)
| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| factId | → Fact (cascade) | |
| action | enum `created` \| `edited` \| `verified` \| `unverified` \| `archived` \| `restored` \| `conflict_resolved` \| `source_added` | |
| before / after | Json? | value snapshots |
| actor | enum `user` \| `import` \| `sync` | |
| note | String? | |
| createdAt | DateTime | |

### FactConflict (FR-018/019)
| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| factId | → Fact | the existing fact |
| type | enum `value_mismatch` \| `possible_duplicate` | |
| candidates | Json | `[{ origin, ref, value, importedAt }]` (≥2) |
| otherFactId | String? | for `possible_duplicate` |
| status | enum `open` \| `resolved` | |
| resolution | Json? | `{ strategy: 'choose'\|'edit'\|'split'\|'merge'\|'keep_separate', value?, chosenIndex? }` |
| createdAt / resolvedAt | | |

Validation: resolving sets `Fact.value`, `verifiedByUser=true`, writes `FactRevision(conflict_resolved)`
with rejected value in `before`; `split` creates a second Fact with key suffix `:2` (unique).

### ProfileSource (knowledge-source connections)
| Field | Type | Notes |
|---|---|---|
| origin | enum `FactOrigin` (only `github` \| `linkedin`) @id | |
| enabled | Boolean | `linkedin` default false (opt-in, FR-016); `github` default true if `GITHUB_TOKEN` set |
| account | String? | `GITHUB_USER` / LinkedIn profile URL |
| lastSyncAt | DateTime? | |
| lastStatus | enum `SyncOutcome` `success` \| `partial` \| `failed` \| null | |
| lastError | String? | e.g. `session_expired`, `rate_limited` |
| resumeAt | DateTime? | GitHub rate-limit continuation |
| snapshot | Json? | last raw normalized snapshot (for diffs) |

No secrets stored (research R13).

### SyncRun (FR-026)
| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| trigger | enum `schedule` \| `manual` \| `import` | |
| localDate | String | `YYYY-MM-DD` America/Sao_Paulo, for once-per-day check |
| startedAt / finishedAt | DateTime | |
| outcomes | Json | `{ github?: {status, error?, counts}, linkedin?: {...} }` |
| summary | Json | `{ added: factId[], conflicted: conflictId[], missing: factId[] }` |

`@@index([trigger, localDate])`.

## Shared Zod schemas (packages/shared)

- `ResumeDraft` — JSON Resume subset: `basics{name,email,phone,location,url,summary,profiles[]}`,
  `work[]{name,position,startDate,endDate,location,summary,highlights[]}`, `education[]`,
  `skills[]{name,keywords[]}`, `languages[]{language,fluency}`, `certificates[]`, `projects[]`;
  each item has `quote: string` and `flags: ('not_in_source'|'date_ambiguous')[]`. Dates as
  `{ year, month?, precision: 'year'|'month' }` or `'present'`.
- `FactValue` — discriminated union by `kind` (experience, skill, education, certification,
  language, project, personal, preference).
- `PersonalFacts` — `salaryExpectation{amount, currency:'BRL'|'USD'|'EUR', contract:'clt'|'pj'|'both', period:'month'|'year'}`,
  `noticePeriodDays`, `availableFrom`, `workModes[]`, `pcd: 'yes'|'no'|'prefer_not'|'not_provided'`,
  `pcdDetails?`, `workAuthorization{ brazil: 'citizen'|'permanent'|'visa'|'not_provided', others[] }`,
  `relocate: 'yes'|'no'|'depends'|'not_provided'`. Every field defaults to `not_provided`/null,
  never a yes/no default (FR-011).
- `SyncProfilePayload` — `{ kind:'parse_resume', resumeId, mode?:'text'|'vision' } |
  { kind:'import_github', syncRunId } | { kind:'import_linkedin', syncRunId } |
  { kind:'sync_all', syncRunId?, trigger:'schedule'|'manual' }` (see contracts/queue-sync-profile.md).
- `RenderRequest` / `RenderResult` — see contracts/rest-api.md.
- `skills.ts` — dictionary `{ id, label, synonyms[], packages{npm[],pypi[],go[],cargo[],maven[],composer[],gem[]} , githubLanguages[] }`.
