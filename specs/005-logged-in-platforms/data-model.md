# Data Model: Logged-in Platforms and Assisted Real Submission (F5)

Migration `platforms_submit`.

## Platform (new)

| Field | Type | Notes |
|---|---|---|
| kind | String @id | `gupy, linkedin, greenhouse, lever, ashby, generic` (R1) |
| sessionEnc | String? | AES-256-GCM `v1:iv:tag:data` of Playwright storageState (gupy/linkedin only) |
| sessionStatus | String `"disconnected"` | `disconnected, connecting, connected, expired` |
| accountLabel | String? | name shown after login, when visible |
| connectedAt / lastTestAt | DateTime? | |
| lastTestOk | Boolean? | |
| connectRequest | String? | `done` / `cancel` set by the UI during a connect flow |
| optInAt | DateTime? | LinkedIn ToS acknowledgement (required before connect) |
| submitCap / simulateCap | Int | defaults per kind (R1); `submitCap ≤ submitMax` |
| submitMax | Int | safe maximum (gupy 40, linkedin 15, others 50) |
| minIntervalSec | Int | 60 gupy, 180 linkedin, 30 others |
| lastActionAt | DateTime? | interval enforcement |
| pausedUntil | DateTime? | backoff |
| pauseReason | String? | `errors`, `unusual_activity`, `manual` |
| backoffLevel | Int `0` | 0 → 1 h → 4 h → manual |
| consecutiveErrors | Int `0` | |
| updatedAt | DateTime @updatedAt | |

## Application (extended)

| Field | Type | Notes |
|---|---|---|
| platform | String? | platform kind used (detected ATS or gupy/linkedin) |
| approvedAt | DateTime? | cleared by re-simulation / kill switch |
| approvalHash | String? | R4 |
| submittedVia | String? | `auto`, `assisted` |
| sentValues | Json? | `[{ fieldKey, question, value }]` exactly as filled at submit |
| submitError | String? | |

`ApplicationStatus` gains `approved, submitting, submit_uncertain, already_applied`.
Lifecycle: `ready → approved → submitting → submitted | submit_uncertain`; `approved → needs_input`
(`form_changed`, `new_step`, `human_check`, `session_expired`); `approved → ready` (kill switch);
`submit_uncertain → submitted | ready` only by the user's explicit mark.

`NeedsReasonCode` gains `session_expired, already_applied, platform_action, unusual_activity,
form_changed, new_step, human_check, platform_paused`.

## Artifact

New types `screenshot_filled_submit` (`submit-filled`), `screenshot_confirmation` (`confirmation`).

## SearchPreference

Remove `applyDailyCap` (moved to `Platform`). `mode` (`dry_run | review | autopilot`) gates approval:
approval only in `review` (autopilot = F6).
