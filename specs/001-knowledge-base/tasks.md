---
description: "Task list for F1 Knowledge Base"
---

# Tasks: Knowledge Base

**Input**: Design documents from `/specs/001-knowledge-base/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Constitution §VI requires fixture-based tests for every adapter (resume
parser, GitHub, LinkedIn) and the spec's success criteria (SC-002..SC-005) are verified by them.
Fixtures use synthetic personas only (no real PII). LLM calls in tests use recorded responses via a
fake `LlmProvider`; no network.

**Organization**: Grouped by user story. Story order: US1, US2 (P1) → US3, US4, US6 (P2) → US5, US7 (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1..US7 from spec.md
- Paths are repo-relative. All TS is ESM: relative imports end in `.js` (CLAUDE.md gotcha).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New packages, deps, test runner.

- [X] T001 Create package `packages/kb` (`package.json` name `@autoapply/kb`, `"type":"module"`, scripts `build`/`typecheck`/`test` mirroring `packages/shared/package.json`, deps `@autoapply/shared` `workspace:*` + `zod`; `tsconfig.json` copied from `packages/shared/tsconfig.json`; `src/index.ts` empty barrel)
- [X] T002 [P] Create package `packages/resume` (`@autoapply/resume`, same layout as T001; deps `@autoapply/shared`, `playwright`, `unpdf`, `@napi-rs/canvas`); add `@napi-rs/canvas` to `allowBuilds` in `pnpm-workspace.yaml` if pnpm asks for build approval
- [X] T003 [P] Add `vitest` as root devDependency in `package.json`; add `"test": "vitest run"` script to `packages/shared`, `packages/kb`, `packages/resume`, `apps/worker`, `apps/api`; add `test` task to `turbo.json` (dependsOn `^build`)
- [X] T004 [P] Add deps to `apps/api/package.json`: `@autoapply/kb`, `@autoapply/resume`, `@aws-sdk/client-s3`, `playwright`, `multer` types (`@types/multer` dev); add `@autoapply/kb`, `@autoapply/resume` to `apps/worker/package.json`; run `pnpm install`
- [X] T005 [P] Create test helper `FakeLlmProvider implements LlmProvider` returning recorded JSON in order or via a responder fn — implemented in `packages/llm/src/fake.ts` (exported from `@autoapply/llm` so worker/api tests share it)

**Checkpoint**: `pnpm exec turbo run build typecheck test` passes with empty packages.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, shared contracts, pure merge logic, API/worker wiring used by every story.

**⚠️ CRITICAL**: No user story work before this phase completes.

- [X] T006 Update `packages/db/prisma/schema.prisma` per data-model.md: `Profile` + `headline String?`, `summary String?`; `ResumeBase` + `fileName String`, `rawText String?`, `extraction ResumeExtraction` (enum `text | vision | manual`), `status ResumeStatus` (enum `uploaded | parsing | image_only | failed | review | confirmed | discarded`), `parsed Json?` (now nullable), `error String?`, `confirmedAt DateTime?`; `Fact`: remove `sources`, `conflict`, `confidence`; add `status FactStatus @default(active)` (enum `active | archived`), `hasOpenConflict Boolean @default(false)`, `missingFrom String[]`, keep `@@unique([kind, key])`; new models `FactSource` (`@@unique([factId, origin, ref])`, cascade on fact delete), `FactRevision` (enums `RevisionAction`: `created | edited | verified | unverified | archived | restored | conflict_resolved | source_added`; `RevisionActor`: `user | import | sync`), `FactConflict` (enum `ConflictType`: `value_mismatch | possible_duplicate`; `ConflictStatus`: `open | resolved`; `candidates Json`, `otherFactId String?`, `resolution Json?`), `ProfileSource` (`origin FactOrigin @id`, enum `FactOrigin`: `resume | linkedin | github | user`; `enabled`, `account`, `lastSyncAt`, `lastStatus SyncOutcome?` enum `success | partial | failed`, `lastError`, `resumeAt`, `snapshot Json?`), `SyncRun` (enum `SyncTrigger`: `schedule | manual | import`; `localDate String`, `outcomes Json`, `summary Json`, `@@index([trigger, localDate])`)
- [X] T007 Create migration `make migration name=knowledge_base` and apply; verify `packages/db/prisma/migrations/*_knowledge_base/migration.sql` drops `Fact.sources/conflict/confidence` (table empty in F0, safe)
- [X] T008 Create `packages/db/src/facts.ts` exporting `usableFactsWhere` = `{ verifiedByUser: true, status: 'active', hasOpenConflict: false }` and `factsForMode(mode: RunMode)` (dry_run → `{ status: 'active' }`); export from `packages/db/src/index.ts`
- [X] T009 [P] Create `packages/shared/src/kb.ts`: Zod `LooseDate` (`{ year, month?, precision: 'year'|'month' } | 'present'`), `ItemMeta` (`quote: string`, `flags: ('not_in_source'|'date_ambiguous')[]`, `id: string`), `ResumeDraft` (JSON Resume subset per data-model.md: basics, work, education, skills, languages, certificates, projects; each array item extends `ItemMeta`), `FactValue` discriminated union by `kind` (experience, skill, education, certification, language, project, personal, preference), DTOs `FactView`, `ConflictView`, `ResumeSummary`, `ResumeDetail`, `ResumeDiff`, `ProfileSourceView`, `SyncRunView`, `RenderRequest`, `RenderItem`, `ApiError`; export from `packages/shared/src/index.ts`
- [X] T010 [P] Add `SyncProfilePayload` discriminated union to `packages/shared/src/queues.ts`: `{ kind:'parse_resume', resumeId, mode?:'text'|'vision' } | { kind:'import_github', syncRunId } | { kind:'import_linkedin', syncRunId } | { kind:'sync_all', syncRunId?, trigger:'schedule'|'manual' }`
- [X] T011 [P] Create curated skills dictionary `packages/shared/src/skills.ts`: type `SkillDef { id, label, synonyms[], packages: { npm[], pypi[], go[], cargo[], maven[], composer[], gem[] }, githubLanguages[] }`; seed ≥ 80 common tech skills (languages, frameworks incl. NestJS/Next.js/React/Prisma/BullMQ/Playwright/FastAPI/Django, DBs, cloud, AI/LLM libs); helpers `findSkillByAlias(text)`, `skillByPackage(ecosystem, name)`
- [X] T012 [P] Implement `packages/kb/src/normalize.ts`: `slug()`, `normalizeText()` (lowercase, strip accents, collapse whitespace), `normalizeCompany()` (strip `S.A.`, `SA`, `Ltda`, `LTDA.`, `ME`, `Inc`, `LLC`), `similarity()` (normalized Levenshtein ratio)
- [X] T013 [P] Implement `packages/kb/src/dates.ts` `parseLooseDate(input)`: handles `atual|presente|hoje|até o momento|present|current|now` → `'present'`; pt-BR/en month names and abbreviations (`jan`, `fev`, `mar`, `abr`, `mai`, `jun`, `jul`, `ago`, `set`, `out`, `nov`, `dez`, English equivalents); `MM/YYYY`, `YYYY-MM`, year-only → `precision:'year'` (never invent month); returns `null` + caller adds `date_ambiguous` flag when unparseable
- [X] T014 Implement `packages/kb/src/keys.ts` `factKey(kind, value)` per research R7: skill → `skill:<dictionary id>` or `skill:<slug>`; experience → `experience:<normalizeCompany slug>:<YYYY-MM|YYYY>`; education → `education:<institution slug>:<degree slug>`; certification/language/project → `<kind>:<slug(name)>`; personal → fixed keys `personal:salary_expectation|notice_period|available_from|work_modes|pcd|work_authorization|relocate`
- [X] T015 Implement `packages/kb/src/merge.ts` `mergeCandidates(existing: FactLike[], candidates: Candidate[])` → `{ create[], addSource[], conflicts[], duplicates[] }`: same key + equal normalized value → `addSource`; same key + different value → `conflicts` (`value_mismatch`); different key but `similarity(company) ≥ 0.85` or containment after `normalizeCompany` → `duplicates` (`possible_duplicate`), never merged; never mutates a verified fact
- [X] T016 [P] Unit tests `packages/kb/test/normalize.test.ts`, `dates.test.ts`, `keys.test.ts`, `merge.test.ts` covering edge cases in spec (Itaú vs Itau Unibanco → duplicate, "2021 – hoje", year-only precision, equal value adds source, differing title → conflict)
- [X] T017 Create `apps/api/src/kb/kb.module.ts` (imports `PrismaModule`, `QueuesModule`) registered in `apps/api/src/app.module.ts`; add global exception filter `apps/api/src/kb/api-error.filter.ts` mapping errors to `{ error: { code, message } }`; Zod validation pipe `apps/api/src/kb/zod.pipe.ts`
- [X] T018 [P] Create `apps/api/src/kb/storage.service.ts` (S3 client from `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `forcePathStyle: true`; `put(key, buf, type)`, `get(key)`) and same for worker `apps/worker/src/kb/storage.service.ts`
- [X] T019 Create fact writer — implemented as `applyMerge(db, merge, { actor, verify })` in `packages/db/src/fact-writer.ts` (shared by api resume-confirm/personal and worker importers): one Prisma transaction creating `Fact` + `FactSource` (+ `FactRevision created`), `addSource` (+ `source_added` revision, update `lastSeenAt`), `FactConflict` rows with `hasOpenConflict=true`; asserts every created fact has ≥ 1 source; never sets `verifiedByUser=true`
- [X] T020 Create `apps/worker/src/processors/sync-profile.processor.ts` (`@Processor(QUEUES.syncProfile, { concurrency: 1 })`) parsing `SyncProfilePayload` and dispatching by `kind` to handlers (stubs throwing `not_implemented`); emits `RunEvent` (`queue:'sync-profile'`) on start/finish/error; register in `apps/worker/src/worker.module.ts` with `OllamaProvider` (`ollamaFromEnv`) provided as `LLM` token
- [X] T021 [P] Create web shell `apps/web/src/app/conhecimento/layout.tsx` (pt-BR nav: Visão geral, Currículo, Fatos, Pessoal, Conflitos, Renderizar) and `apps/web/src/lib/api.ts` typed fetch client using DTOs from `@autoapply/shared` and `NEXT_PUBLIC_API_URL`; read `apps/web/node_modules/next/dist/docs/` for Next 16 data fetching and wrap uncached fetches in `<Suspense>`

**Checkpoint**: migration applied, `packages/kb` tests green, worker consumes `sync-profile` jobs (stub).

---

## Phase 3: User Story 1 - Import and verify the base resume (Priority: P1) 🎯 MVP

**Goal**: Upload PDF → stored → parsed by local LLM → reviewed/edited → confirmed into verified facts.

**Independent Test**: Upload fixture persona PDF, fix one wrong field, confirm; facts = resume items, all verified, `resume:` refs, corrected value (spec US1).

### Tests for User Story 1

- [X] T022 [P] [US1] Create fixtures `packages/resume/test/fixtures/persona-ana.pdf` (text, pt-BR, 2 jobs, education, skills), `persona-scan.pdf` (image-only), `persona-ana.expected.json` (expected `ResumeDraft`), and recorded LLM output `apps/worker/test/fixtures/llm/persona-ana.json` including one hallucinated skill not in the PDF
- [X] T023 [P] [US1] Test `packages/kb/test/source-check.test.ts`: `foundInSource` flags hallucinated item, accepts accent/case/whitespace variants
- [X] T024 [P] [US1] Test `apps/worker/test/resume-parser.test.ts` with `FakeLlmProvider`: persona-ana → draft equals expected except hallucinated item flagged `not_in_source`; persona-scan → `image_only`
- [X] T025 [P] [US1] Test `packages/kb/test/resume-to-facts.test.ts`: draft → candidates with correct keys/refs (`resume:<id>#work[0].highlights[1]`); re-upload diff produces added/changed/removed

### Implementation for User Story 1

- [X] T026 [P] [US1] Implement `packages/resume/src/pdf-text.ts`: `extractPdfText(buf)` → `{ text, pages: string[], chars }` (unpdf, items in reading order); `isImageOnly(result)` (`chars < 200`); `renderPagesPng(buf, scale=2)` via unpdf `renderPageAsImage` + `@napi-rs/canvas`
- [X] T027 [P] [US1] Implement `packages/kb/src/source-check.ts` `foundInSource(item, sourceText)`: normalized substring check of `quote` + every value token (names, company, title) present; returns flags
- [X] T028 [P] [US1] Implement `packages/kb/src/resume-to-facts.ts`: `draftToCandidates(draft, resumeId)` (experience one fact per job with highlights inside value; skill one fact per keyword; refs per data-model `FactSource.ref` format) and `diffDraft(draft, existingFacts)` → `ResumeDiff`
- [X] T029 [US1] Implement `apps/worker/src/kb/resume-parser.ts`: download from MinIO → `extractPdfText` → if image-only and mode≠vision set status `image_only`; LLM `generateObject({ schema: ResumeDraft, model: OLLAMA_CHAT_MODEL, temperature: 0 })` with system prompt in English demanding verbatim `quote` per item, original language, no translation, no inference; vision mode sends page PNGs to `OLLAMA_VISION_MODEL`; post-process dates with `parseLooseDate`, flags with `foundInSource`; save `rawText`, `parsed`, `status: review`; LLM unreachable → `failed` with `error` and BullMQ retry (`attempts: 3`, backoff exponential 30 s)
- [X] T030 [US1] Wire `parse_resume` handler in `apps/worker/src/processors/sync-profile.processor.ts` to `resume-parser.ts`
- [X] T031 [US1] Implement `apps/api/src/kb/resumes.service.ts`: `upload(file)` (reject non-PDF via mime + `%PDF-` magic → `415 not_pdf`, > 5 MB → `413 too_large`; version = last + 1; MinIO key `resumes/<id>/original.pdf`; enqueue `parse_resume`), `get`, `list`, `file`, `saveDraft` (only in `review`), `retry(mode)` (from `failed|image_only`), `manual` (empty draft → `review`, `extraction: manual`), `discard`, `confirm(acceptFlagged)` (`409` if not `review`; `422` if a `not_in_source` item is neither removed nor in `acceptFlagged`; merge via `draftToCandidates` + `mergeCandidates`; write facts verified with `actor:user`; update `Profile` basics; set previous active resume `active=false`)
- [X] T032 [US1] Implement `apps/api/src/kb/resumes.controller.ts` routes per contracts/rest-api.md § Resumes (`FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } })`)
- [X] T033 [P] [US1] Implement `apps/api/src/kb/facts.service.ts` + `facts.controller.ts` read side: `GET /kb/facts` with filters `kind, origin, verified, conflict, status, q`; `GET /kb/facts/:id` with revisions
- [X] T034 [US1] Web upload page `apps/web/src/app/conhecimento/curriculo/page.tsx`: list of resumes with status badges, PDF upload form, polling status until `review`
- [X] T035 [US1] Web review page `apps/web/src/app/conhecimento/curriculo/[id]/page.tsx`: original PDF (iframe of `/kb/resumes/:id/file`) left, editable draft sections right, `not_in_source` items highlighted with "remover / manter" actions, `date_ambiguous` badge, save draft, confirm; image_only/failed states with retry (vision) and manual entry buttons; re-upload shows `ResumeDiff` only
- [X] T036 [US1] Web facts list read-only view `apps/web/src/app/conhecimento/fatos/page.tsx` (table: kind, value summary, sources chips, verified badge; filters)

**Checkpoint**: Quickstart §2 passes. MVP usable.

---

## Phase 4: User Story 2 - Enter personal facts (Priority: P1)

**Goal**: Form for salary, notice period, availability, work modes, PCD, work authorization, relocate.

**Independent Test**: Save form, reload; each value is a verified `user` fact; blank PCD → `not_provided`.

- [X] T037 [P] [US2] Add `PersonalFacts` Zod schema to `packages/shared/src/kb.ts`: `salaryExpectation{ amount, currency:'BRL'|'USD'|'EUR', contract:'clt'|'pj'|'both', period:'month'|'year' } | null`, `noticePeriodDays`, `availableFrom`, `workModes[]`, `pcd:'yes'|'no'|'prefer_not'|'not_provided'` (default `not_provided`), `pcdDetails?`, `workAuthorization{ brazil:'citizen'|'permanent'|'visa'|'not_provided', others[] }`, `relocate:'yes'|'no'|'depends'|'not_provided'`; every field defaults to `not_provided`/null, never yes/no
- [X] T038 [P] [US2] Test `apps/api/test/personal.test.ts`: PUT salary only → GET returns `pcd:'not_provided'`; edit creates `FactRevision edited` with `before`
- [X] T039 [US2] Implement `GET/PUT /kb/personal` in `apps/api/src/kb/personal.service.ts` + controller: each field ↔ one `personal:*` fact (`kind: personal`, origin `user`, ref `user:form`, verified); unchanged fields untouched; edits write revisions
- [X] T040 [US2] Implement `POST /kb/facts` (user-entered fact, verified, origin `user`) and `PATCH /kb/facts/:id` (`value`, `verified`) with revisions in `apps/api/src/kb/facts.service.ts`
- [X] T041 [US2] Web form `apps/web/src/app/conhecimento/pessoal/page.tsx` (shadcn inputs/select/switch; PCD and work authorization with explicit "Prefiro não informar" and empty = "Não informado")

**Checkpoint**: Quickstart §3 passes.

---

## Phase 5: User Story 3 - Render ATS-friendly one-page resume (Priority: P2)

**Goal**: Verified facts → single-column one-page PDF with text bullets; overflow reported; ATS lint 100.

**Independent Test**: Render fixture facts; extracted text matches expected order; 1 page; lint 100.

- [X] T042 [P] [US3] Fixtures `packages/resume/test/fixtures/persona-ana.render.json` (fits 1 page) and `persona-long.render.json` (overflows)
- [X] T043 [P] [US3] Test `packages/resume/test/render.test.ts`: persona-ana → 1 page, `extractPdfText` order equals model order, bullets are `•` characters, `atsLint` score 100; persona-long → `{ overflow: true, pages > 1, items }`, no content removed
- [X] T044 [P] [US3] Implement `packages/resume/src/model.ts`: `factsToRenderModel(facts, { hiddenItemIds, lang })` → ordered sections with stable `RenderItem.id` (fact id or `factId#highlight[n]`); section headings pt (`Experiência`, `Formação`, `Habilidades`, `Idiomas`, `Certificações`, `Projetos`) / en
- [X] T045 [P] [US3] Implement `packages/resume/src/template.ts`: HTML single column, A4, margins 12 mm, bundled open font via `@font-face` (embed file under `packages/resume/assets/`), headings `<h2>`, bullets as literal `• ` text in `<p>` (no `<ul>` markers, no CSS `::before`), no images/tables/icons, contact line plain text, optional DRY-RUN watermark as text
- [X] T046 [US3] Implement `packages/resume/src/render.ts` `renderResumePdf(model, opts)`: shared Chromium instance (`chromium.launch` lazily, closed on process exit), `page.setContent`, `page.pdf({ format: 'A4', printBackground: false })`; read back with `extractPdfText`; pages > 1 → return `{ overflow: true, pages, items }` without the PDF
- [X] T047 [US3] Implement `packages/resume/src/ats-lint.ts` `atsLint(pdf, model)` → `{ score 0–100, checks[] }` with checks from research R4 (1 page; text layer; reading order; no images; text bullets; standard headings; email+phone in text; fonts embedded; no header/footer text; no column overlap), equal weights
- [X] T048 [US3] Implement `apps/api/src/kb/render.controller.ts`: `POST /kb/render` (facts via `usableFactsWhere`, or `factsForMode('dry_run')` + watermark when `dryRun`; `200 application/pdf` + headers `X-Ats-Score`, `X-Pages`; overflow → `422 { code:'overflow', pages, items }`), `POST /kb/render/lint`
- [X] T049 [US3] Web page `apps/web/src/app/conhecimento/render/page.tsx`: preview (object URL of PDF), ATS score with failed checks, overflow picker listing items with checkboxes to hide, language toggle pt/en, download button

**Checkpoint**: Quickstart §4 passes (SC-004).

---

## Phase 6: User Story 4 - Import GitHub as skill evidence (Priority: P2)

**Goal**: GitHub repos/languages/READMEs/manifests → unverified skill facts with repo/file refs and computed metrics.

**Independent Test**: Fixture snapshot → each skill has ≥ 1 `github:` ref; forks/archived marked; no skill without evidence.

- [X] T050 [P] [US4] Fixtures `apps/worker/test/fixtures/github/page1.json`, `page2.json` (GraphQL responses: normal repo with `package.json` using `@nestjs/core`/`prisma`, Python repo with `pyproject.toml`, fork, archived repo, repo with README-only mention, manifest > 100 KB, `rateLimit.remaining` low on page2)
- [X] T051 [P] [US4] Test `packages/kb/test/github.test.ts`: snapshot → skills with refs `github:<owner/repo>:<file>` / `github:<owner/repo>:languages`, `repoCount`, `lastActivity` computed by code, `forkOnly`/`archivedOnly` markers; unknown deps ignored (no skill without dictionary match or language)
- [X] T052 [P] [US4] Test `apps/worker/test/github-importer.test.ts`: low rate limit → outcome `partial`, `ProfileSource.resumeAt` set, delayed job added
- [X] T053 [P] [US4] Implement manifest parsers `packages/kb/src/manifests.ts` (deterministic, no LLM): `package.json` (deps+devDeps), `pyproject.toml` (PEP 621 + poetry), `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile` → `{ ecosystem, name }[]`
- [X] T054 [US4] Implement `packages/kb/src/github.ts` `snapshotToSkillCandidates(snapshot)`: languages (bytes > 0) via `githubLanguages`; manifests via `skillByPackage`; README tokens via `findSkillByAlias`; aggregate per skill → `FactValue skill { name, evidence: { repoCount, lastActivity, repos[], forkOnly, archivedOnly } }` all numbers computed by code
- [X] T055 [US4] Implement `apps/worker/src/kb/github-importer.ts`: GraphQL query per research R5 (50 repos/page, `ownerAffiliations: OWNER`, `languages(first:20)`, README variants, manifests via `object(expression:"HEAD:<file>")`, skip blobs `byteSize > 100000`, `rateLimit { remaining resetAt }`); auth `Bearer GITHUB_TOKEN`; backoff on 403/429/5xx; store normalized snapshot in `ProfileSource(github).snapshot`; candidates → `mergeCandidates` → `FactWriter` (unverified, actor `import`); update `ProfileSource` + `SyncRun.outcomes.github`
- [X] T056 [US4] Wire `import_github` handler in `apps/worker/src/processors/sync-profile.processor.ts`
- [X] T057 [US4] Implement `apps/api/src/kb/sources.controller.ts` + `sources.service.ts`: `GET /kb/sources` (seed rows on boot: `github` enabled iff `GITHUB_TOKEN` set, `linkedin` `enabled=false`), `PATCH /kb/sources/:origin`, `POST /kb/sources/:origin/import` (create `SyncRun trigger:'import'`, enqueue; `409 source_disabled`, `412 not_configured`), `GET /kb/sync-runs`
- [X] T058 [US4] Implement `POST /kb/facts/bulk` (`verify|unverify|archive|restore`, revisions per fact) in `apps/api/src/kb/facts.service.ts`
- [X] T059 [US4] Web: facts page `apps/web/src/app/conhecimento/fatos/page.tsx` gets bulk select + verify/reject/archive, inline rename (PATCH value), evidence drawer listing repos/files as links (≤ 2 clicks, SC-006); overview `apps/web/src/app/conhecimento/page.tsx` shows sources with import button and last status

**Checkpoint**: Quickstart §5 passes.

---

## Phase 7: User Story 6 - Resolve conflicts between sources (Priority: P2)

**Goal**: Conflicts listed with sources; resolve by choose/edit/split/merge/keep_separate; conflicting facts unusable until resolved.

**Independent Test**: Fixture resume + second-source data with title conflict → listed, excluded from render, resolved value stored with both sources and history.

- [X] T060 [P] [US6] Test `apps/api/test/conflicts.test.ts`: `choose` → fact value = chosen, `verifiedByUser=true`, conflict `resolved`, `hasOpenConflict=false`, rejected value in `FactRevision.before`; `split` → second fact with key suffix `:2`; `possible_duplicate` + `merge` → sources moved to one fact, other archived; already resolved → `409`; open conflict fact excluded by `usableFactsWhere`
- [X] T061 [US6] Implement `apps/api/src/kb/conflicts.service.ts` + controller: `GET /kb/conflicts?status=open` (`ConflictView` with candidates origin/ref/importedAt), `POST /kb/conflicts/:id/resolve` with strategies `choose { chosenIndex } | edit { value } | split | merge | keep_separate` in one transaction; recompute `Fact.hasOpenConflict`
- [X] T062 [US6] Web page `apps/web/src/app/conhecimento/conflitos/page.tsx`: card per conflict showing values side by side with origin badge and import date; actions Escolher, Editar, São itens diferentes (split), Mesclar / Manter separados for duplicates; overview shows open-conflict count

**Checkpoint**: Quickstart §7 passes (with GitHub or a second resume upload as conflicting source).

---

## Phase 8: User Story 5 - Import LinkedIn profile (Priority: P3)

**Goal**: Opt-in import of own profile via `get_my_profile`; merge into facts (unverified), duplicates add a source.

**Independent Test**: Profile fixture → facts with `linkedin:` refs; equal items add source; disabled → no MCP call.

- [X] T063 [P] [US5] Fixtures `apps/worker/test/fixtures/linkedin/get_my_profile.json` (raw tool output, synthetic persona Ana with one job title differing from resume) and recorded LLM mapping `apps/worker/test/fixtures/llm/linkedin-ana.json`
- [X] T064 [P] [US5] Test `apps/worker/test/linkedin-importer.test.ts` with mocked `LinkedinMcpClient`: disabled → no `call`; enabled → equal items add source, differing title → `FactConflict`; MCP auth error → outcome `failed`, `lastError:'session_expired'`
- [X] T065 [US5] Implement `apps/worker/src/kb/linkedin-importer.ts`: guard `ProfileSource(linkedin).enabled`; `LinkedinMcpClient.call('get_my_profile', {})`; save raw snapshot; flatten to text; map with same LLM path as resume parser (reuse prompt/schema from `resume-parser.ts`, refactor shared bits into `apps/worker/src/kb/draft-llm.ts`) + `foundInSource` against snapshot text (drop `not_in_source` items, log them as `RunEvent warn`); `draftToCandidates` with refs `linkedin:<section>[n]`; `FactWriter` unverified
- [X] T066 [US5] Wire `import_linkedin` handler in `apps/worker/src/processors/sync-profile.processor.ts`
- [X] T067 [US5] Web: sources card for LinkedIn on `apps/web/src/app/conhecimento/page.tsx` with opt-in switch, ToS warning text (pt-BR), hint `make linkedin-login` when `lastError = session_expired`

**Checkpoint**: Quickstart §6 passes.

---

## Phase 9: User Story 7 - Daily profile sync (Priority: P3)

**Goal**: Daily diff of enabled sources; new → unverified, changed → conflict, vanished → flagged; verified never modified; summary visible.

**Independent Test**: Two fixture snapshots of a source → expected added/conflicted/missing; 0 verified facts changed.

- [X] T068 [P] [US7] Test `packages/kb/test/diff.test.ts`: snapshot A → B yields added, changed (→ conflict when fact verified), missing (`missingFrom` includes origin); verified facts untouched
- [X] T069 [P] [US7] Test `apps/worker/test/sync-all.test.ts`: scheduled run skipped when `SyncRun{trigger:'schedule', localDate:today}` exists; manual always runs; GitHub failing → LinkedIn still runs, outcome recorded per source
- [X] T070 [US7] Implement `packages/kb/src/diff.ts` `diffSnapshot(prevFactsForOrigin, candidates)` → `{ added, changed, missing }` (missing = facts with source of that origin whose ref not seen; `lastSeenAt` update list)
- [X] T071 [US7] Implement `sync_all` handler `apps/worker/src/kb/sync-all.ts`: compute `localDate` in `America/Sao_Paulo`; skip duplicate scheduled run; create/complete `SyncRun`; run enabled importers sequentially (each catches its own errors); apply `missingFrom` flags (never delete/archive); write `SyncRun.summary { added, conflicted, missing }`
- [X] T072 [US7] Register daily scheduler in `apps/api/src/kb/sync.service.ts` `onModuleInit`: `queue.upsertJobScheduler('sync-profile-daily', { pattern: '0 6 * * *', tz: 'America/Sao_Paulo' }, { name: 'sync', data: { kind: 'sync_all', trigger: 'schedule' } })`; `POST /kb/sync` enqueues `{ kind:'sync_all', trigger:'manual' }`
- [X] T073 [US7] Web: overview `apps/web/src/app/conhecimento/page.tsx` shows last `SyncRun` summary (added / conflicts / missing with links to filtered facts) + "Sincronizar agora"; facts table badge "sumiu de <origem>" for `missingFrom`

**Checkpoint**: Quickstart §8 passes (SC-005, SC-007).

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T074 [P] Archive instead of delete: ensure no `prisma.fact.delete` exists in `apps/` (`grep`), add test in `apps/api/test/facts.test.ts` that archive keeps row + revision
- [X] T075 [P] Invariant test `apps/worker/test/invariants.test.ts` (contracts/queue-sync-profile.md): after running all importers on fixtures, every fact has ≥ 1 `FactSource`, no processor set `verifiedByUser=true`, verified values unchanged (SC-003, SC-005)
- [X] T076 [P] Extraction quality check `apps/worker/test/extraction-quality.test.ts` over ≥ 5 synthetic persona fixtures with recorded LLM outputs: ≥ 95% items match expected, 100% hallucinated items flagged (SC-002); add `make kb-eval` target in `Makefile` that runs the same suite against live Ollama
- [X] T077 Update `docs/architecture.md` (data model section: new tables, `usableFactsWhere`, `packages/kb`, `packages/resume`, `sync-profile` payload kinds, daily scheduler) and `CLAUDE.md` (layout: new packages; commands: `make kb-eval`; gotcha: Chromium shared instance in api)
- [X] T078 Tick F1 in `docs/roadmap.md` (status ✅ with date) and note the cvlint → internal `atsLint` decision
- [X] T079 Run `make typecheck`, `make lint`, `make test`, quickstart.md §1–§8 manually; then `make graph`

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1) → Foundational (Phase 2) → user stories.
- US1 (Phase 3): needs Phase 2. MVP.
- US2 (Phase 4): needs Phase 2 only (independent of US1).
- US3 (Phase 5): needs Phase 2 + facts to render (US1 or US2 data; tests use fixtures, so code is independent).
- US4 (Phase 6): needs Phase 2. T058 (bulk) is reused by later phases.
- US6 (Phase 7): needs Phase 2; meaningful once a second source exists (US1 re-upload, US4 or US5).
- US5 (Phase 8): needs Phase 2; T065 refactors parser from US1 (T029) into `draft-llm.ts` → do after US1.
- US7 (Phase 9): needs importers it orchestrates (US4, optionally US5).
- Polish (Phase 10): after desired stories.

### Within Each Story

Tests/fixtures first (fail) → pure logic in `packages/*` → worker/api services → controllers → web.

### Parallel Opportunities

- Phase 1: T002–T005 parallel after T001.
- Phase 2: T009, T010, T011, T012, T013 parallel; T014 → T015 → T016; T018, T021 parallel with schema work.
- US1: T022–T025 parallel; T026, T027, T028 parallel; T033 parallel with T031.
- US2 and US3 and US4 can be built in parallel by different agents after Phase 2.

## Parallel Example: User Story 1

```bash
Task: "T022 Create persona fixtures in packages/resume/test/fixtures/"
Task: "T023 Test foundInSource in packages/kb/test/source-check.test.ts"
Task: "T024 Test resume parser in apps/worker/test/resume-parser.test.ts"
Task: "T025 Test resume-to-facts in packages/kb/test/resume-to-facts.test.ts"

Task: "T026 extractPdfText in packages/resume/src/pdf-text.ts"
Task: "T027 foundInSource in packages/kb/src/source-check.ts"
Task: "T028 draftToCandidates/diffDraft in packages/kb/src/resume-to-facts.ts"
```

## Parallel Example: User Story 4

```bash
Task: "T050 GitHub GraphQL fixtures in apps/worker/test/fixtures/github/"
Task: "T051 Test skill derivation in packages/kb/test/github.test.ts"
Task: "T053 Manifest parsers in packages/kb/src/manifests.ts"
```

## Implementation Strategy

### MVP First

1. Phase 1 + Phase 2.
2. US1 (resume → verified facts) → validate quickstart §2. Stop and demo.
3. US2 (personal facts) → together these unblock F3 tailoring with zero fabrication.

### Incremental Delivery

US3 render (attachable PDF) → US4 GitHub evidence → US6 conflicts → US5 LinkedIn → US7 daily sync.
Each phase ends at its quickstart checkpoint; commit per phase.
