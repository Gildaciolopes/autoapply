# Queue contract — `sync-profile` (existing `QUEUES.syncProfile`)

Producer: `apps/api`. Consumer: `apps/worker` (`SyncProfileProcessor`, concurrency 1).
Payload schema: `SyncProfilePayload` in `packages/shared/src/queues.ts` (discriminated by `kind`).

| kind | Payload | Effect |
|---|---|---|
| `parse_resume` | `{ resumeId, mode?: 'text'\|'vision' }` | download PDF from MinIO → extract text (or vision) → LLM → `ResumeDraft` with `foundInSource` flags → `ResumeBase.status=review`. Never writes facts. |
| `import_github` | `{ syncRunId }` | GraphQL fetch → derive skill evidence → merge into facts (unverified) / conflicts. |
| `import_linkedin` | `{ syncRunId }` | requires `ProfileSource(linkedin).enabled`; `get_my_profile` → LLM map → merge (unverified) / conflicts. |
| `sync_all` | `{ syncRunId?, trigger: 'schedule'\|'manual' }` | for each enabled source run its import sequentially; mark vanished items in `missingFrom`; write `SyncRun.summary`. `schedule` is skipped if a scheduled run exists for the local date. |

Job scheduler: `sync-profile-daily`, cron `0 6 * * *`, tz `America/Sao_Paulo`, registered by API on
boot (`upsertJobScheduler`, idempotent).

Retries: `attempts: 3`, exponential backoff 30 s. Rate-limited GitHub → job completes with source
outcome `partial` and `ProfileSource.resumeAt`; a delayed job is added for `resumeAt`.

Invariants (tested):
1. No processor sets `verifiedByUser=true` (only user actions via API do).
2. No processor changes `Fact.value` of a verified fact; differences → `FactConflict`.
3. Every fact created has ≥1 `FactSource`.
4. Every step emits a `RunEvent` (`queue='sync-profile'`).
