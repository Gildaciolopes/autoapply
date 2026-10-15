# Implementation Plan: Knowledge Base

**Branch**: `001-knowledge-base` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-knowledge-base/spec.md`

## Summary

Build the user's fact store with provenance and fill it from four sources: base resume PDF (text
extraction → local LLM → `ResumeDraft` with verbatim quotes → deterministic "found in source" check
→ user review → verified facts), personal-facts form, GitHub (GraphQL, deterministic skill evidence
from languages/manifests/READMEs via a curated skills dictionary) and LinkedIn (`get_my_profile` via
the existing MCP client, opt-in). Deterministic keys merge equal items and open conflicts for
differing ones; only verified, active, conflict-free facts are usable outside dry-run. A Playwright
HTML→PDF renderer produces a single-column one-page resume with text bullets, checked by an
internal ATS lint. All background work runs on the existing `sync-profile` queue, including a daily
scheduler that diffs sources without touching verified facts.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, ESM, Node ≥ 22). No Python changes.

**Primary Dependencies**: NestJS 12 (api, worker), BullMQ 6, Prisma 7, Zod 4, Next.js 16 + shadcn/ui
(web), existing `OllamaProvider` (`qwen3:8b`, `qwen2.5vl:7b`), existing `LinkedinMcpClient`.
New: `unpdf` + `@napi-rs/canvas` (PDF text / page images), `playwright` in api (renderer),
`@aws-sdk/client-s3` in api (upload), `vitest` (dev). See research R1, R3, R10–R12.

**Storage**: PostgreSQL 16 (facts, sources, revisions, conflicts, sync runs); MinIO
`resumes/<id>/original.pdf`. Rendered PDFs are not persisted.

**Testing**: Vitest with fixtures (synthetic persona resume PDFs, GitHub GraphQL JSON snapshots,
LinkedIn `get_my_profile` snapshot, LLM responses recorded); pure logic in `packages/kb` tested
without DB.

**Target Platform**: Single Mac host (Colima Docker for infra; api/worker/web/Ollama on host).

**Project Type**: Web application (Turborepo monorepo: Next.js web + NestJS api + NestJS worker + shared packages).

**Performance Goals**: Resume parsed to review in ≤ 2 min on qwen3:8b; render ≤ 3 s; GitHub import of
≤ 200 repos ≤ 2 min within rate limits.

**Constraints**: Local-only data and LLM (§IV, FR-028/029); no LLM-derived numbers (§I); LinkedIn
opt-in, read-only, concurrency 1 (§III); no new queue (§V).

**Scale/Scope**: 1 user; ~50–300 facts; ≤ 300 repos; daily sync; ~8 web screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | Facts always have ≥1 `FactSource`; LLM output items carry verbatim `quote`, checked deterministically (`foundInSource`); dates/metrics computed by code; GitHub skills derived without LLM; unverified/conflicting facts excluded outside dry-run via `usableFactsWhere`; sensitive personal fields default `not_provided`. | PASS |
| II. Human in the Loop | Imports never verify; only user confirm/verify/resolve sets `verifiedByUser`; sync never overwrites verified facts (conflict instead). | PASS |
| III. Respect Platforms | GitHub official GraphQL API with rate-limit backoff; LinkedIn opt-in, own profile only, read-only MCP tool, once per day max; queue concurrency 1. | PASS |
| IV. Local-First AI | Parsing via `LlmProvider`/Ollama; outputs Zod-validated (`generateObject`). No cloud calls. | PASS |
| V. Typed Contracts, Simple Services | Payloads/DTOs in `packages/shared`; reuse `sync-profile` queue; no new service. New deps and two new packages justified below. | PASS (see Complexity Tracking) |
| VI. Testable and Observable | Fixture tests for each importer and renderer; `RunEvent` per step; `SyncRun` records per-source outcome. | PASS |

Post-design re-check (after data-model + contracts): still PASS — contracts keep verification
user-only, `sync-profile` invariants listed in contracts/queue-sync-profile.md.

## Project Structure

### Documentation (this feature)

```text
specs/001-knowledge-base/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rest-api.md
│   └── queue-sync-profile.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── kb.ts                 # ResumeDraft, FactValue, PersonalFacts, DTOs (FactView, ConflictView…)
├── skills.ts             # curated skills dictionary (ids, synonyms, package aliases, GH languages)
└── queues.ts             # + SyncProfilePayload

packages/db/
├── prisma/schema.prisma  # Fact/ResumeBase changes + FactSource, FactRevision, FactConflict,
│                         #   ProfileSource, SyncRun (migration `knowledge_base`)
├── src/facts.ts          # usableFactsWhere helper
├── src/fact-writer.ts    # applyMerge(): writes facts/sources/revisions/conflicts (api + worker)
└── src/testing.ts        # test DB client (refuses non-*_test URLs) + reset

packages/kb/              # NEW, pure TS, no I/O
├── src/keys.ts           # factKey(), slug, company normalization
├── src/dates.ts          # parseLooseDate (pt-BR/en)
├── src/source-check.ts   # foundInSource()
├── src/merge.ts          # mergeCandidates() → {create, addSource, conflicts, duplicates}
├── src/diff.ts           # snapshot diff for sync (added/changed/missing)
├── src/github.ts         # repos snapshot → skill evidence (dictionary, metrics)
├── src/resume-to-facts.ts# ResumeDraft ↔ fact candidates
└── test/                 # vitest + fixtures

packages/resume/          # NEW, rendering + PDF reading
├── src/template.ts       # HTML template (single column, text bullets)
├── src/render.ts         # renderResumePdf() via Playwright
├── src/pdf-text.ts       # extractPdfText(), renderPagesPng() via unpdf
├── src/ats-lint.ts       # atsLint() 0–100
└── test/fixtures/        # synthetic persona PDFs/JSON

apps/api/src/kb/
├── kb.module.ts
├── resumes.controller.ts / resumes.service.ts
├── facts.controller.ts / facts.service.ts      # incl. personal, bulk
├── conflicts.controller.ts / conflicts.service.ts
├── sources.controller.ts / sync.service.ts     # enqueue + daily job scheduler
├── render.controller.ts
└── storage.service.ts                          # MinIO S3 client

apps/worker/src/
├── processors/sync-profile.processor.ts        # dispatch by payload.kind
├── kb/resume-parser.ts                         # text/vision → LLM → ResumeDraft + flags
├── kb/github-importer.ts                       # GraphQL client + rate limit
├── kb/linkedin-importer.ts                     # uses mcp/linkedin-mcp.client.ts
├── kb/draft-llm.ts                             # LLM extraction schema/prompt, vision transcription, normalization
├── kb/import-common.ts                         # applyImport (merge + missing flags) + SyncRun outcomes
├── kb/sync-all.ts                              # sync_all orchestration
└── test/fixtures/

apps/web/src/app/conhecimento/
├── page.tsx              # overview: counts, sources, last sync, open conflicts
├── curriculo/            # upload + review (original | draft side by side)
├── fatos/                # facts table, filters, bulk verify/archive, history drawer
├── pessoal/              # personal facts form
├── conflitos/            # conflict resolution
└── render/               # preview + overflow item picker + ATS score
```

**Structure Decision**: Existing monorepo layout. Domain logic goes in a pure package
(`packages/kb`) so it is unit-testable and shared by api (merge on confirm/resolve) and worker
(imports/sync). Rendering in `packages/resume` because api uses it now and worker reuses it in F3/F4.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New package `packages/kb` | Merge/key/diff logic used by both api and worker; must be fixture-tested without Nest/DB | Duplicating in api + worker breaks single source of truth; putting it in `shared` mixes Zod contracts with domain logic |
| New package `packages/resume` (Playwright, unpdf) | Renderer used by api now and worker in F3/F4; heavy deps isolated from `shared` (imported by web) | Putting it in `shared` would pull Playwright into the web bundle graph |
| New deps `unpdf`, `@napi-rs/canvas`, `vitest`; `playwright` + `@aws-sdk/client-s3` added to api | PDF text/page images (R1); render (R3/R10); upload (R11); TS test runner absent (R12) | Alternatives listed in research.md each add host binaries, CJS issues or cloud PII exposure |
| Open item: "cvlint" target | Tool could not be identified; internal deterministic `atsLint` used as proxy (R4) | Online ATS scorers send PII to third parties |
