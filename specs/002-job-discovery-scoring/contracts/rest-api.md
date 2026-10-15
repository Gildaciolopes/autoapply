# REST API contract — Discovery & Scoring (`apps/api`)

Errors: `{ error: { code, message, details? } }`. DTOs: `packages/shared/src/jobs.ts`.

## Preferences & sources

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/preferences` | — | `Preferences` (defaults if never saved, `saved: false`) |
| GET | `/preferences/suggest` | — | `Preferences` suggested from usable facts (not saved, FR-002) |
| PUT | `/preferences` | `Preferences` | `200 Preferences`; re-applies hard filters to open jobs (FR-016) → `{ refiltered }` in header `x-refiltered` |
| GET | `/sources` | — | `[SourceView]` (type, enabled, dailyCap, usedToday, lastStatus, lastError, warning?) |
| PATCH | `/sources/:type` | `{ enabled?, dailyCap? }` | `200 SourceView`; LinkedIn enable requires `{ acceptTerms: true }` else `409 terms_required` |

## Discovery

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/discovery/runs` | — | `202 { runId }`; `409 run_in_progress` if one is running; `412 no_preferences` if no roles |
| GET | `/discovery/runs` | `?limit=10` | `[DiscoveryRunView]` |
| GET | `/discovery/runs/:id` | — | `DiscoveryRunView` |
| POST | `/scoring/rescore` | `{ judge?: boolean }` | `202 { runId }` — recompute similarity for open jobs, judge new top N |

## Feed

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/jobs` | `JobsQuery { minScore?, maxScore?, source?, workMode?, judged?, newSince?, showFiltered?, showHidden?, interesting?, cursor?, limit? }` | `{ items: JobCard[], nextCursor }` ordered by score desc, postedAt desc |
| GET | `/jobs/:id` | — | `JobCard & { description, matchedEvidence: { skill, facts: {id, kind, summary}[] }[] }` |
| PATCH | `/jobs/:id` | `{ hidden?, interesting? }` | `200 JobCard` |
| POST | `/jobs/:id/block-company` | — | `200 { company, hiddenJobs }` — adds to `blockedCompanies`, re-filters |
