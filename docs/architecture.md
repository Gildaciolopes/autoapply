# Architecture

## Pipeline

```
SearchPreference (UI)
  └─► discover / discover-jobspy ─► normalize (dedupe by hash) ─► enrich (full description)
        ─► embed (bge-m3 → pgvector) ─► score (hard filters → vector sim → LLM judge)
        ─► score ≥ threshold? ─ no ─► feed only
                               └ yes ► tailor (resume JSON + cover letter, evidence-validated)
                                      ─► apply (adapter or generic filler, Playwright)
                                         ├ ok → submitted (+ screenshots in MinIO)
                                         ├ unknown question / captcha / session expired → needs_input
                                         └ error → retry w/ backoff → failed
                                      ─► notify (morning report, F6)
```

Mode (`SearchPreference.mode`): `dry_run` never submits; `review` (default) stops at `ready` until
the user approves in the UI; `autopilot` submits when thresholds pass (constitution §II).

## Services

| Path | Runtime | Role |
|---|---|---|
| `apps/web` | Next.js 16 (App Router, `cacheComponents`), Tailwind 4, shadcn/ui | UI. Dynamic fetches must be inside `<Suspense>` |
| `apps/api` | NestJS 12 (ESM), port 3001 | REST, produces BullMQ jobs, Bull Board at `/admin/queues`, `GET /health` |
| `apps/worker` | NestJS 12 standalone context | BullMQ processors, Playwright, MCP clients, S3 |
| `services/scraper` | Python 3.12, uv, JobSpy, `bullmq` (py) | consumes `discover-jobspy`, emits `RawJob` to `normalize` |
| `packages/shared` | TS + Zod 4 | queue names, payload schemas, evidence contracts (single source of truth) |
| `packages/db` | Prisma 7 (`prisma-client` generator, ESM, `@prisma/adapter-pg`) | schema, client factory, pgvector helpers |
| `packages/llm` | TS | `LlmProvider` interface, `OllamaProvider` (JSON-schema structured output + embed, `numCtx`), `FakeLlmProvider` (tests) |
| `packages/kb` | TS, pure (no I/O) | fact keys, normalization, date parsing, provenance check (`foundInSource`), merge/conflict rules, resume↔facts, GitHub skill evidence, manifest parsers, sync diff |
| `packages/resume` | TS, Playwright + unpdf | PDF text extraction, page PNGs (vision fallback), facts → render model, ATS HTML template, `renderResumePdf`, `atsLint` |

Infra (Docker Compose, Colima on the dev Mac): `pgvector/pgvector:pg16` (host 5433), `redis:7`
(6380), `pgsty/minio` (9010 API / 9011 console; official `minio/*` images were removed from Docker
Hub), `minio-init` (creates bucket), `linkedin-mcp` (profile `linkedin`, 127.0.0.1:8765).

Ollama runs on the host (Metal GPU). From containers use `http://host.docker.internal:11434`.

## Data model (packages/db/prisma/schema.prisma)

- Knowledge base (F1, see `specs/001-knowledge-base/data-model.md`): `Profile` (single row `me`),
  `ResumeBase` (upload → parsing → review → confirmed; `rawText`, `parsed` = ResumeDraft with quotes/flags),
  `Fact` (kind+key unique, `verifiedByUser`, `status` active|archived, `hasOpenConflict`, `missingFrom`),
  `FactSource` (origin resume|linkedin|github|user + ref + raw value), `FactRevision` (history),
  `FactConflict` (value_mismatch | possible_duplicate), `ProfileSource` (github/linkedin connection +
  last snapshot), `SyncRun`, `AnswerMemory` (approved Q&A + `vector(1024)`).
  **Usable facts** outside dry-run = `usableFactsWhere` (`packages/db/src/facts.ts`): verified, active,
  no open conflict. Every consumer must use it. Writes go through `applyMerge` (`fact-writer.ts`).
- Search: `SearchPreference`, `Source` (type unique, `dailyCap`, encrypted `sessionEnc`), `Company`,
  `Job` (`dedupeHash` unique, `vector(1024)`), `JobScore`.
- Applications: `Application` (status machine, `tailoredJson` = what was sent; PDF not stored),
  `FormAnswer` (answer + confidence + evidence fact ids), `Artifact` (MinIO keys), `RunEvent`.
- pgvector: columns are `Unsupported("vector(1024)")`; use `packages/db/src/vector.ts` raw SQL helpers.
  Extension is created by `docker/postgres/init.sql` in the app DB and `template1` (shadow DBs).

## Zero Fabrication (constitution §I)

1. LLM gets only retrieved `Fact`s with ids (closed context).
2. Output schemas (`packages/shared/src/evidence.ts`) require `evidence: factId[]` (min 1).
3. Deterministic validator checks every tech/company/title/number against cited facts
   (synonym dictionary, exact numbers). Fail → retry once → `needs_input`.
4. Years of experience etc. computed by code from fact dates.
5. No-evidence yes/no questions → lowest honest option or `needs_input`, never "yes".
6. `make eval` (F3): trap questions; autopilot requires 0 fabrications.

Fact sources (F1): base resume (PDF → unpdf text → qwen3 → ResumeDraft; every item must be found in
the PDF text or it is flagged `not_in_source`; only the user's confirm creates verified facts),
LinkedIn (`get_my_profile` via MCP, opt-in, items not in the tool output are dropped), GitHub
(GraphQL: languages, READMEs, dependency manifests → skills via the curated dictionary
`packages/shared/src/skills.ts`, no LLM; metrics computed by code), user-entered facts (personal form).
Importers never verify and never change a verified value: differences open `FactConflict`s the user
resolves in the UI. Vanished items get `missingFrom`, never deleted.

Knowledge-base jobs share the `sync-profile` queue (concurrency 1) with payload kinds `parse_resume`,
`import_github`, `import_linkedin`, `sync_all`. The API registers BullMQ job scheduler
`sync-profile-daily` (06:00 America/Sao_Paulo); a scheduled run executes at most once per local day.
Resume PDFs live in MinIO at `resumes/<id>/original.pdf`; rendered PDFs are never stored.

## Job sources

| Source | Search | Apply | Risk |
|---|---|---|---|
| Gupy | `portal.api.gupy.io/api/job?name=` (public, unofficial) | logged-in Playwright adapter | medium |
| LinkedIn | MCP `search_jobs`, `get_job_details`, `get_job_apply_url` | Easy Apply via Playwright | high (ToS), low cap |
| Indeed / Glassdoor / Google Jobs | JobSpy (`services/scraper`, `country_indeed="brazil"`) | usually redirects to an ATS | medium |
| Greenhouse / Lever / Ashby / Workable | public board APIs | public forms, no login | low |
| Programathor, Remotar, Trampos, InfoJobs, Catho, Vagas, Solides | per-site adapters (later) | varies | medium |

Endpoints are unverified until each adapter's spec (F2) confirms them with fixtures.

## LLM (16GB RAM)

`qwen3:8b` (text, `think:false`, temperature 0, JSON-schema `format`), `bge-m3` (1024-dim embeddings,
PT/EN), `qwen2.5vl:7b` (vision fallback for hard forms). Change models via `.env`.

## Conventions

- ESM everywhere (`"type": "module"`, `module: nodenext`): relative imports need `.js` suffix.
- BullMQ 6: `ioredis` is an optional peer; apps that use BullMQ must depend on `ioredis`.
- pnpm 11: native build scripts allowed via `allowBuilds` in `pnpm-workspace.yaml`.
- Tests: Vitest (`pnpm test` runs packages serially). DB integration tests use the separate
  `autoapply_test` database (`make test-db`); LLM is replaced by recorded real outputs
  (`apps/worker/test/fixtures/llm`, re-record with `apps/worker/scripts/record-llm-fixture.ts`).
  Nest decorators in Vitest need `oxc.decorator.legacy` (see `apps/*/vitest.config.ts`).
- Python ↔ TS contracts: `services/scraper/src/autoapply_scraper/models.py` mirrors
  `packages/shared/src/queues.ts`. Change both together.
