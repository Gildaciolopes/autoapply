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
| `make test` / `make typecheck` / `make lint` | TS (turbo) + Python (pytest/ruff) |
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
packages/llm        LlmProvider + OllamaProvider
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
- Python ↔ TS payload contracts must stay in sync: `services/scraper/src/autoapply_scraper/models.py`
  ↔ `packages/shared/src/queues.ts`.
- Kill stray processes from manual runs (`pgrep -fl dist/main.js`) before restarting; an orphaned
  process writing to a deleted log keeps consuming disk.

## Hard rules

- Never let the LLM invent skills, numbers, employers or titles. Every generated claim carries
  `evidence: factId[]` and passes the deterministic validator (constitution §I).
- No captcha solving, stealth/fingerprint tricks or anti-bot evasion. Captcha → `needs_input`.
- Never commit `.env`, `data/`, sessions or resumes. User PII stays local.
- Don't submit real applications in tests: use `dry_run` mode and fixtures.

## Status

F0 (foundation) done on 2026-10-14: infra up, initial migration `init` applied, `/health` all up,
worker consumes `discover`, scraper consumes `discover-jobspy`, web builds. Next: **F1 Knowledge base**
(`/speckit-specify` with the F1 prompt in `docs/roadmap.md`).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
