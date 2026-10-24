# AutoApply — CLAUDE.md

Self-hosted, single-user job auto-applier for tech roles in Brazil. Finds jobs, scores them,
tailors the user's resume per job (never inventing anything), fills/submits applications, runs
overnight with a local LLM. Default mode: **review** (user approves in batch in the morning).

Owner: Gildácio Lopes (Full-Stack & AI Engineer). UI language: pt-BR. Code/comments/specs: English.

## Read first (in this order, only what the task needs)

1. `.specify/memory/constitution.md` — non-negotiable rules (Zero Fabrication, human-in-the-loop,
   respect platforms, local-first AI). Every plan must comply.
2. `docs/roadmap.md` — features F0–F7, status, ready-made `/speckit-specify` prompts.
3. `docs/architecture.md` — pipeline, services, data model, sources, conventions.
4. `graphify-out/GRAPH_REPORT.md` — code graph summary (see Token economy). Not committed: on a
   fresh clone run `make graph` first (and `graphify hook install` to keep it fresh on commits).
5. `specs/NNN-*/` — spec/plan/tasks of the feature being worked on.

## Token economy (mandatory)

- **graphify first**: for "where is X / what calls Y / how does Z flow" use
  `graphify query "<question>" --budget 1500`, `graphify explain "<Node>"`, `graphify path "A" "B"`
  before grepping or reading files. Refresh after structural changes: `make graph`
  (`graphify update .`, AST only, no LLM). Git hooks keep it updated on commit.
- **rtk**: shell commands are auto-proxied by the global rtk hook (`git`, `pnpm`, `docker`, `prisma`,
  `grep`, `ls`…). Use `rtk test <cmd>` / `rtk err <cmd>` to see only failures. Never dump huge logs:
  `tail -c`/`head -c` a log, don't `cat` it.
- Read files with offsets/limits when you know the area. Don't re-read files you just edited.

## Workflow: Spec-Driven Development (Spec Kit)

```
/speckit-specify "<feature prompt from docs/roadmap.md>"   → specs/NNN-name/spec.md (+ branch)
/speckit-clarify                                           (optional, de-risk ambiguity)
/speckit-plan                                              → plan.md, data-model.md, contracts/
/speckit-tasks                                             → tasks.md
/speckit-analyze                                           (optional consistency check)
/speckit-implement                                         → code
```

After a feature: tick it in `docs/roadmap.md`, update `docs/architecture.md` if architecture
changed, update this file if a new convention/command appeared, run `make graph`.

## Commands (Makefile)

| Command | What |
|---|---|
| `make setup` | first time: `.env`, pnpm + uv deps, Playwright Chromium, Ollama models, infra, migrations |
| `make dev` | infra in Docker + api/worker/web/packages (turbo watch) + Python scraper on host |
| `make infra` / `make down` | start (wait healthy + create bucket) / stop containers (volumes kept) |
| `make migrate` / `make migration name=x` / `make studio` | Prisma |
| `make test` / `make typecheck` / `make lint` | TS (turbo, serial) + Python (pytest/ruff); `make test` first runs `make test-db` |
| `make test-db` | create + migrate the `autoapply_test` DB used by integration tests |
| `make eval` | anti-fabrication trap eval (10 trap jobs × summary + letter) on the live LLM; stores `EvalRun` (~15 min) |
| `make answers-eval` | form-answer trap eval (20 trap questions) on the live LLM; stores `EvalRun` suite `apply-answers` (~4 min) |
| `make jobs-eval` | job ranking eval (30 labelled postings) against live bge-m3 + qwen3 (~6 min) |
| `make kb-eval` | resume-extraction quality eval (5 personas) against the live local LLM (~12 min) |
| `make health` | `GET :3001/health` → db / redis / ollama |
| `make models` | `ollama pull qwen3:8b bge-m3 qwen2.5vl:7b` |
| `make linkedin-login` / `make linkedin-up` | LinkedIn MCP session (viewer on :6080) / start MCP server |
| `make graph` | refresh graphify code graph |
| `make reset` | **deletes all local data volumes** (asks confirmation) |

URLs: web http://localhost:3000 · api http://localhost:3001 · Bull Board
http://localhost:3001/admin/queues · MinIO console http://localhost:9011 · Postgres localhost:5433 ·
Redis localhost:6380 · Ollama http://localhost:11434 · LinkedIn MCP http://localhost:8765/mcp.

## Layout

```
apps/web            Next.js 16 + Tailwind 4 + shadcn/ui (see apps/web/AGENTS.md)
apps/api            NestJS 12 REST + BullMQ producers + Bull Board
apps/worker         NestJS 12 standalone: BullMQ processors, Playwright, MCP clients
services/scraper    Python 3.12 (uv): JobSpy → queue `normalize`
packages/shared     Zod schemas: queue names/payloads, evidence contracts
packages/db         Prisma 7 schema + client + pgvector helpers
packages/llm        LlmProvider + OllamaProvider (+ FakeLlmProvider for tests)
packages/kb         pure knowledge-base logic: fact keys, merge/conflicts, provenance check, GitHub evidence
packages/resume     PDF text (unpdf), ATS resume renderer (Playwright), atsLint
packages/jobs       pure job logic: normalize/dedupe, hard filters, profile text, judge grounding, run planning, night window/report, Telegram transport
packages/tailor     pure F3 logic: resume ranking, Zero-Fabrication validator, years placeholders, prompts, diff
packages/apply      pure F4 logic: ATS detection, field classifier, grounded answer pipeline, blockers
docker/             postgres init (pgvector)
docs/               architecture, roadmap
.specify/           Spec Kit (constitution, templates, scripts)
specs/              one folder per feature (created by /speckit-specify)
```

## Gotchas (learned while scaffolding — don't rediscover)

- **Docker runtime is Colima.** If `docker` says the socket is missing: `colima start`.
- **MinIO**: official `minio/minio` and `minio/mc` images are gone from Docker Hub → using
  `pgsty/minio` / `pgsty/mc` (same CLI).
- **NestJS 12 is ESM-only** → whole repo is ESM (`"type": "module"`, `module: nodenext`). Relative
  imports must end in `.js`. Top-level `await` in `main.ts` is fine.
- **BullMQ 6** made `ioredis` optional → any app using BullMQ must list `ioredis` as a dependency,
  otherwise workers loop on errors and flood logs (this once produced a 30GB log). In BullMQ 6
  `queue.client` no longer exists; use e.g. `queue.getJobCounts()` for a Redis health check.
- **Prisma 7**: datasource URL lives in `packages/db/prisma.config.ts` (loads `../../.env`), not in
  the schema. Generator `prisma-client` outputs to `packages/db/src/generated/prisma` (gitignored,
  regenerated by `build`). Uses `@prisma/adapter-pg`. pgvector columns are `Unsupported(...)` →
  raw SQL helpers in `packages/db/src/vector.ts`.
- **Next.js 16** with `cacheComponents: true`: uncached fetches must be inside `<Suspense>` or the
  build fails ("uncached or runtime data during prerendering"). `LayoutProps`/`PageProps` are
  generated types: `typecheck` runs `next typegen` first. Read `apps/web/node_modules/next/dist/docs/`
  before using unfamiliar Next APIs.
- **pnpm 11**: build-script approvals go in `allowBuilds` (pnpm-workspace.yaml), not
  `onlyBuiltDependencies`. Quote workspace specs in zsh: `'@autoapply/shared@workspace:*'`.
- **Ollama on the host**, not in Docker (Metal GPU). Containers reach it via
  `host.docker.internal:11434`. qwen3 is called with `think:false` for structured output.
- **LinkedIn MCP** (`stickerdaniel/linkedin-mcp-server`): session volume
  `./data/linkedin-mcp:/home/pwuser/.linkedin-mcp`; first login with `make linkedin-login`. Read-only
  tools only; it cannot submit applications. LinkedIn ToS forbid automation: keep caps low.
- **Discovery runs are BullMQ flows**: discover children (worker + Python) RETURN `DiscoverResult`;
  the `process-run` parent on queue `score` does normalize/dedupe/score. The scraper no longer pushes to
  `normalize` (queue name kept, unused). Children report failures as results on their last attempt.
- **Gupy** search endpoint is `https://portal.gupy.io/api/job-search/jobs?jobName=&offset=&limit=`
  (the old `portal.api.gupy.io` host returns 404). Unofficial: if it breaks, re-record
  `apps/worker/test/fixtures/gupy/search-fullstack.json`.
- Python ↔ TS payload contracts must stay in sync: `services/scraper/src/autoapply_scraper/models.py`
  ↔ `packages/shared/src/queues.ts`.
- **Vitest + Nest decorators**: needs `oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } }`
  (`apps/api|worker/vitest.config.ts`). Integration tests refuse any DB URL not ending in `_test`.
- **Playwright** browsers must match the installed version: after bumping, `pnpm exec playwright install chromium`
  (renderer in `packages/resume` is used by the api).
- **qwen3:8b resume parse** takes ~2–2.5 min (num_ctx 16384). LLM test fixtures are real recorded
  outputs; re-record with `apps/worker/scripts/record-llm-fixture.ts` after prompt changes.
- **Tailoring**: never rewrite resume bullets; LLM text must cite fact ids and pass `validateSentences`.
  Job descriptions are untrusted input (prompt injection) — keep them inside `<job_posting>` in prompts.
  Any change to the validator/prompts → re-run `make eval` (re-records `apps/worker/test/fixtures/eval-tailor/recording.json`).
- **Apply engine (F4)**: open apply pages ONLY through `openDryRunContext` (`apps/worker/src/apply/browser.ts`):
  it aborts every non-GET request and traps form submits. Never add a submit path there (F5 adds its own).
  Never answer "yes" from the LLM; never solve/evade captchas. Form fixtures are rendered-DOM snapshots
  without scripts (`apps/worker/scripts/snapshot-form.ts <url> <name> --api <json url>`); re-record when an
  ATS changes its markup. Any change to answer rules/prompts → re-run `make answers-eval`.
- **Platforms & submission (F5)**: real submissions happen ONLY in `apps/worker/src/apply/submit.ts`
  (approved + matching `approvalHash` + compare-and-set to `submitting`; never retried after the click).
  Never type/store platform passwords or solve captchas: login and human checks happen in a headed
  window driven by the user. Sessions are AES-256-GCM with `SESSION_ENCRYPTION_KEY`. Gupy/LinkedIn test
  fixtures are synthetic (`apps/worker/test/fixtures/platforms/`); real snapshots with
  `snapshot-form.ts --session <kind>` go to `data/fixtures/` (gitignored). Tests submit only to a local
  recording form, never to a real platform.
- **Overnight runs (F6)**: the night is the `night-tick` state machine (`apps/worker/src/night/tick.ts`,
  test it with a fake clock via `tick({ now, ... })`); one scheduled run per night through
  `NightRun.scheduleKey @unique`; it never approves nor queues submissions. Kill switch =
  `stopEverything` (`packages/db/src/night.ts`) everywhere (UI, `/apply/stop`, Telegram). Live log reads
  `RunEvent.seq`; always set `nightRunId` (night events) or `applicationId` on new events. Reports and
  bot replies carry counts, titles and companies only (test asserts no PII); bot commands only from
  `TELEGRAM_CHAT_ID`. Fact-backed answers run before answer memory (memory never overrides a fact).
- Knowledge base: only user actions verify facts; anything that reads facts for claims must use
  `usableFactsWhere` from `@autoapply/db`.
- Kill stray processes from manual runs (`pgrep -fl dist/main.js`) before restarting; an orphaned
  process writing to a deleted log keeps consuming disk.

## Hard rules

- Never let the LLM invent skills, numbers, employers or titles. Every generated claim carries
  `evidence: factId[]` and passes the deterministic validator (constitution §I).
- No captcha solving, stealth/fingerprint tricks or anti-bot evasion. Captcha → `needs_input`.
- Never commit `.env`, `data/`, sessions or resumes. User PII stays local.
- Don't submit real applications in tests: use `dry_run` mode and fixtures.

## Status

F0 done 2026-10-14. F1 Knowledge base (PR #1) and F2 Job discovery + scoring (PR #2) merged.
F3 Tailoring (PR #3), F4 Apply engine dry-run (PR #5) and F5 Logged-in platforms + assisted real submission
(PR #6) merged. F6 Overnight runs implemented on branch `006-overnight-runs`. Next: **F7 Extras**.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
