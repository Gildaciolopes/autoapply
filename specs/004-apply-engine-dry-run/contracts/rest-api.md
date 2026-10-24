# REST API — Apply dry-run (`apps/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/jobs/:id/apply` | — | `202 ApplicationView` (creates/resets the job's Application, mode `dry_run`, enqueues); `409 no_apply_url`, `409 already_running` |
| POST | `/apply/batch` | `{ jobIds?: string[], topN?: number }` | `202 { queued: ApplicationView[] }` (`topN`: best-scored jobs with a ready tailored resume, no `ready` application yet) |
| POST | `/apply/stop` | — | `200 { cancelled: number }` (kill switch, R9) |
| GET | `/applications` | `?status=ready\|needs_input\|failed\|queued\|applying\|skipped` | `ApplicationListItem[]` (job title/company, ats, status, first reason, outdated, updatedAt) |
| GET | `/applications/summary` | — | `{ ready, needs_input: { byReason }, failed, queued, applying }` |
| GET | `/applications/:id` | — | `ApplicationView` (answers, artifacts, reasons, report, outdated) |
| GET | `/applications/:id/artifacts/:artifactId` | — | `image/png` stream |
| POST | `/applications/:id/answers` | `{ answers: [{ fieldKey, answer, factIds?: string[] }], rerun?: boolean }` | `200 ApplicationView` — stores approved `AnswerMemory` (source `user`), optionally re-enqueues; `422` if `fieldKey` unknown |
| POST | `/applications/:id/rerun` | — | `202 ApplicationView` |
| GET | `/eval/runs` | `?suite=apply-answers` | existing endpoint, new suite |

Schemas (`packages/shared/src/apply.ts`): `ApplicationView`, `ApplicationListItem`, `FormAnswerView`,
`NeedsReason`, `ApplyBatchBody`, `UserAnswersBody`, `ApplyPayload`.
