# Roadmap

Each item = one Spec Kit feature (`/speckit-specify "<prompt>"` → plan → tasks → implement).
Mark status here when a feature merges.

| # | Feature | Status | Done when |
|---|---|---|---|
| F0 | Foundation: monorepo, compose, Makefile, Prisma schema, health, Bull Board, scraper skeleton | ✅ done (scaffold, no spec) | `make dev` boots everything, `/health` all up |
| F1 | Knowledge base | ✅ implemented 2026-10-14 (branch `001-knowledge-base`) | facts from CV + LinkedIn + GitHub with provenance, conflicts resolved in UI, resume renders to PDF scoring 100 on the internal `atsLint` (stand-in for "cvlint", which could not be identified — see specs/001-knowledge-base/research.md R4) |
| F2 | Job discovery + scoring | ⏳ next | ranked feed from Gupy API, JobSpy, LinkedIn MCP; dedupe; scores with reasons |
| F3 | Tailoring + Zero-Fabrication validator + `make eval` | — | tailored resume/cover letter with 0 invented claims on the eval set |
| F4 | Apply engine (dry-run): Greenhouse/Lever/Ashby adapters + generic filler | — | correct screenshots on 20 real jobs without submitting |
| F5 | Logged-in platforms: Gupy, LinkedIn Easy Apply, session connect, daily caps | — | assisted real submissions in review mode |
| F6 | Overnight runs: scheduler, answer memory learning, review queue UX, Telegram morning report, kill switch | — | full night unattended in review mode |
| F7 | Extras: AutoApply MCP server, Gmail reply tracking, analytics | — | — |

## Suggested `/speckit-specify` prompts

**F1** — Knowledge base: user uploads base resume PDF (stored in MinIO), it is parsed by the local
LLM into JSON Resume shape and reviewed by the user; LinkedIn profile is imported via the
linkedin-mcp `get_my_profile` tool; GitHub repos/languages/READMEs/dependency manifests are imported
via the official API as skill evidence. Everything becomes `Fact` rows with provenance; conflicts
between sources are shown for the user to resolve; user enters personal facts (salary expectation,
notice period, availability, PCD, work authorization). A resume renderer turns JSON into an
ATS-friendly one-page PDF (text bullets, not CSS markers). Daily `sync-profile` job diffs sources.

**F2** — Discovery and scoring: preferences screen (roles, seniority, stack, Brazil locations, work
modes, min salary, blocked companies, excluded keywords, sources on/off, daily caps); sources Gupy
portal API, JobSpy (Indeed/Glassdoor/Google, Brazil), LinkedIn MCP; normalize + dedupe hash; embed
with bge-m3; score = hard filters → cosine similarity → LLM judge on top N with matched/missing
skills and reasons; feed screen.

**F3** — Tailoring: per job, reorder/select bullets and skills and rewrite the summary using only
cited facts; cover letter when required; deterministic evidence validator; diff preview vs base
resume; `make eval` with trap questions.

**F4** — Apply engine in dry-run: adapters for Greenhouse, Lever, Ashby; generic filler (extract
fields incl. iframes → LLM maps to grounded answers → fill → attach PDF from memory buffer);
before/after screenshots to MinIO; needs_input on low confidence/captcha.

**F5** — Logged-in platforms: Gupy and LinkedIn Easy Apply adapters, session connect flow
(`make linkedin-login`, Playwright storageState encrypted), per-source daily caps, concurrency 1.

**F6** — Overnight: BullMQ repeatable schedule from `SearchPreference.scheduleCron`, review queue
with batch approve, AnswerMemory learning loop, kill switch, Telegram morning report, live log via SSE.
