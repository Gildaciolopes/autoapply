# Queue `apply` — new job names

All on the existing `apply` queue (concurrency 1 → one platform action at a time).

| Job | Payload | Notes |
|---|---|---|
| `apply` (F4) | `ApplyPayload` | now gated by `platformGate(kind, 'simulate')` and uses the platform session |
| `submit` | `SubmitPayload { applicationId, approvalHash }` | attempts 1 (never retried); gated by `platformGate(kind, 'submit')`; R5 |
| `connect-session` | `SessionJobPayload { kind }` | headed window, waits ≤ 10 min (R2) |
| `test-session` | `SessionJobPayload { kind }` | headless, read-only |

Every step emits `RunEvent(queue:'apply', applicationId?)`.
