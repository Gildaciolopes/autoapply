---
description: "Task list for F2 Job Discovery and Scoring"
---

# Tasks: Job Discovery and Scoring

**Input**: Design documents from `/specs/002-job-discovery-scoring/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution §VI requires fixture tests per source adapter; SC-002..SC-005 are
verified by tests. Integration tests use `autoapply_test` (`make test-db`), `FakeLlmProvider` (embeddings via
responder, recorded judge outputs). Sources use recorded fixtures; no network in tests.

**Organization**: by user story. Order: US1, US2, US3 (P1) → US4 (P2) → US5 (P3).

## Format: `[ID] [P?] [Story] Description`

- ESM: relative imports end in `.js`. Python ↔ TS contracts change together (`models.py` ↔ `queues.ts`).

---

## Phase 1: Setup

- [X] T001 Create package `packages/jobs` (`@autoapply/jobs`, `"type":"module"`, scripts build/dev/typecheck/`test: vitest run --passWithNoTests`, deps `@autoapply/shared`, `@autoapply/kb` `workspace:*`, `zod`; tsconfig copied from `packages/kb/tsconfig.json`; `src/index.ts` barrel); add it to `apps/api` and `apps/worker` dependencies; `pnpm install`
- [X] T002 [P] Extend `FakeLlmProvider` in `packages/llm/src/fake.ts` with an optional `embedder: (texts: string[]) => number[][]` constructor option (default keeps `[]`), so tests get deterministic vectors

---

## Phase 2: Foundational

**⚠️ No user story work before this phase completes.**

- [X] T003 Update `packages/db/prisma/schema.prisma` per data-model.md: `SourceType` add `indeed`, `glassdoor`, `google_jobs`; `Source` add `lastStatus String?`, `lastError String?`; `SearchPreference` add `minSalaryContract String?`, `judgeTopN Int @default(20)`, `autoDiscover Boolean @default(false)`, `discoveryCron String @default("0 7 * * *")`; `Job` add `city String?`, `uf String?`, `remote Boolean @default(false)`, `seniority String?`, `salaryText String?`, `firstSeenAt DateTime @default(now())`, `lastSeenAt DateTime @default(now())`, `hidden Boolean @default(false)`, `interesting Boolean @default(false)`, relation `origins JobOrigin[]`; new `JobOrigin` (`jobId` cascade, `source SourceType`, `externalId String`, `url`, `firstSeenAt`, `lastSeenAt`, `runId String?`, `@@unique([source, externalId])`, `@@index([source, firstSeenAt])`); `JobScore` add `passed Boolean @default(true)`, `filterReason String?`, `similarity Float?`, `judged Boolean @default(false)`, `matchedEvidence Json @default("[]")`, `profileHash String @default("")`, `demoted String[]`, `updatedAt DateTime @updatedAt`; new `DiscoveryRun` (`trigger` enum `manual|schedule`, `localDate`, `status` enum `running|done|failed`, `startedAt`, `finishedAt?`, `outcomes Json @default("{}")`, `judged Int @default(0)`, `@@index([trigger, localDate])`); new `ProfileVector` (`hash String @id`, `text`, `embedding Unsupported("vector(1024)")?`, `createdAt`)
- [X] T004 Create migration `make migration name=job_discovery`, apply to dev and `make test-db`; extend `resetKnowledgeBase` in `packages/db/src/testing.ts` (or add `resetJobs`) to truncate `JobScore, JobOrigin, Job, Company, DiscoveryRun, ProfileVector, Source, SearchPreference`
- [X] T005 Add vector helpers to `packages/db/src/vector.ts`: `setProfileVector(db, hash, text, v)`, `getProfileVector(db, hash)`, `jobSimilarities(db, profileHash, jobIds)` → `{ jobId, cosine }[]` using `1 - (embedding <=> profile)`
- [X] T006 [P] Create `packages/shared/src/jobs.ts`: `Seniority` enum `intern|junior|mid|senior|lead`; `WorkMode`; `JobSourceType` `gupy|indeed|glassdoor|google_jobs|linkedin_mcp`; `Preferences` (roles, seniority, stack, locations, workModes, minSalary nullable int, minSalaryContract `clt|pj|any`|null, blockedCompanies, excludeKeywords, judgeTopN 0–50 default 20, autoDiscover, discoveryCron, saved boolean); `SourceView` (type, enabled, dailyCap, usedToday, lastStatus, lastError, warning?); `FilterReason` enum `blocked_company|excluded_keyword|location_mode|salary_below_min|seniority|off_target`; `JobCard`; `JobsQuery`; `DiscoveryRunView`; `SourceOutcome` (status, found, new, duplicates, filtered, error?); `JudgeResult` (`score` int 0–100, `matched: {skill, factIds: string[]}[]`, `missing: string[]`, `reasons` string max 400); export from index
- [X] T007 [P] Update `packages/shared/src/queues.ts`: `DiscoverPayload` → `{ runId, source: JobSourceType, query, location (default 'Brasil'), limit int ≥1, hoursOld? }`; `RawJob.source` uses `JobSourceType`, add `externalId` required-or-url rule doc, `salaryText?`, `uf?`, `city?`; new `DiscoverResult { source, jobs: RawJob[], error?: string }`; `ProcessRunPayload { runId }`; mirror in `services/scraper/src/autoapply_scraper/models.py` (`JobspyDiscoverPayload` gains `runId`, `source: Literal['indeed','glassdoor','google_jobs']`, maps to one JobSpy site)
- [X] T008 [P] Implement `packages/jobs/src/normalize.ts`: `normalizeTitle` (strip `(a)`, `(o/a)`, `/a`, `[...]`, codes, seniority words; lowercase, no accents), `parseLocation(raw)` → `{ city, uf, remote }` with 27-UF table (names + siglas) and remote markers, `detectWorkMode(sourceValue, text)` (`remote|hybrid|onsite|null`; Gupy `on-site` → onsite), `detectSeniority(title)` per research R5 keywords, `parseSalary(min, max, text)` → `{ min, max, text }` monthly BRL (`/ano` ÷ 12, `k` ×1000, hourly/`a combinar`/non-BRL → null)
- [X] T009 [P] Implement `packages/jobs/src/dedupe.ts`: `dedupeHash(company, title, loc)` = sha256 of `normalizeCompany | normalizeTitle | (remote ? 'remote' : uf ?? 'na')`; `originKey(raw)` = `externalId ?? url`
- [X] T010 [P] Unit tests `packages/jobs/test/normalize.test.ts`, `dedupe.test.ts`: gender markers, UF parsing ("São Paulo, SP", "Recife - PE", "Remoto"), salary forms (`R$ 8.000 - 12.000`, `R$ 15k/mês`, `R$ 180.000/ano`, `a combinar`, `USD 5,000`), same job on two boards → same hash, different city → different hash
- [X] T011 Create Nest module skeleton `apps/api/src/jobs/jobs.module.ts` registered in `apps/api/src/app.module.ts` (reuses `ApiErrorFilter`, `ZodPipe` from `apps/api/src/kb/`); seed `Source` rows on boot in `apps/api/src/jobs/sources.service.ts` (`gupy` 50, `indeed` 50, `glassdoor` 50, `google_jobs` 50 enabled; `linkedin_mcp` 15 **disabled**; never overwrite user changes)
- [X] T012 Register `FlowProducer` provider in `apps/api/src/queues/queues.module.ts` (`BullModule.registerFlowProducer({ name: 'discovery' })`) and export it

**Checkpoint**: migration applied, `packages/jobs` tests green.

---

## Phase 3: User Story 1 - Define search preferences (P1) 🎯 MVP part 1

**Goal**: preferences screen with suggestions from facts, sources on/off and caps.
**Independent Test**: save, reload, persist; LinkedIn needs terms acceptance; disabled source never queried.

- [X] T013 [P] [US1] Implement `packages/jobs/src/profile.ts` `suggestPreferences(facts, profile)` → roles from most recent experience titles (normalized, ≤ 3), stack from verified skill facts ranked by GitHub `repoCount` then recency (≤ 12), locations from `Profile.city` (UF parsed) + `remote`, workModes from `personal:work_modes` fact when provided; never sets salary/blocked/excluded
- [X] T014 [P] [US1] Test `packages/jobs/test/profile.test.ts` for suggestions from persona Ana facts (fixture objects)
- [X] T015 [US1] Implement `apps/api/src/jobs/preferences.service.ts` + `preferences.controller.ts`: `GET /preferences` (row id `default`, `saved:false` when absent), `GET /preferences/suggest` (usable facts via `usableFactsWhere`), `PUT /preferences` (Zod `Preferences`; upsert; then re-filter open jobs — implemented in US3 T037, call guarded until then; manage `discovery-daily` scheduler per `autoDiscover`/`discoveryCron`)
- [X] T016 [US1] Implement `GET /sources`, `PATCH /sources/:type` in `apps/api/src/jobs/sources.controller.ts`: `usedToday` = count `JobOrigin` with `firstSeenAt` ≥ local midnight America/Sao_Paulo; enabling `linkedin_mcp` requires `{ acceptTerms: true }` else `409 terms_required`; `dailyCap` 0–200
- [X] T017 [P] [US1] Test `apps/api/test/preferences.test.ts`: defaults, save/reload, suggest uses only verified facts, LinkedIn terms gate, cap validation
- [X] T018 [US1] Web `apps/web/src/app/vagas/preferencias/page.tsx` + client component `apps/web/src/components/jobs/preferences.tsx`: chips inputs for roles/stack/locations/blocked/excluded, seniority & work-mode checkboxes, min salary + contract, "Sugerir do meu perfil" (fills, does not save), sources table (enabled switch, cap input, used today, last status) with LinkedIn terms dialog, auto-discover toggle + time; add "Vagas" link on home and `apps/web/src/lib/api.ts` jobs helpers

**Checkpoint**: Quickstart §2.

---

## Phase 4: User Story 2 - Discover jobs without duplicates (P1)

**Goal**: run fans out to sources, fans in, upserts deduplicated jobs with origins under caps.
**Independent Test**: fixture responses with the same job on two boards → one job, two origins; failing source doesn't block others.

- [X] T019 [P] [US2] Fixtures: `apps/worker/test/fixtures/gupy/search-fullstack.json` (recorded live 2026-10-15, exists), `apps/worker/test/fixtures/linkedin/search_jobs.json` + `job_details_*.json` (synthetic), `services/scraper/tests/fixtures/jobspy_rows.json` (synthetic rows incl. one duplicate of a Gupy job on Indeed)
- [X] T020 [P] [US2] Implement `apps/worker/src/sources/gupy.source.ts` (`GET https://portal.gupy.io/api/job-search/jobs?jobName&offset&limit`, user-agent `autoapply`, pages of ≤ 50 until `limit` reached or `pagination.total`, 1 s between pages, HTML entities decoded in description; maps `name→title`, `careerPageName→company`, `workplaceType`, `city/state`, `jobUrl`, `publishedDate`, `id→externalId`; injectable `fetch`)
- [X] T021 [P] [US2] Implement `apps/worker/src/sources/linkedin.source.ts`: read tool schemas via `LinkedinMcpClient.listTools()` once, call `search_jobs` (keywords=query, location) then `get_job_details` per id up to `limit`; parse defensively (text or structured); session/auth errors → throw `SourceError('session_expired')`
- [X] T022 [US2] Rewrite `apps/worker/src/processors/discover.processor.ts`: validate `DiscoverPayload`, dispatch to gupy/linkedin source, return `DiscoverResult`; errors return `{ source, jobs: [], error }` for known source errors (captcha/blocked → `error:'blocked'`, stop) and throw for transient ones (BullMQ retry)
- [X] T023 [P] [US2] Update Python `services/scraper/src/autoapply_scraper/__init__.py` + `jobspy_source.py`: consume `discover-jobspy`, map `source` → JobSpy site (`google_jobs` → `google` with `google_search_term = f"{query} vagas {location}"`), `results_wanted = limit`, return `{"source", "jobs": [RawJob...], "error"?}` as job return value (no more push to `normalize`); tests `services/scraper/tests/test_jobspy_source.py` (row mapping, return contract)
- [X] T024 [US2] Implement `apps/api/src/jobs/discovery.service.ts` + `discovery.controller.ts`: `POST /discovery/runs` (`412 no_preferences` when no roles; `409 run_in_progress`), create `DiscoveryRun`, compute per-source remaining cap split across roles, build flow via FlowProducer per `contracts/queues.md` (children opts `ignoreDependencyOnFailure: true`, attempts 2); `GET /discovery/runs[/:id]`; also `start-run` creation helper used by scheduler
- [X] T025 [US2] Implement upsert stage `apps/worker/src/jobs/upsert.ts`: normalize each RawJob (T008), group by `dedupeHash`, upsert `Company` by name, upsert `Job` (new: firstSeenAt; existing: lastSeenAt, reopen), upsert `JobOrigin` by `(source, externalId)`; enforce per-source cap on NEW origins (newest `postedAt` first); return per-source `{ found, new, duplicates }`
- [X] T026 [US2] Implement `apps/worker/src/processors/score.processor.ts` (`@Processor(QUEUES.score, { concurrency: 1 })`): `process-run` → collect `getChildrenValues()` + `getFailedChildrenValues()` → upsert stage → (US3 stages hooked later) → write `DiscoveryRun.outcomes`, `status`, `finishedAt`, `RunEvent`s; `start-run` → create run unless a scheduled run exists for local date; register in `apps/worker/src/worker.module.ts`
- [X] T027 [P] [US2] Tests: `apps/worker/test/gupy-source.test.ts` (recorded fixture → RawJobs, pagination stop at limit), `apps/worker/test/linkedin-source.test.ts` (fake MCP), `apps/worker/test/process-run.test.ts` (children values incl. cross-board duplicate → 1 job / 2 origins; failed child recorded and others processed; cap respected; second run → duplicates, lastSeenAt updated)
- [X] T028 [US2] Add `discovery-daily` scheduler management in `apps/api/src/jobs/discovery.service.ts` (`upsertJobScheduler`/`removeJobScheduler` on queue `score`, name `start-run`)

**Checkpoint**: Quickstart §3.

---

## Phase 5: User Story 3 - Score and rank with explanations (P1)

**Goal**: hard filters → similarity → judge top N with grounded matched skills.
**Independent Test**: fixture jobs + persona facts: filter reasons right, relevant jobs on top, every matched skill backed by a fact.

- [X] T029 [P] [US3] Implement `packages/jobs/src/filters.ts` `applyHardFilters(job, prefs)` → `{ passed, reason: FilterReason | null }` in order: blocked company (`sameOrganization`) → excluded keyword (whole word, accent-insensitive, title+description) → location/mode (rules in research R6) → salary (only known max < minSalary) → seniority (only detected and not preferred) → off_target (no role token and no stack term in title); unknown never filters (FR-011)
- [X] T030 [P] [US3] Tests `packages/jobs/test/filters.test.ts` covering each reason and each "unknown never filters" case
- [X] T031 [P] [US3] Implement `packages/jobs/src/profile.ts` `profileText(facts, prefs)` (deterministic order; roles, stack, experience titles+highlights, skills, education) + `profileHash`; `packages/jobs/src/similarity.ts` `similarityToScore(cos)` = `round(clamp((cos − 0.35) / 0.40, 0, 1) × 100)` (constants exported)
- [X] T032 [P] [US3] Implement `packages/jobs/src/judge.ts`: `buildJudgeMessages(job, facts, prefs)` (system prompt in English: use only listed facts, cite fact ids, pt-BR reasons ≤ 400 chars, never infer experience), `groundMatches(result, usableFacts)` per research R8 → `{ matched: {skill, factIds}[], missing, demoted }`
- [X] T033 [P] [US3] Tests `packages/jobs/test/judge.test.ts`: claimed skill without fact → missing + demoted; fact id not usable → demoted; alias match (Postgres ↔ PostgreSQL) kept; experience text match kept
- [X] T034 [US3] Implement scoring stage `apps/worker/src/jobs/score.ts`: for jobs of the run (and open jobs when rescoring): filters → `JobScore` upsert (passed/reason); embed passing jobs without embedding (batch 16) via `llm.embed` + `setJobEmbedding`; profile vector cached by hash; similarity via `jobSimilarities`; pre-judge score; top `judgeTopN` by similarity → `generateObject(JudgeResult, numCtx 16384)` + `groundMatches`; store score/matchedEvidence/missing/reasons/model/profileHash/judged; LLM failure → keep similarity score, `judged=false`, RunEvent warn
- [X] T035 [US3] Hook scoring stage into `process-run` in `apps/worker/src/processors/score.processor.ts` and record `DiscoveryRun.judged` + per-source `filtered`
- [X] T036 [P] [US3] Test `apps/worker/test/score-stage.test.ts` with `FakeLlmProvider` (deterministic embeddings by keyword, recorded judge outputs): blocked/excluded never reach LLM, only top N judged, hallucinated matched skill demoted, LLM failure keeps similarity scores
- [X] T037 [US3] Implement re-filter on preferences save in `apps/api/src/jobs/preferences.service.ts` (re-run `applyHardFilters` for open jobs, update `JobScore.passed/filterReason`, header `x-refiltered`); remove the guard from T015

**Checkpoint**: Quickstart §4 (scores visible via API).

---

## Phase 6: User Story 4 - Browse the job feed (P2)

**Goal**: ranked, filterable feed with actions.
**Independent Test**: filter, hide, block company, reload — state persists.

- [X] T038 [US4] Implement `apps/api/src/jobs/feed.service.ts` + `feed.controller.ts`: `GET /jobs` (JobsQuery filters, order score desc / postedAt desc, cursor 50, `possiblyClosed = lastSeenAt < now − 14d`, hidden excluded unless `showHidden`, filtered excluded unless `showFiltered`), `GET /jobs/:id` (description + matchedEvidence with fact summaries), `PATCH /jobs/:id` (`hidden`, `interesting`), `POST /jobs/:id/block-company` (append to `blockedCompanies`, re-filter)
- [X] T039 [P] [US4] Test `apps/api/test/feed.test.ts`: ordering, filters, hide/interesting persistence, block-company hides all that company's jobs, possiblyClosed flag
- [X] T040 [US4] Web feed `apps/web/src/app/vagas/page.tsx` + `apps/web/src/components/jobs/feed.tsx`: run button ("Buscar agora") + last run summary per source, filters bar, job cards (score badge, judged/not, title, company, location/mode, salary or "salário não informado", source badges, age, matched (green) / missing (grey) chips, "possivelmente encerrada"), actions open original / hide / bloquear empresa / interessante, "mostrar filtradas" with reasons in pt-BR
- [X] T041 [US4] Web job detail `apps/web/src/app/vagas/[id]/page.tsx` + `apps/web/src/components/jobs/job-detail.tsx`: description, score breakdown (similarity, judge), matched skills with linked facts (`/conhecimento/fatos`), missing, reasons, origins with links

**Checkpoint**: Quickstart §4 in the UI.

---

## Phase 7: User Story 5 - Re-score on changes (P3)

- [X] T042 [US5] Implement `POST /scoring/rescore` in `apps/api/src/jobs/discovery.controller.ts`: flow with no children, parent `process-run { runId, rescore: true, judge }` → score stage over all open, non-hidden jobs (recompute similarity with current profile; judge new top N when `judge`)
- [X] T043 [P] [US5] Test `apps/worker/test/rescore.test.ts`: after adding a verified skill fact the profile hash changes, similarity recomputed, a previously missing skill becomes matched after judge
- [X] T044 [US5] Web: "Reavaliar" button on feed (`apps/web/src/components/jobs/feed.tsx`) with confirmation that it uses the local LLM for top N

---

## Phase 8: Polish & Cross-Cutting

- [X] T045 [P] Labelled eval: `apps/worker/test/fixtures/eval/jobs-30.json` (30 synthetic postings, labelled relevant/not for persona Ana), recorded bge-m3 vectors + qwen3 judgements via `apps/worker/scripts/record-jobs-eval.ts`; `apps/worker/test/jobs-eval.test.ts` asserts ≥ 8 of top 10 relevant (SC-005) and 100% matched skills grounded (SC-004); `make jobs-eval` runs it live (`JOBS_EVAL_LIVE=1`)
- [X] T046 [P] Update `docs/architecture.md` (pipeline: FlowProducer run, sources table, scoring stages, new tables) and `CLAUDE.md` (layout `packages/jobs`, `make jobs-eval`, gotcha: scraper returns results instead of pushing to `normalize`; Gupy endpoint)
- [X] T047 Tick F2 in `docs/roadmap.md`
- [X] T048 Run `make typecheck`, `pnpm test`, `cd services/scraper && uv run pytest -q && uv run ruff check src tests`, web build/lint, live smoke (one real discovery run with Gupy only, then clean up), `make graph`

---

## Dependencies & Execution Order

- Setup → Foundational → stories.
- US1 (prefs) needed by US2 (queries come from roles) — US2 tests can use fixture prefs.
- US3 hooks into US2's `process-run`; its pure parts (T029–T033) can start right after Phase 2.
- US4 needs US3 scores; US5 needs US3.
- Python T023 independent of TS tasks once T007 is done.

## Parallel Opportunities

- Phase 2: T006, T007, T008, T009 in parallel; T010 after T008/T009.
- US2: T019, T020, T021, T023 in parallel.
- US3 pure: T029–T033 in parallel with US2 worker work.
- Web (T018, T040, T041, T044) can be delegated as one block once API contracts are implemented.

## Implementation Strategy

MVP = US1 + US2 + US3 (preferences → discovery → scored jobs via API). Then US4 feed UI, US5 rescore, polish/eval.
Commit per phase.
