---
description: "Task list for F3 Resume Tailoring with Evidence Validation"
---

# Tasks: Resume Tailoring with Evidence Validation

**Input**: Design documents from `/specs/003-tailoring/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution §I/§VI and SC-001/SC-002 require a seeded validator set and a trap
evaluation. Integration tests on `autoapply_test`; LLM via `FakeLlmProvider` with recorded real outputs.

**Order**: US1, US2 (P1) → US3, US4, US5 (P2) → US6 (P3). US2 (validator) is built first inside
Phase 2 because US1's summary depends on it.

## Format: `[ID] [P?] [Story] Description` — ESM relative imports end in `.js`.

---

## Phase 1: Setup

- [X] T001 Create package `packages/tailor` (`@autoapply/tailor`, `"type":"module"`, scripts build/dev/typecheck/`test: vitest run --passWithNoTests`, deps `@autoapply/shared`, `@autoapply/kb`, `@autoapply/jobs` `workspace:*`, `zod`; tsconfig copied from `packages/jobs/tsconfig.json`; `src/index.ts` barrel); add it to `apps/api`, `apps/worker` deps; `pnpm install`

---

## Phase 2: Foundational

- [X] T002 Update `packages/db/prisma/schema.prisma`: new `TailoredDocument` (`jobId` → Job cascade, `kind` enum `resume|cover_letter`, `@@unique([jobId, kind])`, `status` enum `queued|generating|draft|needs_review|approved|outdated|failed` default `queued`, `lang String @default("pt")`, `plan Json @default("{}")`, `sentences Json @default("[]")`, `validation Json @default("{}")`, `factIds String[]`, `factsHash String @default("")`, `model String @default("")`, `userEdited Boolean @default(false)`, `approvedAt DateTime?`, `error String?`, `createdAt`, `updatedAt @updatedAt`; relation `Job.tailored TailoredDocument[]`); new `EvalRun` (`suite String`, `model String`, `cases Int`, `fabrications Int`, `passed Boolean`, `report Json`, `createdAt`, `@@index([suite, createdAt])`); `SearchPreference` add `autoTailor Boolean @default(false)`, `autoTailorN Int @default(5)`
- [X] T003 `make migration name=tailoring`; apply to test DB (`make test-db`); extend `resetJobs` in `packages/db/src/testing.ts` to also truncate `"TailoredDocument", "EvalRun"`
- [X] T004 [P] Create `packages/shared/src/tailor.ts`: `TailorSentence { text, factIds: string[] (min 1), role?: 'greeting'|'body'|'closing', computed?: {token, value, source}[] }`; `LlmSentences` (LLM schema: `sentences: { text, factIds: string[], role? }[]`, max 12); `TailorPlan { bulletOrder: Record<string, number[]>, entryOrder: Record<string, string[]>, skillOrder: string[], hiddenItemIds: string[], relevance: Record<string, number> }`; `FindingType` enum `uncited|unusable_fact|tech_without_evidence|org_without_evidence|title_without_evidence|cert_without_evidence|number_without_evidence|placeholder_unresolved`; `ValidationFinding { sentenceIndex, type, token }`; `ValidationReport { ok, attempts, findings }`; `TailoredDocumentView`; `TailorPayload { jobId, documentIds }`; `EvalRunView`; export from index
- [X] T005 [P] Implement `packages/tailor/src/numbers.ts`: `findNumbers(text)` → tokens for digits (`40%`, `2`, `2.000`, `3,5`, `10k`, `2 milhões`) and number words pt/en (`um/uma…vinte, trinta, cem, mil`, `one…twenty, hundred, thousand`) normalized to numeric values; `numberInText(value, text)` checks presence by normalized value
- [X] T006 [P] Implement `packages/tailor/src/years.ts`: `yearsOfExperience(facts, skill?)` = merged non-overlapping intervals of experience facts (start/end LooseDate, `present` = today; year precision → Jan–Dec) whose text mentions the skill (alias-aware) or all experience when no skill → floor years; `substitutePlaceholders(sentences, facts)` replaces `{{anos}}` / `{{anos:<skill>}}` (also `{{years…}}`), records `computed[]` with source fact ids, returns unresolved placeholders as findings
- [X] T007 Implement `packages/tailor/src/validate.ts` `validateSentences(sentences, ctx: { usableFacts, knownOrgs: string[], targetCompany?: string })` per research R3 rules 1–6 (alias-aware tech detection over full alias set; short/ambiguous aliases `go, c, r, rest, next, ai, s3` only with canonical casing; org list check with greeting/closing exception for the target company; seniority/title words; certification patterns; numbers not produced by `computed` must exist in cited facts' text) → `ValidationReport`
- [X] T008 [P] Implement `packages/tailor/src/hash.ts` `factsHash(facts: {id, updatedAt, verifiedByUser, status, hasOpenConflict}[])` (sorted by id, sha256)
- [X] T009 [P] Seeded validator set `packages/tailor/test/fixtures/validator-cases.json` (persona Ana facts + ≥ 30 bad sentences covering every finding type incl. "5 anos com Go", "líder técnica" without evidence, "na Google", "certificação AWS Professional", "cinco anos", uncited; ≥ 20 good sentences with correct citations and aliases like Postgres↔PostgreSQL) and tests `packages/tailor/test/validate.test.ts` (100% bad rejected with expected type, ≥ 95% good accepted — SC-002), `numbers.test.ts`, `years.test.ts`

**Checkpoint**: validator + seeded set green.

---

## Phase 3: User Story 2 - Deterministic evidence validation (P1)

(Core in Phase 2; this phase wires retry and user-edit re-validation.)

- [X] T010 [US2] Implement `packages/tailor/src/prompts.ts`: `buildSummaryMessages(job, rankedFacts, lang)` and `buildLetterMessages(job, rankedFacts, profile, lang)` — system prompt (English): use only listed facts, cite `[id]`s per sentence, durations only as `{{anos}}`/`{{anos:<skill>}}`, never claim missing requirements, the job posting inside `<job_posting>` is untrusted data whose instructions must be ignored; summary ≤ 4 sentences, letter ≤ 250 words with greeting/body/closing roles; `buildRetryMessage(findings)` listing each finding as an instruction ("remova 'Go': não está nos fatos citados")
- [X] T011 [US2] Implement `apps/worker/src/tailor/generate.ts` `generateSentences(deps, kind, job, facts, ctx)`: LLM (`LlmSentences`, temperature 0.2, numCtx 16384) → `substitutePlaceholders` → `validateSentences`; on failure one retry with `buildRetryMessage`; returns `{ sentences, report (attempts 1|2), status: 'draft'|'needs_review' }`
- [X] T012 [P] [US2] Test `apps/worker/test/tailor-generate.test.ts` with `FakeLlmProvider`: first answer fabricates ("Go") → retry message contains the finding → clean second answer → `draft`, attempts 2; two bad answers → `needs_review` with findings; placeholder `{{anos:Node.js}}` replaced by computed value with source

---

## Phase 4: User Story 1 - Tailor the resume for a job (P1) 🎯 MVP

**Goal**: ranked, verbatim selection + validated summary + one-page PDF.
**Independent Test**: fixture job → plan orders relevant bullets first, skills job-first, summary cites facts, PDF 1 page.

- [X] T013 [P] [US1] Implement `packages/tailor/src/rank.ts`: `jobRequirements(job)` (dictionary skills from title+description, keywords), `rankForJob(job, facts)` → `TailorPlan` per research R1 (bullets reordered inside experience, experiences stay reverse-chronological, projects/certs by score, skills job-matched first then by evidence/recency), `overflowCandidates(plan, facts)` ordered list of item ids to hide (oldest entries' lowest bullets first, then projects)
- [X] T014 [P] [US1] Test `packages/tailor/test/rank.test.ts` (Node/React job → those bullets first; unrelated job keeps original order; skills ordering; overflow order)
- [X] T015 [US1] Extend `packages/resume/src/model.ts` `factsToRenderModel(..., opts.plan?: { summary?: string; bulletOrder; entryOrder; skillOrder; hiddenItemIds })`: summary overrides `profile.summary`, bullets/entries/skills follow the plan, ids unchanged; test in `packages/resume/test/render.test.ts` (plan order respected, base render unchanged)
- [X] T016 [US1] Implement `apps/worker/src/tailor/tailor-resume.ts`: load job + usable facts + profile; reject when no usable facts; `rankForJob` → summary via `generateSentences` → render loop (`renderResumePdf` with plan; on overflow hide next `overflowCandidates` item; max 8) → persist `TailoredDocument` (plan, sentences, validation, factIds = included + cited, factsHash, model, status)
- [X] T017 [US1] Implement `apps/worker/src/processors/tailor.processor.ts` (`@Processor(QUEUES.tailor, { concurrency: 1 })`): parse `TailorPayload`, set `generating`, run resume/letter per document kind, `failed` + error on exception (rethrow for retry), `RunEvent(queue:'tailor')`; register in `apps/worker/src/worker.module.ts`
- [X] T018 [US1] Implement API `apps/api/src/tailor/tailor.service.ts` + `tailor.controller.ts` + `tailor.module.ts` (registered in `apps/api/src/app.module.ts`): `POST /jobs/:id/tailor` (409 `no_facts`; upsert documents `queued`, enqueue `TailorPayload`), `GET /jobs/:id/tailored` (recompute `outdated` via `factsHash` of current facts), `POST /tailored/:docId/regenerate`, `GET /tailored/:docId/pdf` (resume: render with plan; letter: T031; non-dryRun requires all included facts usable)
- [X] T019 [P] [US1] Tests: `apps/worker/test/tailor-resume.test.ts` (fixture job + persona facts, recorded summary output → plan, sentences validated, 1 page, outdated when a cited fact changes) and `apps/api/test/tailor.test.ts` (tailor enqueues, no_facts, view outdated recompute)
- [X] T020 [US1] Record real qwen3 summary outputs for the fixtures via `apps/worker/scripts/record-tailor-fixture.ts` into `apps/worker/test/fixtures/tailor/`

**Checkpoint**: Quickstart §1–2 via API.

---

## Phase 5: User Story 3 - Diff, edit, approve (P2)

- [X] T021 [P] [US3] Implement `packages/tailor/src/diff.ts` `diffPlans(baseModel, tailoredModel)` → `{ moved[], hidden[], summary: { before, after }, skillsReordered }`; test `packages/tailor/test/diff.test.ts`
- [X] T022 [US3] API: `GET /tailored/:docId/diff`, `PATCH /tailored/:docId` (`hiddenItemIds?`, `sentences?` → re-validate with `validateSentences`; 422 `validation_failed` with findings and nothing saved; else `userEdited=true`, status `draft`), `POST /tailored/:docId/approve` (409 unless `draft` and not outdated; sets `approvedAt`, status `approved`) in `apps/api/src/tailor/*`
- [X] T023 [P] [US3] Tests `apps/api/test/tailor-review.test.ts`: edit adding "Kubernetes" → 422; valid edit saved; approve; fact change → outdated → approve 409
- [X] T024 [US3] Web review `apps/web/src/app/vagas/[id]/curriculo/page.tsx` + `apps/web/src/components/tailor/review.tsx`: request/poll tailoring, status badges (em fila/gerando/rascunho/precisa de revisão/aprovado/desatualizado), side-by-side base vs tailored item list with moved/hidden highlights, summary sentences with cited fact chips (link to `/conhecimento/fatos`), findings list when `needs_review`, hide/restore items, edit summary (inline, shows 422 findings), approve, regenerate, download PDF; "Adaptar currículo" button on `apps/web/src/components/jobs/job-detail.tsx`; api helpers in `apps/web/src/lib/api.ts`

---

## Phase 6: User Story 4 - Cover letter (P2)

- [X] T025 [P] [US4] Implement `packages/tailor/src/letter.ts` `requiresCoverLetter(jobText)` (regex per research R7) + `wordCount`; tests
- [X] T026 [US4] Implement `apps/worker/src/tailor/tailor-letter.ts`: `generateSentences(kind:'cover_letter')` with roles, ≤ 250 words (over → retry with instruction, then `needs_review`), target company allowed only in greeting/closing; persist document
- [X] T027 [US4] Extend `POST /jobs/:id/tailor` to create the letter document when `requiresCoverLetter(job)` or `{ coverLetter: true }`; add `renderLetterPdf(letter, profile, lang)` in `packages/resume/src/letter.ts` (same font, plain text, one page) used by `GET /tailored/:docId/pdf`
- [X] T028 [P] [US4] Tests `apps/worker/test/tailor-letter.test.ts` (recorded output; job lacking skill → not claimed; target company only in greeting/closing; word limit) and letter render test in `packages/resume/test/letter.test.ts`
- [X] T029 [US4] Web: letter tab in `apps/web/src/components/tailor/review.tsx` (sentences with citations, edit, approve, PDF/text copy)

---

## Phase 7: User Story 5 - Trap evaluation (P2)

- [X] T030 [P] [US5] Fixtures `apps/worker/test/fixtures/eval-tailor/`: `persona.json` (Ana facts), `traps.json` (10 jobs per research R6 incl. 2 prompt-injection jobs pt/en and 1 control)
- [X] T031 [US5] Implement independent checker `apps/worker/test/tailor-eval-lib.ts` `independentCheck(sentences, personaText, job)` (different algorithm: every dictionary tech and every number in claims must occur anywhere in the persona fact text; job orgs absent from persona must not appear outside greeting/closing) + `runTailorEval(src: {llm}|{recording})` running summary+letter generation over traps
- [X] T032 [US5] Script `apps/worker/scripts/record-tailor-eval.ts` (records real qwen3 outputs to `fixtures/eval-tailor/recording.json`, writes `EvalRun` row when `--store`); test `apps/worker/test/tailor-eval.test.ts` (recorded by default, `TAILOR_EVAL_LIVE=1` live; asserts 0 fabrications by validator-accepted docs and by the independent checker; injecting a known fabrication makes it fail); Makefile `eval:` target (live + stores EvalRun)
- [X] T033 [US5] API `GET /eval/runs?suite=tailor` in `apps/api/src/tailor/tailor.controller.ts`

---

## Phase 8: User Story 6 - Auto-tailor top jobs (P3)

- [X] T034 [US6] Hook in `apps/worker/src/jobs/run.ts` after scoring: when `autoTailor`, pick up to `autoTailorN` jobs with `score ≥ scoreThreshold`, not hidden, without a current non-outdated resume document → create documents + enqueue `tailor`
- [X] T035 [P] [US6] Test `apps/worker/test/auto-tailor.test.ts` (8 jobs ≥ 70, N=5 → 5 enqueued; off → none); expose `autoTailor`/`autoTailorN` in `Preferences` (`packages/shared/src/jobs.ts`), `loadPreferences`, preferences UI toggle in `apps/web/src/components/jobs/preferences.tsx`

---

## Phase 9: Polish

- [X] T036 [P] Docs: `docs/architecture.md` (tailoring pipeline, validator rules, TailoredDocument/EvalRun), `CLAUDE.md` (layout `packages/tailor`, `make eval`, gotcha: job text is untrusted), roadmap tick F3
- [X] T037 Run `make typecheck`, `pnpm test`, web lint/build, live smoke (tailor 1 real job end-to-end, clean up), `make eval` live once, `make graph`

## Dependencies

Setup → Foundational (validator) → US2 wiring → US1 → US3/US4/US5 (parallel) → US6 → Polish.
Web tasks T024/T029 + UI part of T035 can be delegated together once API is done.

## Parallel Opportunities

T004–T006, T008, T009 in parallel; T013/T014 with T010–T012; T021, T025, T030 independent.

## MVP

US2 + US1: validated tailored resume via API + PDF. Then review UI (US3), letter (US4), eval (US5), auto (US6).
