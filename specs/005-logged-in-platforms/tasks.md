---
description: "Task list for F5 Logged-in Platforms and Assisted Real Submission"
---

# Tasks: Logged-in Platforms and Assisted Real Submission

**Input**: Design documents from `/specs/005-logged-in-platforms/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — FR-016 and constitution §VI. Integration tests on `autoapply_test`; browser tests
with real headless Chromium on synthetic/local fixtures; the submit path is tested ONLY against a local
recording test form. Never a real platform.

**Order**: Foundational (schema, contracts, crypto, platform rules) → US1 (connect) → US2 (prepare on
Gupy/LinkedIn) → US3 (approve + submit) → US5 (caps/pause, needed by US3 at scale) → US4 (assisted) →
Polish.

## Format: `[ID] [P?] [Story] Description` — ESM relative imports end in `.js`.

---

## Phase 1: Setup

- [X] T001 Verify `SESSION_ENCRYPTION_KEY` handling: `.env.example` documents "64 hex chars (openssl rand -hex 32)"; `make setup` already generates it; add a startup warning in `apps/worker/src/main.ts` when it is missing or not 64 hex chars (sessions disabled, never plaintext)

---

## Phase 2: Foundational

- [X] T002 Update `packages/db/prisma/schema.prisma` per data-model.md: new `Platform` (`kind String @id`, `sessionEnc String?`, `sessionStatus String @default("disconnected")`, `accountLabel String?`, `connectedAt DateTime?`, `lastTestAt DateTime?`, `lastTestOk Boolean?`, `connectRequest String?`, `optInAt DateTime?`, `submitCap Int`, `simulateCap Int`, `submitMax Int`, `minIntervalSec Int`, `lastActionAt DateTime?`, `pausedUntil DateTime?`, `pauseReason String?`, `backoffLevel Int @default(0)`, `consecutiveErrors Int @default(0)`, `updatedAt @updatedAt`); `Application` add `platform String?`, `approvedAt DateTime?`, `approvalHash String?`, `submittedVia String?`, `sentValues Json?`, `submitError String?`; `ApplicationStatus` add `approved, submitting, submit_uncertain, already_applied`; remove `SearchPreference.applyDailyCap`
- [X] T003 `make migration name=platforms_submit`; `make test-db`; `resetJobs` also truncates `"Platform"`; remove `applyDailyCap` from `Preferences` (`packages/shared/src/jobs.ts`), `loadPreferences`, and the web preferences form field (`apps/web/src/components/jobs/preferences.tsx`)
- [X] T004 [P] `packages/shared/src/platforms.ts`: `PlatformKind` (`gupy, linkedin, greenhouse, lever, ashby, generic`), `SESSION_PLATFORMS = ['gupy','linkedin']`, `PlatformView { kind, sessionStatus, accountLabel, connectedAt, lastTestAt, lastTestOk, optInAt, submitCap, simulateCap, submitMax, minIntervalSec, usage: { submitted, simulated }, paused: { until, reason } | null, needsOptIn }`, `PlatformLimitsBody { submitCap?: int ≥ 0, simulateCap?: int ≥ 0, minIntervalSec?: int ≥ 10 }`, `OptInBody { confirm: literal "Entendo e quero usar" }`, `ApproveBatchBody { ids: string[] 1–50 }`, `MarkBody { sent: boolean }`, `SubmitPayload { applicationId, approvalHash }`, `SessionJobPayload { kind: 'gupy'|'linkedin' }`; extend `packages/shared/src/apply.ts`: `AtsKind` + `gupy, linkedin`; `ApplicationStatus` + `approved, submitting, submit_uncertain, already_applied`; `NeedsReasonCode` + `session_expired, already_applied, platform_action, unusual_activity, form_changed, new_step, human_check, platform_paused`; `ApplicationView` + `platform, approvedAt, submittedAt, submittedVia, sentValues`; export from index
- [X] T005 [P] `packages/apply/src/platform.ts` (pure): `PLATFORM_DEFAULTS` (research R1 table), `platformOf(ats)`, `gateDecision({ platform, usage, now, action: 'simulate'|'submit' })` → `{ ok } | { delayMs, reason: 'daily_cap'|'interval'|'platform_paused' }` (pause → until pausedUntil or manual = no auto-resume; cap → 00:05 next local day; interval → remainder), `nextBackoff(level, kind: 'errors'|'unusual_activity')` → `{ level, pausedUntil, reason }` (1 h, 4 h, then manual), `approvalHash({ formUrl, answers: {fieldKey, answer}[], docs: {id, updatedAt}[] })`; tests `packages/apply/test/platform.test.ts`
- [X] T006 [P] `packages/apply/src/confirm.ts` (pure): `isSubmittedConfirmation(text, url)` (pt/en: "candidatura enviada", "recebemos sua candidatura", "application submitted", "thank you for applying", "your application was sent", "sua candidatura foi enviada", URL `/confirmation|/thank|/sucesso|applied`), `isAlreadyApplied(text)` ("você já se candidatou", "já se inscreveu", "applied 2 days ago", "you applied"), `isUnusualActivity(text, status)` ("atividade incomum", "unusual activity", "muitas tentativas", "too many requests", HTTP 429/999), `isPlatformActionPage(text)` (terms update / verify phone / confirm e-mail); add `unusual_activity`/`platform_action` to `detectBlockers` in `packages/apply/src/blockers.ts`; tests `packages/apply/test/confirm.test.ts`
- [X] T007 [P] `apps/worker/src/apply/session-crypto.ts`: `encryptSession(state: object, keyHex)` → `v1:<iv>:<tag>:<data>` (AES-256-GCM, random 12-byte IV), `decryptSession(enc, keyHex)` → object or throws `SessionKeyError`; `sessionKey()` reads `SESSION_ENCRYPTION_KEY` (must be 64 hex) else null; tests `apps/worker/test/session-crypto.test.ts` (round trip, wrong key, tampered tag, missing key)
- [X] T008 `apps/worker/src/apply/gate.ts`: `ensurePlatform(db, kind)` (upsert with `PLATFORM_DEFAULTS`), `platformUsage(db, kind, now)` (simulations = applications with `platform=kind` and `lastRunAt ≥ local midnight`; submissions = `submittedAt ≥ midnight` or status `submitting`), `platformGate(db, kind, action, now)` → decision + sets `lastActionAt` when ok, `recordPlatformError(db, kind, kind2)` / `recordPlatformOk(db, kind)`; replace F4 `dailyCapDelay` usage in `apps/worker/src/apply/run.ts` and `apps/worker/src/processors/apply.processor.ts` with `platformGate(..., 'simulate')` (keep the old export as a thin wrapper for its tests or update `apps/worker/test/apply-generic.test.ts` cap test to the new gate)

**Checkpoint**: schema, contracts, crypto and gates green.

---

## Phase 3: User Story 1 — Connect a platform account (P1)

**Goal**: manual login in a visible window → encrypted session; test; disconnect; LinkedIn opt-in.

**Independent Test**: fake login page sets an auth cookie → session saved encrypted, status `connected`; test → valid; disconnect → deleted, pending apps `session_expired`.

- [X] T009 [US1] `apps/worker/src/apply/sessions.ts`: `LOGIN = { gupy: { url: 'https://login.gupy.io/candidates/signin', loggedIn: (cookies, url) => … }, linkedin: { url: 'https://www.linkedin.com/login', loggedIn: cookie 'li_at' } }`; `connectSession(deps, kind, { launch: headed browser factory, pollMs = 2000, timeoutMs = 600_000 })`: sets `sessionStatus='connecting'`, opens a headed window on the login URL, NEVER fills/clicks, polls logged-in signal | `Platform.connectRequest` (`done`/`cancel`) | page closed | timeout; on success `storageState()` → `encryptSession` → `Platform` (`connected`, `connectedAt`, `accountLabel` from page title/profile name if visible); else back to previous status; `loadStorageState(db, kind)` (decrypt or null + mark `expired` on key error); `testSession(deps, kind)` via `openDryRunContext(..., { storageState })` on a logged-in URL (Gupy applications page, LinkedIn feed) → login wall / 2FA prompt = expired; RunEvents
- [X] T010 [US1] `openDryRunContext` accepts `storageState` (`apps/worker/src/apply/browser.ts`); processor handles job names `connect-session` / `test-session` (`apps/worker/src/processors/apply.processor.ts`) with a headed launcher for connect
- [X] T011 [US1] API `apps/api/src/platforms/` (module, controller, service; register in `app.module.ts`): `GET /platforms` (ensures all kinds, usage, pause), `POST /platforms/linkedin/opt-in`, `POST /platforms/:kind/connect` (`400` non-session kinds, `409 opt_in_required`, enqueue), `POST /platforms/:kind/connect/done`, `POST /platforms/:kind/test`, `DELETE /platforms/:kind/session` (clears session, apps of that platform in `queued|ready|approved` → `needs_input` `session_expired`), `PUT /platforms/:kind/limits` (`422 above_max`), `POST /platforms/:kind/resume`
- [X] T012 [US1] Tests: `apps/worker/test/sessions.test.ts` (fake login page via `serve` sets `li_at` cookie after a timeout → connected + encrypted (no plaintext cookie value in `sessionEnc`); `connectRequest=cancel` → disconnected; test-session valid/expired with fixture pages; the login form is never filled — assert input values stay empty) and `apps/api/test/platforms.test.ts` (opt-in text, connect 409/400, limits 422, disconnect effects)
- [X] T013 [US1] Web `apps/web/src/app/plataformas/page.tsx` + `apps/web/src/components/platforms/platforms-view.tsx`: card per platform (status pt-BR, account, connected/test times, "Conectar" → shows "Uma janela vai abrir: entre na sua conta lá e clique em Concluí aqui" + "Concluí"/"Cancelar", "Testar sessão", "Desconectar"), LinkedIn ToS warning dialog requiring the exact confirmation text; caps editor (submit/simulate/interval with max), today's usage, pause banner + "Retomar"; nav link "Plataformas"; polling while `connecting`

---

## Phase 4: User Story 2 — Prepare on Gupy and LinkedIn Easy Apply (P1)

**Goal**: F4 engine with session + Gupy/LinkedIn adapters; specific reasons.

**Independent Test**: synthetic Gupy flow and LinkedIn Easy Apply modal → standard fields filled, resume attached, screenshot per step, nothing submitted; already applied / expired / external link handled.

- [X] T014 [P] [US2] `packages/apply/src/detect.ts`: `gupy` (host `*.gupy.io` excluding `login.gupy.io`/`portal.gupy.io`; `jobId` from `/jobs/<id>`), `linkedin` (`linkedin.com/jobs/view/<id>` or `currentJobId=<id>`); tests in `packages/apply/test/detect.test.ts`
- [X] T015 [P] [US2] Synthetic fixtures `apps/worker/test/fixtures/apply/gupy-flow/` (job page with "Candidatar-se" link → step 1 "Dados pessoais" prefilled from Gupy profile, step 2 "Currículo" file, step 3 "Perguntas" screening incl. yes/no + select + textarea, final "Enviar candidatura"; steps advance client-side) and `linkedin-easy-apply/` (job page with Easy Apply button opening modal: contact step with email select + phone, resume step with upload, questions step, review step with "Enviar candidatura" and a pre-checked "Seguir empresa"); plus `linkedin-external/` (job page whose apply button links to a Greenhouse URL served from the F4 fixture) and `gupy-already-applied/`, `gupy-login-redirect/`; README noting they are synthetic and how to re-record real ones (`snapshot-form.ts --session`)
- [X] T016 [US2] `apps/worker/src/apply/adapters/gupy.ts`: locate (job page → follow "Candidatar-se"/"Quero me candidatar" link or button that navigates; login host → `session_expired`), already applied → `already_applied`, steps via F4 extractor + `nextStep`, follow-up tests ("teste online", "vídeo") noted in report; register in `adapters/index.ts`
- [X] T017 [US2] `apps/worker/src/apply/adapters/linkedin.ts`: locate job; Easy Apply button (pt/en) → modal frame/root; no Easy Apply → external link → `detectAts(href)` → F4 adapter on that URL; steps "Avançar/Next/Revisar/Review" (never "Enviar candidatura/Submit application"); uncheck "Seguir/Follow" company; login wall → `session_expired`; unusual activity → blocker
- [X] T018 [US2] `apps/worker/src/apply/run.ts`: load session for `gupy`/`linkedin` (`loadStorageState`; missing/expired → `needs_input` `session_expired` before opening), pass `storageState` to the dry-run context, set `Application.platform`, map `already_applied` → status `already_applied`, `unusual_activity` → `recordPlatformError(..., 'unusual_activity')`, record ok/errors for backoff; `snapshot-form.ts` gains `--session <kind>` (loads the encrypted session, saves under `data/fixtures/<name>/`)
- [X] T019 [US2] Tests `apps/worker/test/apply-platforms.test.ts`: Gupy flow (3 steps, screenshots before/step-1/step-2/after, standard fields, resume attached, `submitAttempts=0`, status ready/needs_input), LinkedIn Easy Apply (modal steps, follow-company unchecked, final submit never clicked), LinkedIn external → Greenhouse engine, already applied → `already_applied`, expired (no session) → `session_expired`, login redirect → `session_expired`

---

## Phase 5: User Story 3 — Review, approve and submit (P1)

**Goal**: approval in review mode; separate submit path; once only; changed form blocks.

**Independent Test**: local recording test form — approve → exactly one POST with the approved values, confirmation screenshot, `submitted`; changed form → `form_changed`; second run no-op; kill switch → not sent; no confirmation → `submit_uncertain`.

- [X] T020 [US3] API approval in `apps/api/src/apply/apply.service.ts` + controller: `POST /applications/:id/approve` (status `ready`, `SearchPreference.mode === 'review'` else `409 dry_run_mode`, not outdated else `409 outdated`, session platform connected else `409 platform_not_connected`; store `approvedAt` + `approvalHash` (T005), status `approved`, enqueue `submit` with `attempts: 1`, `jobId submit-<id>-<attempt>`), `POST /applications/approve` batch, `POST /applications/:id/mark` (only from `submit_uncertain`), re-simulation clears approval, `stop()` also removes `submit` jobs and resets `approved` → `ready` (reason `cancelled`)
- [X] T021 [US3] `apps/worker/src/apply/submit.ts`: `openSubmitContext(browser, { storageState, serve? })` (no guard/trap, `serviceWorkers: 'block'`); `runSubmit(deps, payload)`: exit if status ∈ `submitting|submitted|submit_uncertain` or not `approved`; recompute approvalHash (mismatch → `needs_input` `form_changed`); `platformGate(..., 'submit')` (delay → re-add job delayed, status stays `approved`); open via adapter; per step extract → verify vs stored `FormAnswer`s of that step (missing key, different options, new required field without approved answer → `needs_input` with `form_changed`/`new_step` listing fields, nothing clicked); fill stored values exactly (`fillField`/`attachFile`; PDFs re-rendered from the same tailored docs, `updatedAt` must match); `submit-filled` screenshot; detect captcha/human check → `runAssisted` (US4) else compare-and-set `approved → submitting` (0 rows → abort) → click adapter submit control once → wait ≤ 30 s for `isSubmittedConfirmation` → `submitted` (`submittedAt`, `submittedVia: 'auto'`, `sentValues`, `confirmation` screenshot) or `submit_uncertain`; errors before click → `needs_input`/retryable never re-clicking; RunEvents per step; `recordPlatformOk/Error`
- [X] T022 [US3] Adapters expose `submitControl(frame)` (Greenhouse/Lever/Ashby/generic/Gupy/LinkedIn final submit buttons: "Submit application", "Enviar candidatura", "Enviar", "Apply"), used ONLY by `submit.ts`; processor job name `submit` → `runSubmit` (`apps/worker/src/processors/apply.processor.ts`)
- [X] T023 [US3] Local recording test form `apps/worker/test/fixtures/submit/form.html` (+ multi-step variant) served by `serve` at `https://test-ats.local.example/...`: POST handler records bodies and returns a confirmation page; tests `apps/worker/test/submit.test.ts`: approved → 1 POST with exactly the approved values, `submitted` + screenshots `submit-filled`/`confirmation` + `sentValues`; hash mismatch → `form_changed`, 0 POST; page with an extra required field → `new_step`, 0 POST; status flipped to `ready` (kill switch) before compare-and-set → 0 POST; confirmation missing → `submit_uncertain`, and running the job again → 0 additional POST; dry-run guard still blocks in `runApply` (regression)
- [X] T024 [US3] Tests `apps/api/test/apply.test.ts`: approve rules (dry_run mode 409, outdated 409, not ready 409, platform not connected 409), batch approve partial refusals, mark from uncertain only, stop clears approvals and removes submit jobs
- [X] T025 [US3] Web: in `apps/web/src/components/apply/application-view.tsx` "Aprovar e enviar" (confirm dialog listing job, platform and "esta candidatura será enviada de verdade"), disabled with explanation in dry-run mode or when outdated; statuses pt-BR (`approved` "Aprovada — enviando", `submitting` "Enviando", `submitted` "Enviada" / "Enviada (assistida)", `submit_uncertain` "Envio incerto", `already_applied` "Já candidatado"); sent values + confirmation screenshot; "Marcar como enviada / não enviada" for uncertain; `apps/web/src/components/apply/applications-list.tsx`: "Pronto" tab with checkboxes + "Aprovar selecionadas" (confirm dialog), tabs for Enviadas / Envio incerto; new reason chips

---

## Phase 6: User Story 5 — Caps, pacing, backoff (P2)

**Goal**: per-platform limits enforced for simulate and submit; pause on errors/unusual activity.

**Independent Test**: cap 2 → 2 submitted today, rest delayed; 2 errors → paused 1 h; unusual activity → manual pause until resume.

- [X] T026 [US5] Tests `apps/worker/test/platform-gate.test.ts` (DB): cap per action, interval remainder, pause until, backoff progression 1 h → 4 h → manual, unusual activity → manual, resume clears; `apps/api/test/platforms.test.ts` limits above max → 422, usage numbers in `GET /platforms`
- [X] T027 [US5] Processor: delayed re-add for `apply`/`submit` when gated (status kept, reason `daily_cap`/`platform_paused` shown), `GET /platforms` `nextRunAt` = earliest delayed job per platform (from BullMQ delayed jobs) in `apps/api/src/platforms/platforms.service.ts`

---

## Phase 7: User Story 4 — Assisted submit (P2)

**Goal**: captcha/human check at submit → visible window, user completes and submits.

**Independent Test**: local form with a "human check" widget → assisted run waits; test acts as the user (clicks submit) → `submitted` via `assisted`; closing → `needs_input` `human_check`.

- [X] T028 [US4] `runAssisted` in `apps/worker/src/apply/submit.ts`: headed launcher (tests: headless with a "user" callback), fill as in `runSubmit`, inject banner overlay, status `submitting` (compare-and-set) with `submittedVia: 'assisted'` pending, never click submit or captcha, wait ≤ 15 min for confirmation / page close / timeout → `submitted` (assisted) or back to `needs_input` (`human_check`, approval kept, status reset from `submitting` to `approved`→`needs_input`)
- [X] T029 [US4] Tests in `apps/worker/test/submit.test.ts`: assisted success (user callback clicks submit → 1 POST, `submittedVia: 'assisted'`), user closes → `human_check`, 0 POST; the system itself never clicks the submit control in assisted mode (spy)

---

## Phase 8: Polish & Cross-Cutting

- [X] T030 [P] Docs: `docs/architecture.md` (platforms, sessions, submit path, assisted, gates), `CLAUDE.md` (gotchas: submit only via `submit.ts`; sessions encrypted; never log in for the user; fixtures synthetic), `docs/roadmap.md` (F5 status), `.env.example` note
- [X] T031 Run `make test`, `make typecheck`, `make lint`, web build; offline end-to-end of approve → submit against the local test form via API + worker; `make graph`. Real submissions are left to the user (quickstart steps 2–5).

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T002 → T003; T004–T007 [P]; T008 after T005) → US1 → US2 → US3 → US5 → US4 → Polish.
- US3 depends on US2 adapters (submit controls) and Phase 2 gates; US4 depends on US3 `runSubmit`.

## Parallel Examples

- Phase 2: T004 shared ‖ T005 platform rules ‖ T006 confirmations ‖ T007 crypto.
- US2: T014 detection ‖ T015 fixtures.

## Implementation Strategy

1. MVP = Phases 1–5: connect, prepare on Gupy/LinkedIn, approve + submit (local test form proves it).
2. Add caps/backoff (US5) and assisted submit (US4).
3. The user performs SC-001..SC-003 with real accounts (the agent never logs in or submits for real).
