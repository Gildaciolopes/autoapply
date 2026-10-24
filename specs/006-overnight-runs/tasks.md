---
description: "Task list for F6 Overnight Runs"
---

# Tasks: Overnight Runs

**Input**: Design documents from `/specs/006-overnight-runs/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution §VI and SC-001..SC-008. Pure helpers unit-tested; tick state machine,
report, Telegram, SSE, review and memory on `autoapply_test` with fake clock / fake enqueuers / fake
`fetch`. Zero real submissions, zero real Telegram calls.

**Order**: Foundational (schema, contracts, pure night helpers, shared DB helpers) → US1 (scheduled run)
→ US3 (kill switch, needed before unattended runs) → US2 (review queue) → US5 (memory) → US4 (report)
→ US6 (live log) → Polish.

## Format: `[ID] [P?] [Story] Description` — ESM relative imports end in `.js`.

---

## Phase 1: Setup

- [X] T001 `.env.example`: document `TELEGRAM_BOT_TOKEN` (from @BotFather) / `TELEGRAM_CHAT_ID` (your private chat id; only this chat is obeyed) and that the report contains no personal data; add `QUEUES.night = 'night'` in `packages/shared/src/queues.ts` (api `queues.module.ts` and worker `worker.module.ts` register all `QUEUES`)

---

## Phase 2: Foundational

- [X] T002 Update `packages/db/prisma/schema.prisma` per data-model.md: new `NightRun` (`trigger NightTrigger`, `scheduleKey String? @unique`, `nightDate String`, `status NightStatus @default(running)`, `phase NightPhase @default(discovering)`, `windowEnd DateTime?`, `budget Int`, `discoveryRunId String?`, `stepErrors Json @default("[]")`, `counters Json @default("{}")`, `pending Json @default("[]")`, `report Json?`, `reportStatus ReportStatus @default(pending)`, `reportError String?`, `reportSentAt DateTime?`, `startedAt @default(now())`, `finishedAt DateTime?`, indexes `status`, `startedAt`); enums `NightTrigger (schedule, manual)`, `NightStatus (running, ok, partial, failed, stopped, skipped, missed)`, `NightPhase (discovering, preparing, waiting, finishing, done)`, `ReportStatus (pending, sent, not_sent, not_configured)`; `SearchPreference` remove `scheduleCron`, add `nightEnabled Boolean @default(false)`, `nightStart String @default("23:00")`, `nightEnd String @default("06:59")`, `nightDays Int[] @default([0,1,2,3,4,5,6])`, `nightBudget Int @default(20)`, `pausedAt DateTime?`, `nightLastTickAt DateTime?`, `telegramOffset Int @default(0)`; `Application` add `nightRunId String?` (→ NightRun, `onDelete: SetNull`, index), `rejectedAt DateTime?`, `rejectReason String?`; `ApplicationStatus` + `rejected`; `RunEvent` add `seq Int @default(autoincrement()) @unique`, `nightRunId String?` (→ NightRun, `onDelete: Cascade`), index `(nightRunId, seq)`; `AnswerMemory` add `enabled Boolean @default(true)`, `lastUsedAt DateTime?`, `origin String @default("needs_input")`
- [X] T003 Migration `night_runs` via `prisma migrate diff --from-schema <old> --to-schema <new>` (enum adds `IF NOT EXISTS`), apply with `prisma migrate deploy` (dev) + `make test-db`; `resetAll`/`resetJobs` test helpers truncate `"NightRun"`; remove `scheduleCron` from `Preferences` (`packages/shared/src/jobs.ts`), `loadPreferences` and any web usage
- [X] T004 [P] `packages/shared/src/night.ts` (export from index): `HHMM` regex `^([01]\d|2[0-3]):[0-5]\d$`; `NightSettingsBody { enabled?, start?, end?, days?: int 0–6 [] min 1 unique, budget?: int 1–40 }` (refine start ≠ end); `NightSettings` (+ `next: { start, end } | null`, `paused`); `NightCounters` (`found, aboveThreshold, prepared, ready, needsInput, failed, submitted, uncertain, waitingLimit, windowEnd`, ints default 0); `NightAlert { kind: 'session_expired'|'platform_paused'|'stopped'|'failed'|'missed'|'nothing_new'|'partial', message }`; `NightReport { alerts, counters, top: { title, company, score }[] ≤ 5, link }`; `NightRunListItem`, `NightRunView` (+ `stepErrors`, `pending`, `report`, `reportStatus`, `reportError`); `RunEventView { seq, at, level, step?, message, applicationId? }`; `ReviewGroup` (`ready, needs_input, failed, submit_uncertain, waiting_limit, approved`), `ReviewItem { applicationId, jobId, title, company, score, platform, status, group, runId?, lowConfidence, needsQuestions: string[], updatedAt }`, `ReviewQueue { groups, counts, run? }`, `RejectBody { reason: 1–300 }`, `EstimateBody { ids 1–50 }`, `SendEstimate { perPlatform: { kind, count, remainingToday, days, minutes }[] }`; `MemoryView { id, question, answer, fieldType, origin, enabled, usedCount, lastUsedAt, updatedAt, conflict?: string }`, `MemoryPatchBody { answer?: 1–2000, enabled? }`; `ControlState { paused, pausedAt, running: NightRunListItem | null, next }`; payloads `NightTickPayload {}`, `StartManualPayload { nightRunId }`, `ReportPayload { nightRunId }`; `ApplicationStatus` + `rejected`, `NeedsReasonCode` + `window_end`
- [X] T005 [P] `packages/jobs/src/night.ts` (pure, export from index): `parseHHMM`, `localParts(date, tz='America/Sao_Paulo')` via `Intl.DateTimeFormat`, `nightWindow(now, { start, end, days })` → `{ inside: boolean, current?: { start: Date, end: Date, nightDate }, last?: {…}, next: {…} }` (end ≤ start crosses midnight and belongs to the start day; `days` checked on the start day); `missedNight({ lastTickAt, now, settings, enabledSince })` → previous window if it ended with no tick inside it; `remainingBudget(budget, preparedThisNight)`; `buildReport({ counters, alerts, top, link })` + `formatReport(report)` → plain text pt-BR (alerts first, counts, top 5 "Título — Empresa (score)", link); `sendEstimate(items: {kind}[], platforms: { kind, remainingToday, minIntervalSec, submitCap }[])`; tests `packages/jobs/test/night.test.ts` (window 23:00–06:59 at 22:59/23:00/02:00/06:59/07:00, same-day window, days filter, missed detection, report formatting, estimate)
- [X] T006 [P] `packages/db/src/night.ts` (export from index): `prepareApplication(db, jobId, { nightRunId? })` (move the upsert logic out of `ApplyService.apply`: errors `not_found`, `no_apply_url`, `already_running`, `already_submitted`, also refuse `rejected`; reset approval; returns the application) as typed errors `PrepareError { code }`; `selectNightJobs(db, { threshold, take })` per research R4 (no application, or `skipped` whose `needsReasons` has code `window_end`; exclude hidden/rejected/submitted/uncertain/already_applied/ready/needs_input/approved); `nightCounters(db, run)` (found = jobs created during the linked discovery run, aboveThreshold, application statuses by `nightRunId`, submitted = `submittedAt` between start and end, waitingLimit = approved with gate reason, windowEnd); `nightRunEvent(db, runId, level, step, message, data?)`; update `ApplyService.apply` (`apps/api/src/apply/apply.service.ts`) to use `prepareApplication` (map `PrepareError` → `ApiError`); tests `apps/worker/test/night-db.test.ts`

**Checkpoint**: schema, contracts, pure helpers and shared DB helpers green; F4/F5 suites still green.

---

## Phase 3: User Story 1 — Scheduled overnight run (P1) 🎯 MVP

**Goal**: one run per night window: discovery → preparation within budget → wait → finish with counters and pending.

**Independent Test**: fake clock + fixture jobs: a tick at 23:00 creates exactly one run; preparation queues ≤ budget apply jobs; when they settle and the window ends the run finishes `ok` with counters, zero submissions.

- [X] T007 [US1] `apps/worker/src/night/tick.ts`: `tick(deps: { db, now, startDiscovery: () => Promise<{ runId }>, enqueueApply: (applicationId, attempt) => Promise<void>, removeApplyJobs: (applicationIds) => Promise<string[]>, enqueueReport: (nightRunId) => Promise<void> })` per research R1/R3: update `nightLastTickAt`; record `missed` run for a missed previous night (unique `scheduleKey`); paused → if inside an un-run window record `skipped` once, return; no running run and inside enabled window → create run (catch unique violation → no-op; a running manual run absorbs the night by setting its `scheduleKey`), reuse a running F2 `DiscoveryRun` of today if any else `startDiscovery`; phase `discovering` → wait `DiscoveryRun.status` (`failed` → stepError, continue); `preparing` → `selectNightJobs(take = remainingBudget)` → `prepareApplication(…, { nightRunId })` + `enqueueApply` (errors → stepError per job), then wait until no app of the run is `queued|tailoring|applying`; `waiting` → until `windowEnd` (manual: immediately); window end in any phase → `removeApplyJobs` for the run's queued apps → status `skipped` + reason `window_end`, record `pending`; `finishing` → `nightCounters`, status `ok|partial|failed`, `finishedAt`, phase `done`, `enqueueReport`; every transition writes `nightRunEvent`; never touches approvals or submit jobs
- [X] T008 [US1] `apps/worker/src/processors/night.processor.ts` (queue `night`, concurrency 1): `night-tick` → `tick` with real deps (`startDiscoveryFlow(db, flows, 'schedule')`, apply queue with `APPLY_JOB_OPTS` and `jobId apply-<id>-<attempt>`, remove waiting/delayed `apply` jobs by `applicationId`), `start-manual` → start discovery for that run; on module init `upsertJobScheduler('night-tick', { pattern: '* * * * *', tz: 'America/Sao_Paulo' })`; register in `apps/worker/src/worker.module.ts`
- [X] T009 [US1] API `apps/api/src/night/` (module, controller, service; register in `app.module.ts`): `GET/PUT /night/settings` (`422 invalid_window`; `next` from `nightWindow`), `POST /night/runs` (manual: `409 already_running`, `409 paused`; creates run `trigger manual`, `windowEnd null`, enqueues `start-manual`), `GET /night/runs`, `GET /night/runs/:id`
- [X] T010 [US1] Tests `apps/worker/test/night-tick.test.ts` (fake clock, fake enqueuers, fixture jobs + scores): one run per night (two ticks + restart), disabled → nothing, day not in `nightDays` → nothing, budget respected (25 eligible, budget 20 → 20 apps), rejected/submitted/ready jobs never selected, `window_end` leftovers selected next night, discovery failed → `partial` but preparation still runs on existing jobs, window end with queued apps → removed + `skipped window_end` + pending recorded, missed night recorded once, manual run absorbs scheduled night; asserts no `submit` enqueued and no application reaches `approved`; `apps/api/test/night.test.ts` (settings validation, manual run 409s)
- [X] T011 [US1] Web `apps/web/src/app/noite/page.tsx` + `apps/web/src/components/night/night-settings.tsx`, `night-runs.tsx`: toggle "Execução noturna", start/end time inputs, days chips, budget (1–40), "Próxima execução: …", "Rodar agora", runs list (date, trigger, status pt-BR: Em andamento / Concluída / Parcial / Falhou / Parada / Pulada / Perdida, counters); nav link "Noite" (`<Suspense>` around client hooks)

**Checkpoint**: US1 works unattended on fixtures.

---

## Phase 4: User Story 3 — Kill switch across the whole night (P1)

**Goal**: one global stop that cancels everything and pauses scheduling until resume, also from the phone.

**Independent Test**: during a fixture run, stop → run `stopped`, no waiting/delayed jobs in discover/tailor/apply, approvals cleared, next tick inside the window does nothing until resume.

- [X] T012 [US3] `packages/db/src/night.ts` `stopEverything(db, { removeJobs: () => Promise<number> })`: set `pausedAt`, running `NightRun` → `stopped` (+ `finishedAt`, report enqueue still happens via caller), F5 cancellation (queued/tailoring/applying → `skipped` `cancelled`; approved → `ready` without approval), `nightRunEvent`; `resumeEverything(db)` clears `pausedAt` only
- [X] T013 [US3] API `apps/api/src/control/` (module, controller, service): `GET /control` (`ControlState`), `POST /control/stop` (removes waiting/delayed/prioritized jobs in `discover`, `discover-jobspy`, `tailor`, `apply`; calls `stopEverything`; enqueues the stopped run's report), `POST /control/resume`; `POST /apply/stop` delegates to it (`apps/api/src/apply/apply.controller.ts`)
- [X] T014 [US3] Tick and processors honour the pause: `tick` returns early when `pausedAt` (T007 covers skipped record); `apply`/`submit` jobs that still start after a stop see `skipped`/`ready` and no-op (existing); `ScoreProcessor.start-run` skips when paused (`apps/worker/src/processors/score.processor.ts`)
- [X] T015 [US3] Tests `apps/api/test/control.test.ts` + `apps/worker/test/night-tick.test.ts` additions: stop during `preparing` → run `stopped`, queues empty, approvals cleared, tick inside window afterwards → no new run, resume → next window starts a run but stopped items stay `skipped`
- [X] T016 [US3] Web `apps/web/src/components/control/control-bar.tsx` in the root layout header: "Parar tudo" (confirm dialog) / "Pausado desde HH:MM — Retomar" badge, running run indicator linking to `/noite`; polls `GET /control` every 10 s; replace the F5 `StopBar` in `applications-list.tsx` with it

**Checkpoint**: unattended runs are safe to stop.

---

## Phase 5: User Story 2 — Morning review queue with batch approve (P1)

**Goal**: one grouped queue; batch approve with estimate; reject; inline answers.

**Independent Test**: after a fixture run, groups/counts match; batch approve 3 → exactly 3 `submit` jobs; reject 1 → never selected again.

- [X] T017 [US2] API `apps/api/src/review/` (module, controller, service): `GET /review?run=` (groups per data-model; `waiting_limit` = approved with gate reason; ordered by score desc; counts; low-confidence count = answers with confidence < `applyConfidence`; pending questions of needs_input), `POST /review/estimate` (`sendEstimate` with `platformUsage` + caps), `POST /applications/:id/reject` (`409 not_rejectable` for approved/submitting/submitted/submit_uncertain; sets `rejected`, `rejectedAt`, `rejectReason`), `POST /applications/:id/unreject` (→ `prepareApplication` + enqueue)
- [X] T018 [US2] `POST /applications/:id/answers` on a `ready` application accepts edits of any non-file answer (`apps/api/src/apply/apply.service.ts`): edited answers source `usuário`, memory written with `origin: 'edit'` (needs-input answers `origin: 'needs_input'`, review inline `origin: 'inline'` via body flag `from: 'review'`), approval cleared, re-prepare (`rerun`)
- [X] T019 [US2] Tests `apps/api/test/review.test.ts`: groups/counts/order from seeded applications, estimate math, reject/unreject, reject refused for submitted, rejected job excluded by `selectNightJobs`, edit on ready → re-queued + memory `edit`, batch approve 3 → 3 submit jobs (F5 approveBatch), dry_run mode → approve refused
- [X] T020 [US2] Web `apps/web/src/app/revisao/page.tsx` + `apps/web/src/components/review/*`: run selector (default last run), group tabs with counts (Prontas, Precisam de resposta, Falharam, Envio incerto, Aguardando limite, Aprovadas), item rows (title, company, score, platform, low-confidence badge, link to `/vagas/[id]/candidatura`), checkbox selection + "Selecionar todas", "Aprovar selecionadas" → confirm dialog with count and per-platform estimate ("Gupy: 3 hoje", "LinkedIn: 2 em 2 dias"), "Rejeitar" with reason input, inline answer form for needs_input (reuse `needs-input-form.tsx`), approval disabled in Simulação with explanation; nav link "Revisão" with ready count

**Checkpoint**: the morning routine works end to end on fixtures.

---

## Phase 6: User Story 5 — Answer memory learning loop (P2)

**Goal**: user answers become memories; reuse counted; disable/delete; facts win.

**Independent Test**: answer on fixture form A → form B with paraphrased question is prepared from memory; disable → B asks again.

- [X] T021 [P] [US5] `packages/apply/src/memory.ts`: `MemoryCandidate.id?`; `memoryConflict(answer: { source, answer, fieldType }, candidates)` → message when a fact/rule/calculated answer and a matching memory (same normalized meaning/compatible type) disagree; `planAnswers` attaches finding `memory_conflict` to the answer (no change to which answer wins); tests in `packages/apply/test/memory.test.ts`
- [X] T022 [US5] `apps/worker/src/apply/memory.ts`: exact and vector lookups filter `approved AND enabled` (`similarAnswers` in `packages/db/src/vector.ts` too), return ids; after a run, increment `usedCount` and set `lastUsedAt` for memories whose answers were used (`apps/worker/src/apply/run.ts`)
- [X] T023 [US5] API `apps/api/src/memories/` (module, controller, service): `GET /memories?q=&enabled=` (search on question/answer, `conflict` from the latest answer finding), `PATCH /memories/:id` (answer change → embedding NULL; `enabled`), `DELETE /memories/:id`
- [X] T024 [US5] Tests: `apps/worker/test/apply-memory.test.ts` (fixture forms A/B: memory reuse with source `memória` + usedCount 1; disabled → B needs_input; fact-backed field + conflicting memory → fact answer + `memory_conflict` finding; AI-only answers never create memories) and `apps/api/test/memories.test.ts`
- [X] T025 [US5] Web `apps/web/src/app/memoria/page.tsx` + `apps/web/src/components/memory/memories-view.tsx`: search, table (pergunta, resposta, tipo, origem: Pendência / Revisão / Edição, usos, último uso, ativa toggle), inline edit, delete with confirm, conflict badge "diverge do fato"; nav link "Memória"

---

## Phase 7: User Story 4 — Morning report on the phone (P2)

**Goal**: one report per run in the UI and on Telegram (no PII); `parar`/`retomar`/`status` from the configured chat only.

**Independent Test**: fake `fetch`: a finished run → exactly one sendMessage with matching counters and no persona PII; command from another chat ignored; `parar` from the configured chat pauses.

- [X] T026 [US4] `packages/jobs/src/telegram.ts` (transport + parse, shared with the api) and `apps/worker/src/night/commands.ts` (poll + actions): `telegramConfig()` (token + chat id or null), `sendMessage(cfg, text, fetchImpl)` (plain text, no `parse_mode`, error on `ok:false`), `getUpdates(cfg, offset, fetchImpl)` (`timeout: 25`), `parseCommand(update, chatId)` → `stop | resume | status | null` (`parar`, `/stop`, `retomar`, `/resume`, `status`, `/status`, case/accents-insensitive; other chats → null)
- [X] T027 [US4] `apps/worker/src/night/report.ts`: `buildNightReport(db, runId)` (alerts: expired sessions, paused platforms, stopped/failed/missed/partial, nothing new; counters from `nightCounters`; top 5 ready by score; link `${WEB_ORIGIN ?? 'http://localhost:3000'}/revisao?run=<id>`) → stores `NightRun.report`; `deliverReport(deps, runId, fetchImpl)` → `not_configured` | `sent` (+ `reportSentAt`) | throws (BullMQ retry) and on final attempt `not_sent` + `reportError`; skip if already `sent`
- [X] T028 [US4] `apps/worker/src/processors/notify.processor.ts` (queue `notify`, concurrency 1): `report` (jobId `report-<runId>`, attempts 5, exponential 60 s, final attempt detection like F4), `telegram-poll` (when configured: getUpdates from `telegramOffset`, advance offset for every update, run `stopEverything` / `resumeEverything` / reply status text; scheduler registered at boot only when configured); `POST /notify/test` in API (`apps/api/src/night/`) sends "AutoApply conectado" directly
- [X] T029 [US4] Tests `apps/worker/test/night-report.test.ts`: report counters match seeded run; message contains no persona e-mail/phone/salary/answers/file names (SC-006); exactly one send across two jobs with the same jobId and after a retry; not configured → `not_configured`; send failure on last attempt → `not_sent`, run status unchanged; commands from another chat ignored; `parar` → paused + running run `stopped`; `status` reply
- [X] T030 [US4] Web: report panel on `/noite` run detail (alerts, counters, top, "Relatório: enviado / não enviado (erro) / Telegram não configurado"), "Testar Telegram" button

---

## Phase 8: User Story 6 — Live log of the run (P3)

**Goal**: live, gap-free event stream per run.

**Independent Test**: during a fixture run the SSE stream delivers events in `seq` order; reconnect with `Last-Event-ID` resumes without duplicates; `end` sent when final.

- [X] T031 [US6] Worker writes events with `nightRunId` (tick via `nightRunEvent`) and apply/submit events keep `applicationId` (verify `apps/worker/src/apply/run.ts`/`submit.ts` events set it); API `GET /night/runs/:id/events` (`@Sse`, `apps/api/src/night/night.controller.ts`): read `Last-Event-ID` header or `?after=`, replay `seq > after` where `nightRunId = id OR application.nightRunId = id`, then poll every 1 s, emit `id: seq`, complete with `event: end` once the run is final and no newer events; `GET /night/runs/:id` also returns the last 200 events
- [X] T032 [US6] Tests `apps/api/test/night-events.test.ts`: replay order, `after` resume without duplicates, events from linked applications included, other runs excluded, `end` when final
- [X] T033 [US6] Web `apps/web/src/components/night/live-log.tsx` on `/noite` (current or selected run): `EventSource(API_URL + '/night/runs/:id/events')`, auto-reconnect (browser sends Last-Event-ID), dedupe by seq, auto-scroll, level colours, "Sem execução em andamento — próxima: …" when idle

---

## Phase 9: Polish & Cross-Cutting

- [X] T034 Approve message for autopilot updated ("autopilot não disponível; use o modo revisão") in `apps/api/src/apply/apply.service.ts`; preferences mode select keeps only Simulação/Revisão
- [X] T035 [P] Docs: `docs/architecture.md` (night state machine, queues `night`/`notify`, SSE, kill switch), `docs/roadmap.md` (F6 ✅, F7 next), `CLAUDE.md` (F6 gotchas: tick idempotency/scheduleKey, `seq` SSE, Telegram only configured chat, no PII in reports; status line)
- [X] T036 Run everything: `make test`, `make typecheck`, `make lint`, web build; quickstart steps 1–2 and 6 locally against fixtures/local form (manual run, live log, stop/resume); kill stray processes; `make graph`

---

## Dependencies & Execution Order

- Setup → Foundational (T002–T006) blocks all stories.
- US1 (T007–T011) → US3 (T012–T016; tick pause logic depends on T007) → US2 (T017–T020) → US5 (T021–T025; T018 writes memory origins) → US4 (T026–T030; uses `stopEverything` from T012) → US6 (T031–T033) → Polish.
- Within stories: worker/API before tests, tests before web.

### Parallel Opportunities

- T004, T005, T006 in parallel after T003.
- T021 parallel with T017–T020 (different package).
- T026 parallel with T023–T025.
- Web tasks (T011, T016, T020, T025, T030, T033) can be batched to one web pass after their APIs.

## Implementation Strategy

MVP = Foundational + US1 + US3 (an unattended, stoppable night that prepares applications). Then US2
(morning approval), US5 (fewer questions), US4 (phone report), US6 (live view). Each checkpoint keeps
F1–F5 suites green.
