# Queues — Overnight runs

| Queue | Job | Payload | Notes |
|---|---|---|---|
| `night` (new, concurrency 1) | `night-tick` | `NightTickPayload {}` | job scheduler `night-tick`, `pattern: '* * * * *'`, `tz: America/Sao_Paulo`, always registered by the worker at boot; idempotent state machine (research R1) |
| `night` | `start-manual` | `{ nightRunId }` | enqueued by `POST /night/runs`; starts discovery for a manual run (tick handles the rest) |
| `notify` (existing, unused until F6) | `report` | `ReportPayload { nightRunId }` | `jobId: report-<id>` (exactly once), attempts 5, exponential 60 s |
| `notify` | `telegram-poll` | `{}` | job scheduler every 30 s when `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set; `getUpdates` long poll 20 s; commands `parar`/`retomar`/`status` from the configured chat only |
| `score` | `start-run` / `process-run` (F2) | unchanged | the night starts discovery through `startDiscoveryFlow` (trigger `schedule`) |
| `apply` | `apply` / `submit` (F4/F5) | unchanged | applications carry `nightRunId`; F5 gate enforces caps |

RunEvents: night steps write `RunEvent { queue: 'night', nightRunId, data: { step } }`; apply/submit
events are linked through `Application.nightRunId`.
