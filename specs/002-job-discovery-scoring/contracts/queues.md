# Queue contracts — Discovery & Scoring

All payloads in `packages/shared/src/queues.ts`; Python mirror `services/scraper/src/autoapply_scraper/models.py`.

## Flow per run (BullMQ FlowProducer)

```
score: process-run { runId }                      ← parent, runs after all children settle
 ├─ discover: { runId, source: 'gupy', query, location, limit }          (worker)
 ├─ discover: { runId, source: 'linkedin_mcp', query, location, limit }  (worker, if enabled)
 └─ discover-jobspy: { runId, source: 'indeed'|'glassdoor'|'google_jobs', query, location, limit, hoursOld } (Python)
```

- Children opts: `ignoreDependencyOnFailure: true`, `attempts: 2`, backoff 30 s. One child per (source, role);
  `limit` = remaining daily cap split across roles; children with limit 0 are not created.
- Child **return value**: `{ source, jobs: RawJob[], error?: string }` (Python returns the same shape).
  `RawJob` gains `source` values `gupy | indeed | glassdoor | google_jobs | linkedin_mcp`.
- `process-run`: `getChildrenValues()` + failed children (`getFailedChildrenValues()`) → per-source outcome;
  then normalize → upsert Job/JobOrigin (cap re-check) → hard filters → embed → similarity → judge top N →
  `DiscoveryRun.status = done`. Every step emits `RunEvent(queue: 'score')`.

## Scheduler

`discovery-daily` on queue `score`, name `start-run`, pattern `SearchPreference.discoveryCron`, tz
America/Sao_Paulo; upserted when `autoDiscover` is true, removed when false. `start-run` creates the flow
unless a scheduled run already exists for the local date.
