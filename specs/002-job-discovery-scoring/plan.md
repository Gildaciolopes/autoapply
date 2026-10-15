# Implementation Plan: Job Discovery and Scoring

**Branch**: `002-job-discovery-scoring` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-job-discovery-scoring/spec.md`

## Summary

Preferences (with suggestions from verified facts) drive a discovery run: a BullMQ flow fans out one
discover job per (source, role) — Gupy public job-search API and LinkedIn MCP in the worker, Indeed /
Glassdoor / Google Jobs via the existing Python JobSpy service — each returning normalized `RawJob[]`.
A parent `process-run` job fans in: deterministic normalization and dedupe (company + title + location
hash, multi-origin), daily-cap enforcement, hard filters with reasons, bge-m3 similarity against a
profile built only from usable facts, and a qwen3 judgement for the top N whose "matched skills" are
grounded against verified facts by code. A feed screen lists, filters and acts on the ranked jobs.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, Node ≥ 22); Python 3.12 (scraper).

**Primary Dependencies**: NestJS 12, BullMQ 6 (FlowProducer), Prisma 7 + pgvector, Zod 4, Next.js 16,
existing `OllamaProvider` (`qwen3:8b`, `bge-m3`), `LinkedinMcpClient`, JobSpy, `@autoapply/kb`
(normalizeCompany, skills dictionary, usableFactsWhere). New package `packages/jobs` (pure). No new
third-party dependency.

**Storage**: PostgreSQL (Job, JobOrigin, JobScore, DiscoveryRun, ProfileVector; vectors in pgvector).

**Testing**: Vitest (packages/jobs, worker, api) on `autoapply_test`; pytest (scraper); recorded Gupy
response (live, 2026-10-15); synthetic LinkedIn fixture; recorded embeddings/judgements for the labelled
eval.

**Target Platform**: single Mac host (api/worker/web/scraper/Ollama on host, infra in Colima).

**Project Type**: web application (monorepo).

**Performance Goals**: run of 100 new jobs ≤ 30 min incl. judging 20 (SC-006); feed query < 300 ms.

**Constraints**: per-source daily caps, concurrency 1 per source, no anti-bot evasion (§III); local AI
only (§IV); matched skills evidenced (§I).

**Scale/Scope**: ≤ ~250 new jobs/day; ≤ 20k jobs retained; 3 screens (preferences, feed, job detail).

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | Profile for similarity/judge built only from `usableFactsWhere`; LLM "matched" skills must cite fact ids and pass deterministic `groundMatches`, else moved to missing; scores store model + profileHash. | PASS |
| II. Human in the Loop | F2 never applies; it only ranks. LinkedIn opt-in with explicit terms acceptance. | PASS |
| III. Respect Platforms | Daily caps per source (new jobs), concurrency 1, backoff, captcha/block → stop source for the day; Gupy via public endpoint; LinkedIn low cap, read-only tools. | PASS |
| IV. Local-First AI | bge-m3 + qwen3 via `LlmProvider`; Zod-validated judge output. | PASS |
| V. Typed Contracts, Simple Services | Payloads in `packages/shared` mirrored in Python; reuses existing queues (`discover`, `discover-jobspy`, `score`); no new service; one new pure package justified below. | PASS |
| VI. Testable and Observable | Fixture tests per source; `RunEvent` per step; `DiscoveryRun.outcomes` per source. | PASS |

Post-design re-check: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-job-discovery-scoring/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ (rest-api.md, queues.md)
├── checklists/requirements.md
└── tasks.md   # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── jobs.ts               # Preferences, SourceView, JobCard, JobsQuery, DiscoveryRunView, JudgeResult
└── queues.ts             # DiscoverPayload v2 (runId, source…), RawJob sources, DiscoverResult

packages/jobs/            # NEW, pure (no I/O)
├── src/normalize.ts      # title/company/location/UF/work mode/seniority/salary parsing
├── src/dedupe.ts         # dedupeHash, origin key
├── src/filters.ts        # applyHardFilters → { passed, reason }
├── src/profile.ts        # profileText(facts, prefs), suggestPreferences(facts, profile)
├── src/similarity.ts     # cosine, similarityToScore (calibration constants)
├── src/judge.ts          # judge prompt builder, groundMatches()
└── test/

packages/db/prisma/schema.prisma   # migration `job_discovery`; src/vector.ts + profile/job vector helpers
packages/db/src/discovery.ts       # loadPreferences, sourceBudgets, startDiscoveryFlow (shared by api + worker)

apps/worker/src/
├── sources/gupy.source.ts         # portal.gupy.io/api/job-search/jobs
├── sources/linkedin.source.ts     # MCP search_jobs + get_job_details
├── processors/discover.processor.ts   # (rewrite) returns { source, jobs }
├── processors/score.processor.ts      # process-run + start-run
├── jobs/run.ts / upsert.ts / score.ts # fan-in pipeline: upsert+caps, filters, embed, similarity, judge
└── test/ (fixtures/gupy, fixtures/linkedin, fixtures/eval)

services/scraper/                  # return RawJob list (no push to normalize), per-site source, runId

apps/api/src/jobs/
├── preferences.controller.ts / preferences.service.ts   # + suggest, re-filter on save
├── sources.controller.ts (job sources) / discovery.service.ts (FlowProducer, scheduler)
└── feed.controller.ts / feed.service.ts

apps/web/src/app/vagas/
├── page.tsx               # feed
├── [id]/page.tsx          # job detail (evidence)
└── preferencias/page.tsx  # preferences + sources
```

**Structure Decision**: same monorepo pattern as F1: pure domain logic in `packages/jobs` (unit-tested,
used by worker and api re-filter), I/O in worker/api.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New package `packages/jobs` | Normalize/filters/grounding are used by worker (run) and api (re-filter on save) and need pure tests | Duplicating in two apps; putting job logic in `packages/kb` mixes domains |
| FlowProducer instead of per-job queues | Top-N judging needs a run-level fan-in | Polling/timers are racy; per-job `score` cannot know the run's top N |
