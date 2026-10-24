# REST API — Overnight runs (`apps/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/night/settings` | — | `NightSettings` (+ `next` window) |
| PUT | `/night/settings` | `NightSettingsBody { enabled?, start?, end?, days?, budget? }` | `200 NightSettings`; `400` schema (bad HH:MM, empty/repeated days, budget ∉ 1–40); `422 invalid_window` (start = end after merge) |
| POST | `/night/runs` | — | `202 NightRunView` ("Rodar agora", trigger `manual`); `409 already_running`, `409 paused` |
| GET | `/night/runs` | `?limit=` | `NightRunListItem[]` (newest first) |
| GET | `/night/runs/:id` | — | `NightRunView` (phase, status, counters, step errors, pending, report, report status) |
| GET (SSE) | `/night/runs/:id/events` | header `Last-Event-ID` or `?after=<seq>` | `text/event-stream`: `id: <seq>`, `event: event`, `data: RunEventView`; `event: end` when the run is final |
| GET | `/control` | — | `ControlState { paused, pausedAt, running, next }` |
| POST | `/control/stop` | — | `200 { cancelled, removedJobs, runStopped }` — global kill switch (R5); `/apply/stop` is an alias |
| POST | `/control/resume` | — | `200 ControlState` (re-enables scheduling only) |
| GET | `/review` | `?run=<id>` | `ReviewQueue` (groups ready / needs_input / failed / submit_uncertain / waiting_limit / approved, counts, ordered by score) |
| POST | `/review/estimate` | `{ ids: string[] }` | `SendEstimate { perPlatform: { kind, count, remainingToday, days, minutes }[] }` |
| POST | `/applications/:id/reject` | `RejectBody { reason }` | `200 ApplicationView` (`rejected`); `409 not_rejectable` (submitting/submitted/uncertain/approved) |
| POST | `/applications/:id/unreject` | — | `202 ApplicationView` (re-prepare) |
| POST | `/applications/:id/answers` | `UserAnswersBody` (F4) | extended: on a `ready` application any non-file answer may be edited → memory `origin: edit`, re-prepare |
| GET | `/memories` | `?q=&enabled=` | `MemoryView[]` (question, answer, field type, origin, enabled, uses, last use, conflict?) |
| PATCH | `/memories/:id` | `MemoryPatchBody { answer?, enabled? }` | `200 MemoryView` (answer change resets embedding) |
| DELETE | `/memories/:id` | — | `204` |
| POST | `/notify/test` | — | `200 { status: 'sent' \| 'not_configured' \| 'failed', error? }` (sends "AutoApply conectado") |

Unchanged and reused: `POST /applications/:id/approve`, `POST /applications/approve` (F5; refuse
`mode != review`).

Schemas in `packages/shared/src/night.ts` (see data-model.md).
