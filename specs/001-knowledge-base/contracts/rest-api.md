# REST API contract — Knowledge Base (`apps/api`, prefix `/kb`)

JSON unless noted. Errors: `{ error: { code, message, details? } }` with HTTP 4xx/5xx (`details` carries
structured data, e.g. unresolved item ids or overflow items). Request/response bodies
are Zod schemas in `packages/shared/src/kb.ts` (names in brackets). Web (`apps/web`) is the only
client; no auth (single user, localhost).

## Resumes

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/kb/resumes` | multipart `file` (PDF ≤ 5 MB) | `202 { id, status:'uploaded' }`; `415 not_pdf`, `413 too_large` |
| GET | `/kb/resumes` | — | `[ResumeSummary]` newest first |
| GET | `/kb/resumes/:id` | — | `ResumeDetail { …ResumeSummary, draft: ResumeDraft \| null, diff: ResumeDiff \| null }` (`error: string \| null`) |
| GET | `/kb/resumes/:id/file` | — | `application/pdf` original |
| PUT | `/kb/resumes/:id/draft` | `ResumeDraft` | `200 ResumeDetail` (status stays `review`) |
| POST | `/kb/resumes/:id/retry` | `{ mode: 'text'\|'vision' }` | `202` (from `failed`/`image_only`) |
| POST | `/kb/resumes/:id/manual` | — | `200` empty draft in `review` (manual entry) |
| POST | `/kb/resumes/:id/confirm` | `{ acceptFlagged: string[] }` item paths the user kept despite `not_in_source` | `200 { created, updated, conflicts }`; `409` if status ≠ `review`; `422 unresolved_flags` with `details: string[]` (draft item ids) if flagged items are neither removed nor in `acceptFlagged` |
| POST | `/kb/resumes/:id/discard` | — | `200` |

`ResumeDiff` (re-upload, FR-009): `{ added: itemId[], changed: {itemId, factId, before, after}[], removed: {factId, key}[], unchanged: itemId[] }`.
Removed items are not deleted on confirm: their facts get `missingFrom: ['resume']`.

## Facts

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/kb/facts` | `?kind&origin&verified&conflict&status=active\|archived&q` | `[FactView]` (`FactView` = fact + sources + openConflictId?) |
| GET | `/kb/facts/:id` | — | `FactView & { revisions: FactRevision[] }` (`source_added` revisions store `after: { origin, ref }`) |
| PATCH | `/kb/facts/:id` | `{ value?, verified? }` | `200 FactView` (writes revision) |
| POST | `/kb/facts` | `{ kind, value }` (user-entered) | `201 FactView` (origin `user`, verified) |
| POST | `/kb/facts/bulk` | `{ ids: string[], action: 'verify'\|'unverify'\|'archive'\|'restore' }` | `200 { updated }` |

## Personal facts

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/kb/personal` | — | `PersonalFacts` (missing → `not_provided`) |
| PUT | `/kb/personal` | `PersonalFacts` | `200 PersonalFacts`; each field ↔ one `personal:*` fact, verified, origin `user` |

## Conflicts

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/kb/conflicts` | `?status=open` | `[ConflictView]` (candidates with origin, ref, importedAt) |
| POST | `/kb/conflicts/:id/resolve` | `{ strategy:'choose', chosenIndex } \| { strategy:'edit', value } \| { strategy:'split' } \| { strategy:'merge' } \| { strategy:'keep_separate' }` | `200 { factIds }`; `409` if already resolved |

## Sources and sync

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/kb/sources` | — | `[ProfileSourceView]` (enabled, account, lastSyncAt, lastStatus, lastError, configured: bool) |
| PATCH | `/kb/sources/:origin` | `{ enabled }` (`github`\|`linkedin`) | `200` |
| POST | `/kb/sources/:origin/import` | — | `202 { syncRunId }`; `409 source_disabled`; `412 not_configured` (no `GITHUB_TOKEN`) |
| POST | `/kb/sync` | — | `202 { syncRunId }` (manual sync now) |
| GET | `/kb/sync-runs` | `?limit=10` | `[SyncRun]` |

## Render

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/kb/render` | `RenderRequest { hiddenItemIds?: string[], lang?: 'pt'\|'en', dryRun?: boolean }` | `200 application/pdf` with headers `X-Ats-Score`, `X-Pages: 1`; or `422 { error: { code:'overflow', message, details: { pages, items: RenderItem[] } } }` so the UI can pick items to hide (FR-022) |
| POST | `/kb/render/lint` | same | `200 { score, checks: {id, pass, detail}[] }`; on overflow `score: 0`, failing `one_page` check and `overflow: { pages, items }` |

Render input = usable facts only (`usableFactsWhere`) unless `dryRun=true`, which also includes
unverified facts with a visible "DRY-RUN" watermark (US3 scenario 4).
