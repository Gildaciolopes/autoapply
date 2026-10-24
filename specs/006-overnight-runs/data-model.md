# Data Model: Overnight Runs (F6)

One migration `night_runs`. Enum adds use `ADD VALUE IF NOT EXISTS`.

## New: `NightRun`

| Field | Type | Notes |
|---|---|---|
| id | String cuid | |
| trigger | `NightTrigger` (`schedule`, `manual`) | |
| scheduleKey | String? **@unique** | night date `YYYY-MM-DD` (São Paulo, date of window start) for scheduled runs; also set on a manual run that absorbed a scheduled night; null otherwise. Guarantees one scheduled run per night (FR-002). |
| nightDate | String | local date of the window start (manual: today) |
| status | `NightStatus` (`running`, `ok`, `partial`, `failed`, `stopped`, `skipped`, `missed`) | final ≠ running |
| phase | `NightPhase` (`discovering`, `preparing`, `waiting`, `finishing`, `done`) | state machine (research R1) |
| windowEnd | DateTime? | null for manual runs |
| budget | Int | snapshot of `nightBudget` |
| discoveryRunId | String? | linked `DiscoveryRun` |
| stepErrors | Json `[]` | `{ step, message, at }[]` |
| counters | Json `{}` | `NightCounters` (shared) |
| pending | Json `[]` | application ids left at window end |
| report | Json? | `NightReport` (shared) built at finish |
| reportStatus | `ReportStatus` (`pending`, `sent`, `not_sent`, `not_configured`) | default `pending` |
| reportError | String? | |
| reportSentAt | DateTime? | |
| startedAt / finishedAt | DateTime / DateTime? | |

Index: `(status)`, `(startedAt)`. Relations: `applications Application[]`, `events RunEvent[]`.

Validation: at most one `running` (checked in a transaction before create); `budget` 1–40.

## Changed: `SearchPreference`

- **Removed**: `scheduleCron` (never used by code; replaced by an explicit window).
- **Added**: `nightEnabled Boolean @default(false)`, `nightStart String @default("23:00")`,
  `nightEnd String @default("06:59")` (`HH:MM`, 24h; end < start = crosses midnight; equal = invalid),
  `nightDays Int[] @default([0,1,2,3,4,5,6])` (non-empty, 0=Sunday), `nightBudget Int @default(20)`
  (1–40), `pausedAt DateTime?` (kill switch, global), `nightLastTickAt DateTime?`,
  `telegramOffset Int @default(0)`.

## Changed: `Application`

- `nightRunId String?` → `NightRun` (run of origin; `onDelete: SetNull`), index.
- `rejectedAt DateTime?`, `rejectReason String?` (1–300 chars).
- `ApplicationStatus` + `rejected`.
- New `NeedsReasonCode` values: `window_end` (left at window end, eligible next night), `cancelled`
  (exists).

## Changed: `RunEvent`

- `seq Int @default(autoincrement()) @unique` — monotonic order and SSE event id.
- `nightRunId String?` → `NightRun` (`onDelete: Cascade`), index `(nightRunId, seq)`.

## Changed: `AnswerMemory`

- `enabled Boolean @default(true)`, `lastUsedAt DateTime?`, `origin String @default("needs_input")`
  (`needs_input | inline | edit`). Existing rows: `origin = needs_input`.
- Reuse requires `approved AND enabled`.

## Shared types (`packages/shared/src/night.ts`)

- `NightSettings` / `NightSettingsBody` (enabled, start, end, days, budget) with the validation above.
- `NightCounters`: `found, aboveThreshold, prepared, ready, needsInput, failed, submitted,
  uncertain, waitingLimit, windowEnd`.
- `NightReport`: `{ alerts: { kind: 'session_expired'|'platform_paused'|'stopped'|'failed'|'missed'|'nothing_new', message }[], counters, top: { title, company, score }[], link }`.
- `NightRunView`, `NightRunListItem`, `RunEventView { seq, at, level, step, message, applicationId? }`.
- `ReviewQueue { groups: Record<ReviewGroup, ReviewItem[]>, counts, run? }`, `ReviewItem`, `RejectBody`,
  `SendEstimate`.
- `MemoryView`, `MemoryPatchBody { answer?, enabled? }`.
- `ControlState { paused, pausedAt?, running?: NightRunListItem, next?: { start, end } }`.
- Queue payloads: `NightTickPayload {}`, `ReportPayload { nightRunId }`.

## State transitions

```
NightRun:  running(discovering → preparing → waiting → finishing) → ok | partial | failed
           running → stopped (kill switch, any phase)
           (no run) → skipped (paused at window start) | missed (no tick inside the window)

Application (F6 additions):
  ready | needs_input | failed → rejected (user) ; rejected → queued (undo → re-prepare)
  queued/applying (night) → skipped[window_end] at window end → queued (next night)
  ready → queued (answer edited before approval → re-prepare)
```
