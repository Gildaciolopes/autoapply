# Architecture

## Pipeline

```
SearchPreference (UI) ─► POST /discovery/runs (or scheduler `discovery-daily`)
  └─► BullMQ flow: parent score:`process-run`, children per (source, role):
        discover (worker: gupy, linkedin_mcp) · discover-jobspy (Python: indeed, glassdoor, google_jobs)
        each child RETURNS { source, jobs: RawJob[], error? }
  └─► process-run (fan-in): normalize + dedupe (company|title|UF hash, JobOrigin per board, daily caps)
        ─► hard filters (reason) ─► embed (bge-m3 → pgvector) ─► cosine vs profile (usable facts)
        ─► LLM judge top N (matched skills grounded against facts) ─► feed
        ─► score ≥ threshold? ─ no ─► feed only
                               └ yes ► tailor (resume JSON + cover letter, evidence-validated)
                                      ─► apply (adapter or generic filler, Playwright)
                                         ├ ok → submitted (+ screenshots in MinIO)
                                         ├ unknown question / captcha / session expired → needs_input
                                         └ error → retry w/ backoff → failed
                                      ─► notify (morning report, F6)
```

Mode (`SearchPreference.mode`): `dry_run` never submits; `review` (default) stops at `ready` until
the user approves in the UI (F5); `autopilot` submits when thresholds pass (F6, constitution §II).

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
| `packages/jobs` | TS, pure (no I/O) | job normalization (title, UF, work mode, seniority, salary), dedupe hash, hard filters, profile text, similarity calibration, judge prompt + `groundMatches`, run planning |
| `packages/tailor` | TS, pure (no I/O) | F3: deterministic ranking/selection of resume items, Zero-Fabrication validator, years-of-experience computation + placeholders, summary/letter prompts, diff, cover-letter detection, facts hash |
| `packages/apply` | TS, pure (no I/O) | F4: ATS detection, field classifier (pt/en), standard answers from facts, computed years / evidence yes-no / language-level / demographic rules, answer-memory matching, LLM field prompt + post-checks, `planAnswers` pipeline, blockers (captcha / bot protection / login), application facts hash |
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
- Search (F2, see `specs/002-job-discovery-scoring/data-model.md`): `SearchPreference` (single row
  `default`), `Source` (one row per board: gupy, indeed, glassdoor, google_jobs, linkedin_mcp; `dailyCap`
  counts NEW origins per local day), `Company`, `Job` (`dedupeHash` unique, parsed city/UF/remote/
  seniority/monthly BRL salary, `vector(1024)`, hidden/interesting), `JobOrigin` (every board a job was
  seen on), `JobScore` (filter reason, similarity, judge score, grounded `matchedEvidence`, model,
  profileHash), `DiscoveryRun`, `ProfileVector` (cached profile embedding by hash).
- Tailoring (F3): `TailoredDocument` (per job × kind resume|cover_letter; status queued → generating →
  draft|needs_review → approved → outdated), `EvalRun` (suite, fabrications, passed).
- Applications (F4): `Application` (one per job; dry_run here; queued → tailoring → applying → ready |
  needs_input | failed, skipped = kill switch; `ats`, `formUrl`, `needsReasons`, `report` with
  `submitAttempts`/`blockedRequests`, `factsHash` + `tailoredDocIds` for outdated, `lastRunAt` for
  daily caps), `FormAnswer` (per field: type, options, step, answer, source, confidence, evidence,
  blocking + reason, validator findings, filled), `Artifact` (screenshots
  `applications/<id>/<attempt>/<label>.png`), `AnswerMemory` (approved user answers, `normalized`
  question + bge-m3 embedding), `RunEvent` (queue `apply`, per step).
- pgvector: columns are `Unsupported("vector(1024)")`; use `packages/db/src/vector.ts` raw SQL helpers.
  Extension is created by `docker/postgres/init.sql` in the app DB and `template1` (shadow DBs).

## Zero Fabrication (constitution §I)

Implemented in F3 (`packages/tailor`, see `specs/003-tailoring/research.md` R3):
bullets are never rewritten (only selected/ordered by `rankForJob`); the LLM writes only the summary
and cover letter as sentences with `factIds`; durations are `{{anos}}`/`{{anos:<tech>}}` placeholders
computed from fact dates; `validateSentences` (no LLM) checks every technology (dictionary aliases,
ambiguous ones case-sensitive), organization, title/seniority word, certification and number against
the cited usable facts; one retry with the findings, then `needs_review`. Job text is fenced as
untrusted data in prompts (prompt injection). `TailoredDocument` keeps plan, cited sentences,
validation report and a `factsHash`; any change in included/cited facts → `outdated`, approval lost.
`make eval` runs trap jobs (missing skills, inflated years, foreign orgs, cert bait, prompt injection)
with an independent checker and stores `EvalRun` (autopilot requires the latest to pass).

1. LLM gets only retrieved `Fact`s with ids (closed context).
2. Output schemas (`packages/shared/src/evidence.ts`) require `evidence: factId[]` (min 1).
3. Deterministic validator checks every tech/company/title/number against cited facts
   (synonym dictionary, exact numbers). Fail → retry once → `needs_input`.
4. Years of experience etc. computed by code from fact dates.
5. No-evidence yes/no questions → lowest honest option or `needs_input`, never "yes".
6. `make eval` (F3): trap questions; autopilot requires 0 fabrications.
7. Form answers (F4, `packages/apply`): deterministic first — standard fields from Profile/personal
   facts, approved answer memory, years computed from dates, yes/no for skills/certs/languages from
   usable facts (else lowest honest option), language level never rounded up, demographics → "prefer
   not" (never the LLM). Only the tail goes to one batched LLM call: answers must cite facts, free text
   passes `validateSentences`, a model "yes" is never accepted, confidence capped at 0.85 and compared
   with `applyConfidence` (0.7). Required + unanswered → `needs_input`. `make answers-eval` checks it.

## Platforms, sessions and real submission (F5)

`Platform` (one row per `gupy | linkedin | greenhouse | lever | ashby | generic`): encrypted session
(Gupy/LinkedIn), daily caps (submissions / simulations, safe maximum), minimum interval, pause/backoff,
LinkedIn opt-in. **Sessions**: `connect-session` job opens a *headed* Chromium on the platform login
page; the user logs in there (2FA/captcha by themselves); the worker only watches for the logged-in
signal or the UI "Concluí", then stores `storageState` with AES-256-GCM (`SESSION_ENCRYPTION_KEY`,
`v1:iv:tag:data`); wrong/missing key → "reconectar", never plaintext. `test-session` checks a
logged-in page through the dry-run guard. **Preparation** on Gupy / LinkedIn Easy Apply = F4 engine +
session + adapters (`gupy`, `linkedin` modal scope, external apply link → F4 adapter; already applied,
expired session, platform action and unusual activity detected). **Gate** (`apps/worker/src/apply/gate.ts`):
before every simulation/submission — pause, daily cap, minimum interval; errors back off 1 h → 4 h →
manual; unusual activity → manual pause. **Approval** (review mode, not outdated, platform connected)
stores `approvalHash` (answers + tailored docs + form URL) and queues `submit`. **Submit path**
(`apps/worker/src/apply/submit.ts`, the only code that submits): context without the dry-run guard,
re-open, verify each step against the approved answers (`form_changed` / `new_step`), fill exactly the
approved values, compare-and-set `approved → submitting` (kill switch / concurrent run → nothing sent),
click once, confirmation → `submitted`; otherwise `submit_uncertain` (never retried; the user marks it).
Captcha / human check → `submit-assisted`: headed window filled with a banner, the user completes the
check and submits; the system only watches for the confirmation (≤ 15 min).

## Apply engine (F4, dry-run)

Queue `apply` (`ApplyProcessor`, concurrency 1, one shared headless Chromium, daily cap per ATS).
`runApply`: ensure tailored resume (inline F3) → `openDryRunContext` → detect ATS (URL / HTML /
iframes) → adapter (`greenhouse` hints from the public questions API, `lever`, `ashby`, `generic`) →
per step: extract fields across frames → blockers → screenshot → `planAnswers` → fill / attach PDF from
memory → next step (max 6) → `after` screenshot → persist answers, artifacts, reasons, report.
**Dry-run guard** (`apps/worker/src/apply/browser.ts`, the only way to open an apply page): every
non-GET request is aborted for every host (single exception: read-only GraphQL `query` POSTs on
`jobs.ashbyhq.com`, needed to render the form), websockets closed, service workers blocked, submit
events / `form.submit()` / `requestSubmit()` trapped in every frame; a run with an application-form
submit attempt fails. Captcha / bot protection / login → `needs_input`, never solved; plain Chromium,
no stealth. Kill switch `POST /apply/stop`: removes queued jobs, marks applications `skipped`, the
running one aborts between steps.

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
| Gupy | `portal.gupy.io/api/job-search/jobs?jobName=` (public, unofficial; old `portal.api.gupy.io` host is gone) | logged-in Playwright adapter | medium |
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
