# REST API — Tailoring (`apps/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/jobs/:id/tailor` | `{ coverLetter?: boolean }` | `202 { documents: TailoredDocumentView[] }` (resume + letter when required/asked); `409 no_facts` when no usable facts |
| GET | `/jobs/:id/tailored` | — | `{ resume: TailoredDocumentView \| null, coverLetter: … \| null }` (status recomputes `outdated`) |
| GET | `/tailored/:docId/diff` | — | `{ base: RenderModel, tailored: RenderModel, changes: { moved[], hidden[], summary, skillsReordered } }` |
| PATCH | `/tailored/:docId` | `{ hiddenItemIds?, sentences? }` | `200 TailoredDocumentView` (sentences re-validated → `draft` or `422 validation_failed` with findings; nothing saved on 422) |
| POST | `/tailored/:docId/approve` | — | `200`; `409` if `needs_review`/`outdated`/`generating` |
| POST | `/tailored/:docId/regenerate` | — | `202` |
| GET | `/tailored/:docId/pdf` | `?dryRun=true` | `application/pdf` (resume or letter); outside dryRun requires usable facts only |
| GET | `/eval/runs` | `?suite=tailor` | `[EvalRun]` latest first |
