# Implementation Plan: Overnight Runs

**Branch**: `006-overnight-runs` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-overnight-runs/spec.md`

## Summary

A `NightRun` table and a one-minute `night-tick` job scheduler drive an idempotent state machine:
inside the user's window (default 23:00–06:59, São Paulo) it starts F2 discovery, then prepares the
best-scored jobs (F4 engine, which tailors inline) up to a nightly budget under F5 platform gates,
waits until the window ends while approved submissions flow through the F5 submit path, and finishes
with counters, pending work and a report. The report is shown in the UI and sent once to a private
Telegram chat (no PII); the bot also accepts `parar`/`retomar`/`status` from that chat only. A global
kill switch pauses scheduling and cancels everything queued. A review queue groups the night's output
for batch approve/reject/inline answers; user answers and edits feed the answer memory (enable,
disable, usage, fact conflicts). Run events stream live over SSE with replay by sequence number.
Nothing is ever submitted without the user's approval.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, Node ≥ 22).

**Primary Dependencies**: NestJS 12 (`@Sse`), BullMQ 6 (job schedulers; new queue `night`, existing
`notify`), Prisma 7, Zod 4, Next.js 16 (browser `EventSource`), `fetch` to the Telegram Bot API. No
new third-party dependency.

**Storage**: PostgreSQL (`NightRun`, extended `SearchPreference`, `Application`, `RunEvent`,
`AnswerMemory`).

**Testing**: Vitest — pure window/report/estimate/conflict helpers; tick state machine on
`autoapply_test` with a fake clock, fake enqueuers and fixture jobs; Telegram via a fake `fetch`; SSE
replay through the Nest app; API review/memory/control. Zero real submissions, zero real Telegram
calls.

**Target Platform**: the user's Mac (runs only while it is awake).

**Project Type**: web application (monorepo).

**Performance Goals**: tick < 1 s; stop effective < 30 s (SC-004); live events < 5 s (SC-007);
review of 20 items < 10 min (SC-003).

**Constraints**: review mode only (no auto-approval), F5 caps/interval/backoff/concurrency 1
unchanged, one scheduled run per night, report exactly once, no PII in messages, bot commands only
from the configured chat.

**Scale/Scope**: single user; ≤ 40 applications per night.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | No new generated text; memories come only from user-provided/edited answers; verified facts win over memories (conflict shown). | PASS |
| II. Human in the Loop | The night never approves; submission only of user-approved items (F5 path); autopilot stays disabled; global kill switch in UI and from the phone; stopped stays stopped until resume. | PASS |
| III. Respect Platforms | Nightly budget on top of unchanged F5 per-platform caps, interval, backoff, concurrency 1; LinkedIn opt-in unchanged. | PASS |
| IV. Local-First AI | No new AI calls. Telegram is a notification channel carrying counts, titles and companies only (no resume/PII); off unless the user configures it. | PASS |
| V. Typed Contracts, Simple Services | Payloads/views in `packages/shared/src/night.ts`; one new queue (`night`) justified below; reuses `notify`; no new service. | PASS |
| VI. Testable and Observable | Every transition testable via `tick(now)`; RunEvents per step with sequence ids; live stream; report per run. | PASS |

Post-design re-check: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/006-overnight-runs/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ (rest-api.md, queues.md)
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/night.ts              # NightSettings, NightCounters, NightReport, views, ReviewQueue, MemoryView, payloads
packages/shared/src/queues.ts             # + QUEUES.night
packages/jobs/src/night.ts                # NEW pure: nightWindow, isInside, missedNight, selectBudget, buildReport/formatReport, sendEstimate
packages/apply/src/memory.ts              # + memoryConflict; MemoryCandidate.id
packages/db/prisma/schema.prisma          # NightRun, prefs window/pause, Application reject/nightRunId, RunEvent seq/nightRunId, AnswerMemory enabled/lastUsedAt/origin
packages/db/src/night.ts                  # NEW: selectNightJobs, prepareApplication (shared by api apply() and night), nightCounters, stopEverything

apps/worker/src/night/
├── tick.ts                               # state machine (research R1)
├── report.ts                             # build + send report (notify `report`)
└── commands.ts                           # Telegram poll + parar/retomar/status (transport in packages/jobs/src/telegram.ts)
apps/worker/src/processors/night.processor.ts   # queue `night`: night-tick, start-manual
apps/worker/src/processors/notify.processor.ts  # queue `notify`: report, telegram-poll
apps/worker/src/apply/memory.ts           # enabled filter, usage counting, conflict finding

apps/api/src/night/                       # settings, runs, SSE events
apps/api/src/control/                     # stop/resume/state (apply/stop alias)
apps/api/src/review/                      # review queue, estimate, reject/unreject
apps/api/src/memories/                    # list/patch/delete
apps/api/src/apply/apply.service.ts       # answers edit on ready, uses prepareApplication

apps/web/src/app/noite/page.tsx           # settings, next run, Rodar agora, runs list, live view
apps/web/src/app/revisao/page.tsx         # grouped queue, batch approve with estimate, reject, inline answers
apps/web/src/app/memoria/page.tsx         # memories
apps/web/src/components/control/*         # global header: Parar tudo / Retomar / Pausado badge
```

**Structure Decision**: same layering as F2–F5 — pure decisions in `packages/jobs` / `packages/apply`,
shared DB helpers in `packages/db` (so the api and the night tick create applications the same way),
orchestration and I/O in the worker, REST/SSE in the api, screens in web.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New table `NightRun` | A night spans discovery, preparation and submission and needs its own status, phase, budget, counters and report | `DiscoveryRun` is one discovery flow (also daily F2 runs); overloading it mixes two lifecycles |
| New queue `night` | The tick must never wait behind long `score`/`apply` jobs (stop and window end must be timely) | Putting `night-tick` on `score` would delay it for the full duration of a discovery fan-in |
