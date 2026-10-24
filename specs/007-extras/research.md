# Research: Extras (F7)

## R1. Funnel definition (analytics)

**Decision**: cohort funnel. The cohort is the jobs whose `Job.firstSeenAt` falls in the period
(default 8 weeks, max 52); each stage is reached when its timestamp/flag exists, whatever the current
status (FR-005):

| Stage | Reached when |
|---|---|
| found | job in cohort (`hidden` included: hidden after discovery still counts as found) |
| above threshold | `JobScore.passed AND score ≥ SearchPreference.scoreThreshold` (current threshold) |
| prepared | `Application.preparedAt IS NOT NULL` (new; set when the engine first ends in `ready`/`needs_input`) |
| approved | `Application.approvedAt IS NOT NULL OR submittedAt IS NOT NULL` |
| submitted | `Application.submittedAt IS NOT NULL` |
| replied | `Application.firstReplyAt IS NOT NULL` (new; excludes automatic confirmations) |
| interview | `Application.interviewAt IS NOT NULL` (new; first interview-invite reply) |

Stages are **cumulative** (implementation note): an item that reached a later stage also counts in
every earlier one (e.g. an application submitted by hand without a prepare run, or a manual reply on an
`already_applied` job), so no conversion exceeds 100%.

Splits: **source** = `Job.source.type` (first source that found it, so every job is in exactly one
bucket and splits add up); **platform** = `Application.platform` (jobs without application → bucket
`none`); **week** = ISO week (Monday) of `firstSeenAt` in America/Sao_Paulo. One SQL query per split
with `COUNT(*) FILTER (WHERE ...)` grouped by the split key (`packages/db/src/analytics.ts`); totals
are the sum of buckets. Rates, median time to reply and reply-type shares are pure helpers in
`packages/jobs/src/analytics.ts` (`funnelRates`, `median`, `share`; division by zero → `null`, shown
"—"). Top missing skills: `unnest(JobScore.missing)` over cohort jobs above threshold, normalized
with `findSkillByAlias` (canonical label when known, else lowercased text), top 10.

**Rationale**: a cohort keeps conversions meaningful (a job found in week 1 and submitted in week 3
counts in week 1's funnel) and guarantees that splits add up (FR-003). Computing on demand keeps one
source of truth; SC-001 (≤ 2 s on 10k jobs) is met by indexes on `Job.firstSeenAt` (added) and the
existing `jobId` uniques.

**Backfill**: migration sets `preparedAt = COALESCE(lastRunAt, updatedAt)` for applications whose
status is past preparation (`ready, needs_input, approved, submitting, submitted, submit_uncertain,
already_applied, rejected`).

**Alternatives**: event-date funnel (each stage counted in the week it happened; conversions across
weeks become > 100%); materialized daily snapshots (extra job + table for a single user, YAGNI).

## R2. Gmail access: OAuth without a new dependency

**Decision**: OAuth 2.0 for installed apps with PKCE and a loopback redirect, done by the API:
`GET /mail/connect` → 302 to `accounts.google.com/o/oauth2/v2/auth` (`scope =
https://www.googleapis.com/auth/gmail.readonly`, `access_type=offline`, `prompt=consent`,
`code_challenge` S256, `state`), redirect URI `http://127.0.0.1:<API_PORT>/mail/oauth/callback`. The
user signs in and consents in their own browser (we never see the password). The callback exchanges
the code at `oauth2.googleapis.com/token`, reads the address with `users/me/profile`, stores
`{ refresh_token, access_token, expiry }` encrypted (AES-256-GCM, `SESSION_ENCRYPTION_KEY`, same
helper as F5 sessions, moved to `packages/db/src/secret.ts` so api and worker share it). PKCE
verifier + state live in a `MailAccount.pendingState` column for 10 min. The user creates their own
Google Cloud "Desktop app" OAuth client and sets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`
(the app stays in "testing" mode with the user as test user: no verification needed for a personal
project). Disconnect → `POST oauth2.googleapis.com/revoke` + delete tokens.

Transport `packages/jobs/src/gmail.ts` (fetch injected, like `telegram.ts`): `refreshAccessToken`,
`listMessages(q, pageToken)`, `getMessage(id, 'full')`, `revoke`, `GmailError` with `auth` kind on
401/`invalid_grant` (→ status `expired`, FR-018). No `googleapis` package (huge, one REST surface
used).

**Rationale**: `gmail.readonly` is the narrowest scope that can read bodies; it cannot send, modify,
label or delete, which makes FR-016/SC-004 true by construction. Loopback + PKCE is Google's
recommended flow for desktop apps and needs no public URL.

**Alternatives**: IMAP with app password (requires typing/storing a password — forbidden by our
rules; also full mailbox write access); `gmail.metadata` (no bodies: cannot classify);
`googleapis` SDK (heavy dependency for 4 calls).

## R3. Mail check: query, idempotency, privacy

- Scheduler `mail-check` every 30 min on new queue `mail` (only while `MailAccount.status =
  connected`; the processor no-ops otherwise).
- Query: `in:inbox -from:me after:<epoch>` where epoch = `max(lastCheckAt − 1 day, oldest
  submittedAt within tracking period)`; tracking period 120 days. Pages of 50; max 200 messages per
  check (rest next check).
- Idempotency: `ProcessedMail(messageId @unique, outcome, at)` records every message looked at
  (matched or not) — **only the Gmail message id and outcome**, no content (FR-009, FR-017). Kept 180
  days.
- Body handling: `text/plain` part (else HTML stripped to text), first 4,000 chars, kept in memory
  only for match + classification; stored excerpt ≤ 300 chars (FR-012). Attachments never fetched.
- Gmail link: `https://mail.google.com/mail/u/0/#all/<messageId>`.
- LLM down → the message is not marked processed when it matched (no `ProcessedMail` row), so it is
  retried next check; unmatched messages are marked immediately (no LLM needed).

## R4. Matching an email to an application

Pure `matchReply(mail, candidates)` in `packages/jobs/src/replies.ts`. Candidates = applications
`submitted | submit_uncertain` with `submittedAt` within 120 days, plus `already_applied`. Signals and
weights:

| Signal | Weight |
|---|---|
| company legal name **or ATS slug** (brand, e.g. `Nu Pagamentos S.A.` / `nubank`), normalized, ≥ 3 chars, in sender display name, sender domain label (non-platform senders) or subject | 0.5 |
| company name in body excerpt | 0.25 |
| sender domain is a known recruiting platform (`gupy.io`, `greenhouse.io`, `lever.co`, `ashbyhq.com`, `linkedin.com`, `myworkdayjobs.com`, `inhire.app`, `kenoby.com`, …) AND the company is mentioned | 0.2 |
| share of the job title's tokens present in subject/body (containment ≥ 0.6) | 0.3 |
| email date after submittedAt | required |

Score ≥ 0.6 → matched; best candidate wins; if the runner-up is within 0.15 or two candidates share
the company → `needsReview = true` ("verificar", FR-014). Below 0.6 → unmatched (discarded). LinkedIn
notification emails (`jobs-noreply@linkedin.com` etc.) that are not about an application status are
filtered out by sender list before matching.

**Rationale**: deterministic and testable with fixtures; most recruiting emails carry the company
name and/or job title. Manual linking covers the rest. Measured by SC-002 eval.

## R5. Classifying a reply locally

1. Deterministic hints (pt/en keyword sets on subject + first 1,000 chars): confirmation ("recebemos
   sua candidatura", "application received", "thank you for applying"), rejection ("infelizmente",
   "não seguiremos", "unfortunately", "other candidates"), interview ("entrevista", "bate-papo",
   "agendar", "interview", "schedule a call", calendar links), info request ("teste técnico",
   "desafio", "preencha", "documentos", "could you send").
2. LLM (`qwen3:8b`, `think:false`, Zod schema `{ type, confidence }`) with the email inside
   `<email>` tags and an instruction that its content is data, never instructions (FR-011). Prompt
   receives subject, sender and the 4,000-char text; output enum only (no free text stored).
3. Combine: if hints and LLM agree → LLM confidence; disagree → `needsReview`, type = LLM's, confidence
   min(0.5, llm). Confidence < 0.7 → `needsReview`.
4. Prompt injection cannot do more than pick one of five enum values; the user can always correct.

Eval: `make replies-eval` — 30 synthetic labelled emails (pt/en, 6 per type + 6 unrelated, including
2 with injection text) against the live LLM; reports link accuracy and type accuracy; stores `EvalRun`
suite `replies` (SC-002). Tests use `FakeLlmProvider` with recorded outputs.

**Alternatives**: keywords only (misses most real phrasing); LLM only (no defense in depth, worse on
confirmations).

## R6. Reply effects on the application

- New `Reply` rows; `Application` gains `outcome` (`none | replied | interview | declined`),
  `firstReplyAt`, `interviewAt`, `lastReplyAt`. `Application.status` is **not** changed (it describes
  the apply pipeline; `rejected` already means "rejected by the user"). Exception: a reply to a
  `submit_uncertain` application sets status `submitted` with `submittedVia = 'confirmed_by_reply'`
  (edge case "incerta").
- Outcome recomputed from all non-deleted replies by `latest` rule: last reply by `receivedAt` among
  `interview | rejection | info_request | other` decides (`interview → interview`, `rejection →
  declined`, else `replied`); confirmations never change outcome. `firstReplyAt` = earliest
  non-confirmation reply; `interviewAt` = earliest interview reply.
- User corrections set `Reply.userEdited = true`; the mail check never updates such rows (it only
  inserts new message ids).
- Each reply writes a RunEvent (`applicationId`, step `reply`).

## R7. MCP server inside the API

**Decision**: Streamable HTTP MCP endpoint served by the existing API at `http://127.0.0.1:3001/mcp`
(module `apps/api/src/mcp/`), using `@modelcontextprotocol/sdk` (already a repo dependency in the
worker; added to the api). Stateful transport (`sessionIdGenerator: randomUUID`) so the
preview/confirm pair is bound to one MCP session. Local only, three layers: API already binds
`API_HOST=127.0.0.1`; the controller rejects any `req.socket.remoteAddress` not loopback (403); the
SDK's DNS-rebinding protection with `allowedHosts = ['127.0.0.1:<port>', 'localhost:<port>']` and
no `Origin` other than none/the web origin.

Tools call the same Nest services the REST controllers use (`FeedService`, `ApplyService`,
`ReviewService`, `NightService`, `ControlService`, new `AnalyticsService`), so results match the web
(SC-005). Client setup: Claude Code `claude mcp add --transport http autoapply
http://127.0.0.1:3001/mcp`; Claude Desktop via its remote/`mcp-remote` bridge (documented in
quickstart).

**Rationale**: no new service or process (constitution §V), single source of business logic, the
API is already up whenever AutoApply runs.

**Alternatives**: separate `apps/mcp` stdio process talking to the DB (duplicates services, a new
app to run and keep in sync); stdio server spawned by the assistant that proxies to REST (extra
package, still needs the API up; can be added later if a client lacks HTTP support).

## R8. Safe actions over MCP

- `stop_everything` → `ControlService` stop (F6 `stopEverything`) with RunEvent origin
  `assistant`; always enabled (FR-023).
- `approve_applications({ ids })` (1–10 ids, schema rejects anything else; there is no filter
  parameter at all): refuses when `SearchPreference.mcpApproveEnabled = false` (default) or paused;
  otherwise creates an `ApprovalPreview { id, mcpSessionId, items: [{ applicationId, fingerprint }],
  expiresAt = now+10min }` and returns `{ previewId, items: [{ id, title, company, platform, status,
  ok, reason? }], estimate }` — approves nothing.
- `confirm_approval({ previewId })`: same MCP session, not expired, not used (`confirmedAt` set with
  compare-and-set); re-checks each item is still `ready` and its `approvalFingerprint` equals the
  preview's (else refused per item); then calls `ApplyService.approve(id)` per item (same F5 path,
  same `approvalHash`). Returns approved/refused.
- Every state-changing call writes a RunEvent `{ step: 'assistant', data: { origin: 'assistant',
  tool } }` (FR-026).
- Untrusted content (job descriptions, reply excerpts) is returned in a separate text block wrapped in
  `<untrusted source="job_posting">…</untrusted>` with a one-line warning (FR-021). No tool returns
  sessions, tokens, `sentValues`, resume files or contact facts (FR-022): views are built from
  explicit field lists.

## R9. Night report and alerts

`NightAlertKind` gains `mail_expired` ("reconectar Gmail"), added by `buildNightReport` when
`MailAccount.status = expired`. The report gains one counter line: replies received during the night
window (count by type, no sender/subject — no PII).
