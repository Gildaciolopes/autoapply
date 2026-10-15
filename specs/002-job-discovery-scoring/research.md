# Research: Job Discovery and Scoring (F2)

Format: Decision / Rationale / Alternatives.

## R1. Gupy source

- **Decision**: `GET https://portal.gupy.io/api/job-search/jobs?jobName=<q>&offset=<n>&limit=<n>` (public, no
  auth, unofficial). Response `{ data: Job[], pagination: { total, limit, offset } }`; each job has `id`,
  `name`, `description` (full text, HTML entities), `careerPageName` (company), `workplaceType`
  (`remote|hybrid|on-site`), `city`, `state`, `jobUrl`, `publishedDate`, `applicationDeadline`,
  `disabilities`. Verified live on 2026-10-15; fixture `apps/worker/test/fixtures/gupy/search-fullstack.json`.
  The old host `portal.api.gupy.io/api/job` (in docs/architecture.md) now returns 404 — docs updated.
  Requests: concurrency 1, `limit ≤ 50`, 1 s between pages, stop at daily cap; 4xx/5xx → backoff, then
  source outcome `failed`.
- **Rationale**: Only no-login, structured source for Gupy; already includes the full description, so no
  enrichment step for Gupy. Constitution §III prefers public APIs.
- **Alternatives**: scraping gupy.io HTML (fragile); Apify actors (cloud, paid, sends queries out);
  official Gupy API (`developers.gupy.io`) is for employers, not job seekers.

## R2. Indeed / Glassdoor / Google Jobs

- **Decision**: Keep the existing Python service (JobSpy) with `country_indeed="brazil"`, sites
  `indeed`, `glassdoor`, `google` (`google_search_term = "<role> vagas <location>"`), `hours_old=72`,
  `description_format="markdown"`, `results_wanted = remaining daily cap of that site`. Each site is its
  own `Source` row (own cap/enabled flag). **Change**: the scraper returns the RawJob list as the BullMQ
  job return value instead of pushing to `normalize` (see R4); payload gains `runId`, `site`.
- **Rationale**: JobSpy is the maintained multi-board library; Python only where needed (§V).
- **Alternatives**: separate TS scrapers per board (duplicated effort, more anti-bot exposure).

## R3. LinkedIn

- **Decision**: Existing `LinkedinMcpClient` in the worker: `search_jobs` (keywords + location) then
  `get_job_details` per result, up to the LinkedIn cap (default 15/day). Tool argument names are read
  from `listTools()` at runtime and validated; responses parsed defensively into RawJob. Opt-in only;
  any auth/session error → outcome `failed: session_expired` (hint `make linkedin-login`).
- **Rationale**: Read-only tools only; low cap honours the ToS risk (§III).
- **Alternatives**: JobSpy's LinkedIn scraper (unauthenticated scraping, higher block risk).

## R4. Run orchestration (fan-out / fan-in)

- **Decision**: BullMQ **FlowProducer**. `POST /discovery/runs` creates a `DiscoveryRun` and a flow whose
  parent is `process-run` on queue `score` and whose children are one discover job per (source, role)
  on `discover` (worker: gupy, linkedin_mcp) or `discover-jobspy` (Python: indeed/glassdoor/google).
  Children return `RawJob[]`; children use `ignoreDependencyOnFailure: true` so a failing source never
  blocks the run (FR-007). When all children finish, `process-run` reads `getChildrenValues()` and runs
  the pipeline in one place: normalize → dedupe/upsert → hard filters → embed → similarity → judge top N.
  Python bullmq supports being a flow child (it only consumes and returns). The existing `normalize`,
  `enrich`, `embed` queue names stay reserved/unused in F2 (no per-job queue hop needed at this volume).
- **Rationale**: Judging top-N requires all jobs of the run first; a flow gives a deterministic fan-in
  without polling. One processor = simple, testable pipeline.
- **Alternatives**: per-job queues normalize→embed→score (no natural "run finished" point for top-N);
  polling for completion (racy).

## R5. Normalization and dedupe

- **Decision**: Pure functions in new package `packages/jobs`:
  - title: strip gender markers `(a)`, `(o/a)`, `/a`, codes in brackets, seniority words → `normTitle`;
  - company: `normalizeCompany` from `@autoapply/kb`;
  - location: parse `"São Paulo, SP"`, `"Remoto"`, state names/UFs (27 UFs table) → `{ city, uf, remote }`;
  - work mode: source field when present, else keyword detection (`remoto|home office|100% remoto` →
    remote, `híbrido|hybrid` → hybrid, `presencial|on-site` → onsite), else `null`;
  - seniority: title keywords (`estágio|estagiário|intern` → intern, `jr|júnior|junior` → junior,
    `pleno|pl|mid` → mid, `sr|sênior|senior` → senior, `especialista|staff|principal|lead|tech lead` →
    lead) else `null`;
  - salary: structured min/max from source or regex over description (`R$ 8.000 - 12.000`, `R$ 15k`,
    `/mês`, `/ano` → ÷12, `por hora` → unknown, `a combinar` → unknown); BRL only, monthly.
  - `dedupeHash = sha256(normCompany | normTitle | (remote ? 'remote' : uf))`. Same hash = same job,
    regardless of age (a repost re-opens the job and updates `lastSeenAt`). Origins keyed by
    `(source, externalId ?? url)`.
- **Rationale**: Deterministic, cheap, covers cross-board reposts. Keeping `Job.dedupeHash` unique avoids a
  windowed lookup; the spec's 30-day window is replaced by "same hash ⇒ same job, reopened" (simpler,
  same user-visible effect for active postings). Spec edge case updated.
- **Alternatives**: embedding-similarity dedupe (expensive, opaque); URL-only dedupe (misses cross-board).

## R6. Hard filters (FR-010/011)

- **Decision**: Pure `applyHardFilters(job, prefs)` → `{ passed, reason }`, first failing rule wins, order:
  blocked company (normalized compare / `sameOrganization`) → excluded keyword (whole word in title or
  description) → location/work mode (job remote ⇒ ok if prefs include remote; job onsite/hybrid ⇒ ok if
  that mode is preferred AND its UF/city is in preferred locations; unknown mode ⇒ pass) → salary (only
  when job has a known monthly BRL max < minSalary) → seniority (only when detected and not in
  preferred levels) → role relevance (normalized title shares no token with any preferred role and no
  preferred stack term appears in title → `cargo fora do alvo`). Reasons are pt-BR codes shown in UI.
- **Rationale**: Unknown never filters (FR-011); cheap filters before embeddings/LLM.

## R7. Similarity

- **Decision**: `bge-m3` embeddings (1024-d) via existing `LlmProvider.embed`. Job text = title + company
  + first 2 000 chars of description. Profile text = preferred roles + stack + usable facts (experience
  titles + highlights, skills, education) — built by `profileText(facts, prefs)`; its embedding is
  cached in `ProfileVector` keyed by sha256 of the text. Cosine computed with pgvector (`<=>`) for
  passing jobs of the run. Pre-judge score = `round(clamp((cos − 0.35) / 0.40, 0, 1) × 100)`;
  calibration constants live in one place and are checked by the labelled eval (SC-005).
- **Rationale**: Local, multilingual, already pulled. pgvector columns already exist on `Job`.
- **Alternatives**: keyword overlap only (weak for pt/en synonyms); cloud embeddings (§IV).

## R8. LLM judge (FR-013/014)

- **Decision**: qwen3:8b, `think:false`, temperature 0, `numCtx 16384`, Zod schema
  `{ score: 0–100, matched: { skill, factIds: string[] }[], missing: string[], reasons: string }`
  (`reasons` ≤ 400 chars, pt-BR). Closed context: job title/company/description (≤ 6 000 chars) +
  the user's usable facts as `[id] kind: summary` lines + preferences. Deterministic post-check
  `groundMatches()`: a matched skill is kept only if every cited factId is a usable fact AND one of
  them is a skill fact whose canonical id (skills dictionary) equals the skill's canonical id, or an
  experience/project fact whose text contains the skill alias; otherwise moved to `missing`. Judged
  jobs: top N by similarity among passing jobs of the run (default 20). Failure (Ollama down) → keep
  similarity score, `judged=false`, retried by the next run or "reavaliar".
- **Rationale**: Constitution §I — "matched" is a claim about the user and must be evidenced.
  ~25–40 s per job on 16 GB → 20 jobs ≈ 10–13 min, within SC-006 (30 min / 100 jobs).
- **Alternatives**: judging all passing jobs (too slow); cloud LLM (§IV).

## R9. Daily caps and schedule

- **Decision**: Cap counts NEW jobs per source per local day (`JobOrigin.firstSeenAt` in
  America/Sao_Paulo). Discover children receive `limit = cap − usedToday` (skip when ≤ 0);
  `process-run` re-checks when inserting (newest `postedAt` first). Optional daily run: API job scheduler
  `discovery-daily` (cron from `SearchPreference.discoveryCron`, default `0 7 * * *`), enabled by
  `autoDiscover`; at most one scheduled run per local day.
- **Rationale**: Caps are about load on each platform (§III); fetched-but-duplicate jobs don't count.

## R10. Feed queries

- **Decision**: API `GET /jobs` joins `Job` + `JobScore` + origins, ordered by `score desc, postedAt desc`,
  cursor pagination (50). Filters in SQL. Hidden/blocked never returned unless `showFiltered`.
  "Possivelmente encerrada": `lastSeenAt < now − 14 days` computed at query time.
- **Rationale**: Single user, small volume; no materialized views.

## R11. Tests

- **Decision**: Vitest. `packages/jobs` pure unit tests (normalize, dedupe, filters, salary, grounding).
  Worker: Gupy source against the recorded live fixture; LinkedIn against a synthetic MCP fixture;
  `process-run` integration on `autoapply_test` with `FakeLlmProvider` (deterministic embeddings via
  `embed` responder + recorded judge outputs). Python: pytest for `row_to_raw_job` and return-value
  contract. Labelled eval (SC-005): 30 synthetic job postings + persona Ana facts, recorded real
  bge-m3 vectors and qwen3 judgements; `make jobs-eval` re-runs live.
