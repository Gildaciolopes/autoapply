# Data Model: Job Discovery and Scoring (F2)

Migration `job_discovery`. Existing F0 models are extended; single user.

## SearchPreference (extend; single row id `default`)

| Field | Type | Notes |
|---|---|---|
| roles | String[] | target role phrases (search queries) |
| seniority | String[] | subset of `intern, junior, mid, senior, lead` |
| stack | String[] | skill names (dictionary aliases) |
| locations | String[] | `"<city>/<UF>"`, `"<UF>"` or `"remote"` |
| workModes | String[] | `remote, hybrid, onsite` |
| minSalary | Int? | monthly BRL |
| **minSalaryContract** | String? | `clt, pj, any` (informational in F2) |
| blockedCompanies | String[] | compared via `normalizeCompany` |
| excludeKeywords | String[] | whole-word, case/accent-insensitive |
| scoreThreshold | Int (70) | used by later features |
| **judgeTopN** | Int (20) | 0–50 |
| **autoDiscover** | Boolean (false) | daily scheduled run |
| **discoveryCron** | String (`0 7 * * *`) | tz America/Sao_Paulo |
| mode, scheduleCron | existing | F6 |

## SourceType (extend enum)

Add `indeed`, `glassdoor`, `google_jobs`. `jobspy` stays for backward compatibility (unused).

## Source (existing; rows seeded on API boot)

`gupy` (enabled, cap 50), `indeed` (enabled, 50), `glassdoor` (enabled, 50), `google_jobs` (enabled, 50),
`linkedin_mcp` (**disabled**, 15). Add `lastStatus String?`, `lastError String?`.

## Job (extend)

| Field | Type | Notes |
|---|---|---|
| sourceId | → Source | first source seen (kept) |
| title / description / url / applyUrl | existing | |
| companyId | → Company | name as shown |
| location | String? | raw |
| **city / uf** | String? | parsed |
| **remote** | Boolean | |
| workMode | String? | `remote|hybrid|onsite|null` |
| **seniority** | String? | detected or null |
| salaryMin / salaryMax | Int? | monthly BRL when known |
| **salaryText** | String? | original salary text |
| postedAt | DateTime? | |
| dedupeHash | String @unique | R5 |
| **firstSeenAt / lastSeenAt** | DateTime | |
| **hidden** | Boolean (false) | user action |
| **interesting** | Boolean (false) | user action |
| embedding | vector(1024)? | existing |

Derived: `possiblyClosed = lastSeenAt < now − 14d`.

## JobOrigin (new)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| jobId | → Job (cascade) | |
| source | SourceType | |
| externalId | String | source id, or url when none |
| url | String | |
| firstSeenAt / lastSeenAt | DateTime | cap accounting uses firstSeenAt |
| runId | String? | first run that found it |

`@@unique([source, externalId])`, `@@index([source, firstSeenAt])`.

## JobScore (extend; 1:1 Job)

| Field | Type | Notes |
|---|---|---|
| passed | Boolean | hard filters |
| filterReason | String? | `blocked_company, excluded_keyword, location_mode, salary_below_min, seniority, off_target` |
| similarity | Float? | cosine |
| score | Int | pre-judge similarity score or judge score |
| judged | Boolean | |
| matched | String[] | skill labels (kept for compatibility) |
| **matchedEvidence** | Json | `[{ skill, factIds[] }]` grounded (FR-014) |
| missing | String[] | |
| reasons | String | |
| model | String | embedding/LLM model ids |
| **profileHash** | String | which profile text was used |
| **demoted** | String[] | skills the LLM claimed but grounding rejected (audit) |
| createdAt / **updatedAt** | DateTime | |

## DiscoveryRun (new)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| trigger | `manual|schedule|rescore` | |
| localDate | String | once-per-day rule |
| status | `running|done|failed` | |
| startedAt / finishedAt | DateTime | |
| outcomes | Json | `{ [source]: { status, found, new, duplicates, filtered, error? } }` |
| judged | Int | |

## ProfileVector (new)

| Field | Type | Notes |
|---|---|---|
| hash | String @id | sha256(profileText) |
| text | String | |
| embedding | vector(1024) | |
| createdAt | DateTime | |

## Shared Zod (packages/shared/src/jobs.ts)

`Preferences`, `SourceView`, `JobCard` (job + score + origins + possiblyClosed), `JobsQuery`,
`DiscoveryRunView`, `JudgeResult` (LLM schema), `DiscoverPayload` v2 (`runId`, `source`, `query`,
`location`, `limit`) — Python `models.py` mirrors it.
