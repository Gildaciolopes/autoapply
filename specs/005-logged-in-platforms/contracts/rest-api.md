# REST API — Platforms & submission (`apps/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/platforms` | — | `PlatformView[]` (status, account, caps, maxima, today's usage, pause, next run) |
| POST | `/platforms/linkedin/opt-in` | `{ confirm: "Entendo e quero usar" }` | `200 PlatformView`; `422` wrong text |
| POST | `/platforms/:kind/connect` | — | `202 PlatformView` (`connecting`; enqueues `connect-session`); `409 opt_in_required` (linkedin), `400` for kinds without sessions |
| POST | `/platforms/:kind/connect/done` | `{ cancel?: boolean }` | `200` (sets `connectRequest`) |
| POST | `/platforms/:kind/test` | — | `202` (enqueues `test-session`) |
| DELETE | `/platforms/:kind/session` | — | `200` (session deleted; pending applications of that platform → `needs_input` `session_expired`) |
| PUT | `/platforms/:kind/limits` | `{ submitCap?, simulateCap?, minIntervalSec? }` | `200 PlatformView`; `422 above_max` |
| POST | `/platforms/:kind/resume` | — | `200` (clears pause/backoff) |
| POST | `/applications/:id/approve` | — | `202 ApplicationView` (`approved`, enqueues `submit`); `409 dry_run_mode`, `409 not_ready`, `409 outdated`, `409 platform_not_connected` |
| POST | `/applications/approve` | `{ ids: string[] }` | `202 { approved: ApplicationView[], refused: { id, code }[] }` |
| POST | `/applications/:id/mark` | `{ sent: boolean }` | `200` — only from `submit_uncertain` (`submitted` with `via: manual` or back to `ready`) |
| POST | `/apply/stop` | — | extended: also cancels `submit` jobs and clears approvals |

Schemas in `packages/shared/src/platforms.ts`: `PlatformKind`, `PlatformView`, `PlatformLimitsBody`,
`OptInBody`, `ApproveBatchBody`, `MarkBody`, `SubmitPayload`, `SessionJobPayload`.
