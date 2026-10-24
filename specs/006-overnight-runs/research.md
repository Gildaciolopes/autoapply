# Research: Overnight Runs (F6)

## R1. Night orchestration: tick-driven state machine

**Decision**: one BullMQ job scheduler `night-tick` (every minute, `tz: America/Sao_Paulo`) on a new
queue `night` (concurrency 1). Each tick is short and idempotent: it reads `SearchPreference` + the
current `NightRun` and advances one phase:

| Phase | Tick does | Next when |
|---|---|---|
| (none) | inside window, enabled, not paused, no run for this night → create `NightRun` (`scheduleKey = night date`), start a discovery flow (`startDiscoveryFlow`, trigger `schedule`), link `discoveryRunId` | created |
| `discovering` | wait for `DiscoveryRun.status ∈ {done, failed}` (failed → step error, run will be `partial`) | discovery finished |
| `preparing` | select jobs (R4) up to the remaining nightly budget, create/reset `Application` (`nightRunId`), enqueue `apply` (F4 engine tailors inline, F5 gate applies caps/interval) | no application of the run is `queued/tailoring/applying` |
| `waiting` | nothing new starts; approved submissions keep flowing through the existing F5 `submit` jobs | window end (manual run: immediately) |
| `finishing` | window end or done: remove this run's waiting/delayed `apply` jobs (apps → `skipped`, reason `window_end`), compute counters, build report, enqueue `notify` `report` job (`jobId = report-<runId>`) | — |

Final status: `ok` (no step error), `partial` (≥1 step error or window_end leftovers), `failed`
(discovery and preparation both failed), `stopped` (kill switch), `skipped` (paused at window start),
`missed` (R3).

**Rationale**: a long-running orchestrator job that waits on other queues would hold the queue for
hours, block on restarts and fight BullMQ stall detection. Ticks survive restarts for free (state is
in Postgres), stay under a second, and make every transition testable by calling `tick(now)` with a
fake clock.

**Alternatives**: BullMQ flow with all steps as children (flows cannot express "select jobs after
scoring", budgets or window end); cron at window start only (no restart recovery, no window-end
handling); keep `scheduleCron` (a repeating cron is not a window: "end" and "missed" are not
expressible).

## R2. Window instead of `scheduleCron`

**Decision**: replace `SearchPreference.scheduleCron` with `nightEnabled` (default false),
`nightStart` "23:00", `nightEnd` "06:59", `nightDays Int[]` (0=Sun..6, default all), `nightBudget`
(default 20, max 40). Pure helper `nightWindow(now, prefs)` in `packages/jobs` returns the window that
contains `now` (or the last one) with `nightDate` = local date of the window start (a window crossing
midnight belongs to the night it started). Uses `Intl` with `America/Sao_Paulo` (no DST in Brazil
since 2019, but computed via Intl anyway).

`autoDiscover/discoveryCron` (F2 daily discovery) stays; when the night is enabled the UI hints that
both may overlap, and the night tick reuses an F2 scheduled run of the same local date if one is
running (no second discovery).

## R3. Idempotency, restarts, missed nights

- `NightRun.scheduleKey String? @unique` = night date for scheduled runs (manual runs: null). A second
  tick or duplicate trigger hits the unique constraint → no second run (FR-002).
- Only one run `running` at a time: tick and "Rodar agora" both check `status = running` first;
  window start during a manual run → the scheduled night is recorded as merged
  (`scheduleKey` set on the manual run).
- `SearchPreference.nightLastTickAt`: if the previous window ended, the night was enabled and no tick
  happened inside it (machine off/asleep), the first tick after records a `missed` run for that night
  (reported, never recovered). If the system comes back inside the window, the run starts normally.

## R4. Job selection for the night

Jobs with `hidden = false`, `score.passed`, `score.score ≥ scoreThreshold`, a usable apply URL, and
either no `Application` or an `Application` in `skipped` with reason `window_end` (left over from a
previous night). Never: rejected, submitted, uncertain, already applied, needs_input/ready (already
prepared, waiting for the user), cancelled by the kill switch. Ordered by score desc, `take =
nightBudget − prepared this night`. Platform caps/interval/backoff are enforced by the existing F5
`platformGate` in the `apply` processor (gated jobs are re-added with delay); LinkedIn opt-in applies.
Tailoring happens inside the F4 engine (it already tailors when no current resume document exists).

## R5. Kill switch, global

**Decision**: `POST /control/stop` (the F4/F5 `POST /apply/stop` becomes an alias): sets
`SearchPreference.pausedAt`, removes waiting/delayed jobs in `discover`, `discover-jobspy`, `tailor`,
`apply` (incl. `submit`), cancels approvals (F5), marks the running `NightRun` `stopped`, writes a
RunEvent. In-flight steps abort at their next safe point: the F4 engine already checks the application
status between steps (`Cancelled`), submit aborts at its compare-and-set (F5), the night tick refuses
to advance while paused, and `process-run` results arriving after a stop are kept (they are
discovery data, no platform action) but nothing is prepared from them. `POST /control/resume` clears
`pausedAt`; nothing restarts (FR-015). The paused state is shown in the global header.

## R6. Telegram report and commands

- Transport: `packages/jobs/src/telegram.ts` (fetch injected; shared by the api "Testar Telegram" and the worker).
- Send: `notify` queue, job `report` with `jobId report-<runId>` (exactly once), `attempts: 5`,
  exponential backoff. `fetch('https://api.telegram.org/bot<token>/sendMessage')`, plain text, no
  parse mode (no injection through job titles). Not configured → `reportStatus = not_configured`.
  Final failure → `not_sent` with error; run unaffected.
- Content (pure `buildReport(counters)` in `packages/jobs`): alerts first (expired sessions, paused
  platforms, run stopped/failed/missed), then counts (found, above threshold, prepared ready, needs
  input, failed, submitted, waiting for limit), top 5 ready as "Título — Empresa (score)", link
  `WEB_ORIGIN/revisao?run=<id>` (default `http://localhost:3000`). No contact data, salary, answers, file names. A test asserts the message
  contains none of the persona's PII.
- Commands: scheduler `telegram-poll` every 30 s (only when configured) does `getUpdates` with
  `timeout: 20` and stored offset (`SearchPreference.telegramOffset`). Accepts `parar`, `retomar`,
  `status` (also `/stop`, `/resume`, `/status`) only when `message.chat.id == TELEGRAM_CHAT_ID`;
  everything else is ignored (offset still advances). No webhook (the app is local, no public URL).

**Alternatives**: webhook (needs a public endpoint); a Telegram SDK (one `fetch` is enough, no new
dependency).

## R7. Live log via SSE

- `RunEvent` gains `seq Int @default(autoincrement())` (monotonic order + SSE id) and `nightRunId`.
- Night orchestrator events carry `nightRunId`; apply/submit events keep `applicationId`; the stream
  query is `nightRunId = X OR application.nightRunId = X`, ordered by `seq`.
- `GET /runs/:id/events` (`@Sse`): replays all events with `seq > Last-Event-ID` (header or `?after=`),
  then polls the DB every 1 s (single user; no Redis pub/sub needed), sends `event: end` when the run
  is final. Reconnect resumes from the last id → no gaps, no duplicates (FR-025). SC-007 ≤ 5 s.
- Web uses the browser `EventSource` against `API_URL` (CORS already allows the web origin).

## R8. Answer memory learning loop

- Already (F4): needs-input answers create/update an approved memory (`source: 'user'`).
- F6 adds:
  - `AnswerMemory.enabled` (default true), `lastUsedAt`, `origin` (`needs_input | inline | edit`), and
    `source` stays; only user-touched answers become memories (FR-020).
  - Edit before approval: `POST /applications/:id/answers` accepts edits to any non-file field of a
    `ready` application (not only blocking ones); edited fields get source `usuário`, the memory is
    written with origin `edit`, and the application is re-prepared (status back to `queued`) so the
    approval hash covers the new answers (FR-012).
  - Reuse counts: when the engine fills an answer from memory it increments `usedCount` and sets
    `lastUsedAt` (by memory id; `MemoryCandidate` gains `id`).
  - Lookups filter `approved AND enabled` (exact and vector).
  - Fact over memory (FR-022): planAnswers order already puts deterministic fact answers before
    memory; F6 adds a pure `memoryConflict(fieldAnswer, memoryCandidates)` check that attaches a
    finding "memória divergente do fato" to the answer (shown in the review item and the memory list)
    when a matching memory disagrees with a fact-sourced answer.
- Management: `GET/PATCH/DELETE /memories` + web `/memoria` (search, edit, enable/disable, delete,
  uses, last use). Editing a memory resets its embedding (re-embedded by the worker).

## R9. Review queue

- `GET /review?run=` returns groups `ready | needs_input | failed | submit_uncertain | waiting_limit |
  approved` with counts, ordered by score, each item with job, company, score, platform, run of origin,
  answers summary (low-confidence count), tailored doc link.
- Batch approve reuses F5 `approveBatch` (same `approvalHash` guarantee); the confirmation summary
  shows count per platform and an estimate: per platform, `ceil(n / remaining cap today)` days and
  `n × minInterval` minutes (pure helper `sendEstimate`).
- Reject: `POST /applications/:id/reject { reason }` → new status `rejected`, `rejectReason`,
  `rejectedAt`; excluded from R4 forever; undo allowed (back to `ready` with a new prepare).
- `waiting_limit` = `approved` with a gate reason in `needsReasons` (F5 already writes it).

## R10. Autopilot

Out of scope. Approve keeps refusing `mode = autopilot` (message updated: "autopilot não disponível;
use o modo revisão"); the night never approves anything.
