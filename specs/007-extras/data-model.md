# Data Model: Extras (F7)

One migration `extras`. Enum adds use `ADD VALUE IF NOT EXISTS`.

## New: `MailAccount` (single row)

| Field | Type | Notes |
|---|---|---|
| id | String cuid | |
| email | String? | address from Gmail profile, shown in UI only |
| status | `MailStatus` (`disconnected`, `connected`, `expired`) | default `disconnected` |
| tokensEnc | String? | AES-256-GCM (`v1:` format) of `{ refreshToken, accessToken, expiresAt }`; null when disconnected |
| pendingState | Json? | `{ state, verifier, expiresAt }` during the OAuth round trip (10 min) |
| connectedAt / lastCheckAt | DateTime? | |
| lastError | String? | short, never a token |
| updatedAt | DateTime @updatedAt | |

Validation: at most one row (service upserts a fixed id `default`).

## New: `ProcessedMail`

| Field | Type | Notes |
|---|---|---|
| messageId | String **@id** | Gmail message id — idempotency (FR-017) |
| outcome | String | `matched | unmatched | filtered` |
| at | DateTime @default(now()) | rows older than 180 days pruned by the mail check |

No content columns (FR-009).

## New: `Reply`

| Field | Type | Notes |
|---|---|---|
| id | String cuid | |
| applicationId | String → `Application` (`onDelete: Cascade`) | index `(applicationId, receivedAt)` |
| origin | `ReplyOrigin` (`email`, `manual`) | |
| messageId | String? **@unique** | Gmail id when origin=email |
| type | `ReplyType` (`interview`, `rejection`, `info_request`, `confirmation`, `other`) | |
| confidence | Float? | null for manual |
| needsReview | Boolean @default(false) | "verificar" (FR-014) |
| userEdited | Boolean @default(false) | mail check never updates such rows |
| receivedAt | DateTime | |
| sender | String? | `Name <address>` (local only) |
| subject | String? | ≤ 200 chars |
| excerpt | String? | ≤ 300 chars (FR-012) |
| note | String? | manual note ≤ 500 chars |
| link | String? | Gmail web link |
| createdAt / updatedAt | DateTime | |

## New: `ApprovalPreview`

| Field | Type | Notes |
|---|---|---|
| id | String cuid | returned as `previewId` |
| mcpSessionId | String | confirm must come from the same MCP session |
| items | Json | `{ applicationId, fingerprint }[]` (1–10) |
| expiresAt | DateTime | now + 10 min |
| confirmedAt | DateTime? | compare-and-set: confirmed once |
| createdAt | DateTime | |

## Changed: `Application`

- `preparedAt DateTime?` — set by the engine the first time it ends in `ready` or `needs_input`
  (never cleared). Backfill in the migration (research R1).
- `outcome ReplyOutcome @default(none)` (`none`, `replied`, `interview`, `declined`).
- `firstReplyAt DateTime?`, `interviewAt DateTime?`, `lastReplyAt DateTime?` — recomputed from
  replies (research R6).
- `replies Reply[]`. Index `(outcome)`.
- `submittedVia` gains value `confirmed_by_reply` (string column, no enum change).

## Changed: `Job`

- Index `(firstSeenAt)` for the cohort query.

## Changed: `SearchPreference`

- `mcpApproveEnabled Boolean @default(false)` (FR-024).

## Changed: `RunEvent`

- No schema change. Assistant actions: `data = { origin: 'assistant', tool }`. Reply events:
  `applicationId` set, message "resposta: <tipo>".

## Shared types

`packages/shared/src/analytics.ts`:
- `FunnelStage` = `found | above_threshold | prepared | approved | submitted | replied | interview`.
- `FunnelQuery { weeks (1–52, default 8), split?: 'source' | 'platform' | 'week' }`.
- `FunnelCounts = Record<FunnelStage, number>`; `FunnelView { from, to, threshold, totals:
  FunnelCounts, rates: Record<FunnelStage, number | null>, buckets?: { key, label, counts, rates }[],
  responseRate: number | null, medianDaysToReply: number | null, replyTypes: Record<ReplyType, number>,
  missingSkills: { skill, count }[] }`.

`packages/shared/src/replies.ts`:
- `ReplyType`, `ReplyOrigin`, `ReplyOutcome`, `MailStatus` enums.
- `ReplyView`, `ManualReplyBody { type, receivedAt, note? }`, `ReplyPatchBody { type?, applicationId?,
  needsReview? }`, `MailAccountView { status, email?, connectedAt?, lastCheckAt?, lastError?,
  configured: boolean }`.
- `MailCheckPayload {}` (queue `mail`).
- `ReplyClassification` (LLM output schema): `{ type: ReplyType, confidence: number 0–1 }`.

`packages/shared/src/night.ts`: `NightAlertKind` + `mail_expired`; `NightCounters` + optional
`replies` (by type).

## State transitions

```
MailAccount: disconnected → (connect, callback ok) connected → (401/invalid_grant) expired
             connected|expired → (disconnect) disconnected ; expired → (reconnect) connected

Reply effects (on Application, recomputed):
  outcome: none → replied | interview | declined  (latest non-confirmation reply decides)
  status:  submit_uncertain → submitted (any reply linked; submittedVia = confirmed_by_reply)

ApprovalPreview: created → confirmed (once, same session, before expiresAt) | expired
```
