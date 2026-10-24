# Implementation Plan: Extras (MCP server, reply tracking, analytics)

**Branch**: `007-extras` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-extras/spec.md`

## Summary

Three additions on top of F1–F6, no new service:

1. **Analytics**: a cohort funnel (jobs found in the period → above threshold → prepared → approved →
   submitted → replied → interview) computed on demand with one aggregate SQL per split
   (source / platform / week), plus response rate, median time to reply, reply types and top missing
   skills. New stage timestamps on `Application` (`preparedAt`, `firstReplyAt`, `interviewAt`).
2. **Reply tracking**: the user connects Gmail with read-only OAuth (PKCE, loopback redirect, their
   own Google client); a `mail-check` job every 30 min on a new `mail` queue lists new inbox messages,
   matches them deterministically to submitted applications, classifies matched ones locally (keyword
   hints + qwen3 enum output), and stores a `Reply` with a ≤ 300-char excerpt. Unmatched messages
   leave only their id. Outcome (`replied / interview / declined`) is recomputed from replies; users
   correct, relink or add manual replies. Nothing is ever written to the mailbox.
3. **MCP server**: a Streamable HTTP MCP endpoint inside the API (`/mcp`, loopback only) exposing
   read tools backed by the same Nest services as the web, `stop_everything` (F6 kill switch) and an
   opt-in, two-step `approve_applications` → `confirm_approval` that only approves 1–10 named
   applications through the F5 approval path.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, Node ≥ 22).

**Primary Dependencies**: NestJS 12, BullMQ 6 (new queue `mail`), Prisma 7, Zod 4, Next.js 16,
`@modelcontextprotocol/sdk` ^1.32 (already in the worker; added to the api), `fetch` to Google OAuth
and Gmail REST. No new third-party package for the repo.

**Storage**: PostgreSQL (`MailAccount`, `ProcessedMail`, `Reply`, `ApprovalPreview`; extended
`Application`, `SearchPreference`; index on `Job.firstSeenAt`).

**Testing**: Vitest — pure funnel rates/median, reply matching, hint classifier, outcome recompute,
Gmail MIME text extraction; mail check on `autoapply_test` with fake Gmail `fetch` and
`FakeLlmProvider`; analytics SQL on seeded cohorts (splits add up); API mail OAuth state handling
with fake token endpoint; MCP tools through the SDK `Client` + `StreamableHTTPClientTransport` against
the Nest app (read results equal REST, approve preview/confirm rules, other-session refusal,
non-loopback refusal). New `make replies-eval` on the live LLM. Zero calls to Google in tests.

**Target Platform**: the user's Mac.

**Project Type**: web application (monorepo).

**Performance Goals**: funnel ≤ 2 s on 10k jobs (SC-001); reply visible ≤ 35 min (SC-003); MCP read
tools ≤ 1 s.

**Constraints**: read-only Gmail scope; no email content stored beyond excerpt for matched replies;
classification local only; MCP loopback only; assistant approval off by default, named ids only,
preview + confirm; kill switch always available.

**Scale/Scope**: single user; ≤ 200 emails per check; ≤ 1,000 applications per year.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | No new generated claims. Reply classification outputs only an enum + confidence (no text sent anywhere). MCP tools return stored data only. | PASS |
| II. Human in the Loop | Assistant approve is off by default, takes explicit ids (1–10), requires a preview and a confirming second call in the same session, uses the F5 approve path (`approvalHash`), refused while paused. Stop always works. Replies never trigger submissions. | PASS |
| III. Respect Platforms | No new platform automation; approved items still go through F5 caps/interval/concurrency. Gmail read-only via the official API. | PASS |
| IV. Local-First AI | Email classification on Ollama only; emails and excerpts stay in the local DB; Google is only the mailbox provider the user already uses. | PASS |
| V. Typed Contracts, Simple Services | Schemas in `packages/shared` (`analytics.ts`, `replies.ts`); MCP lives in the API (no new service); one new queue justified below; no new package. | PASS |
| VI. Testable and Observable | Matching/classification/funnel are pure and fixture-tested; mail check with fake transport; eval for SC-002; RunEvents for replies and assistant actions. | PASS |

Post-design re-check: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/007-extras/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ (rest-api.md, mcp-tools.md, queues.md)
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/analytics.ts          # FunnelStage, FunnelQuery, FunnelView
packages/shared/src/replies.ts            # ReplyType/Origin/Outcome, MailStatus, views, bodies, ReplyClassification
packages/shared/src/night.ts              # + mail_expired alert, replies counter
packages/shared/src/queues.ts             # + QUEUES.mail
packages/jobs/src/analytics.ts            # pure: funnelRates, median, share, weekKey
packages/jobs/src/replies.ts              # pure: matchReply, replyHints, combineClassification, recomputeOutcome, isPlatformNoise
packages/jobs/src/gmail.ts                # transport: authUrl (PKCE), exchangeCode, refreshAccessToken, listMessages, getMessage, revoke, extractText, GmailError
packages/db/prisma/schema.prisma          # MailAccount, ProcessedMail, Reply, ApprovalPreview, Application/SearchPreference/Job changes
packages/db/src/secret.ts                 # encryptSecret/decryptSecret (moved from worker session-crypto; worker re-exports)
packages/db/src/analytics.ts              # funnelQuery(db, query, now) — aggregate SQL per split + missing skills
packages/db/src/replies.ts                # applyReplyEffects(db, applicationId) — recompute outcome/timestamps, confirm uncertain

apps/worker/src/mail/check.ts             # mailCheck(deps): list → filter → match → classify → store
apps/worker/src/processors/mail.processor.ts  # queue `mail`: mail-check scheduler (30 min)
apps/worker/src/apply/run.ts              # set preparedAt on first ready/needs_input
apps/worker/src/night/report.ts           # mail_expired alert + replies counter
apps/worker/scripts/replies-eval.ts       # make replies-eval

apps/api/src/analytics/                   # GET /analytics/funnel (AnalyticsService)
apps/api/src/mail/                        # connect/callback/disconnect/check/status
apps/api/src/replies/                     # timeline, manual, patch, delete
apps/api/src/assistant/                   # settings (approveEnabled)
apps/api/src/mcp/                         # McpController (/mcp, loopback guard), server.ts (tools), approval.ts (preview/confirm)

apps/web/src/app/analises/page.tsx        # funnel, splits, rates, missing skills
apps/web/src/app/respostas/page.tsx       # replies inbox ("verificar" first), relink/reclassify
apps/web/src/app/integracoes/page.tsx     # Gmail connect/disconnect/status, MCP url + approve toggle
apps/web/src/app/vagas/[id]/candidatura   # + replies timeline, manual reply form
apps/web/src/components/site-links.tsx    # + Análises, Respostas, Integrações
```

**Structure Decision**: same layering as F2–F6 — pure decisions and transports in `packages/jobs`,
shared DB helpers in `packages/db`, I/O orchestration in the worker, REST + MCP in the api (MCP tools
are thin adapters over existing Nest services), screens in web.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New queue `mail` | Mail check runs LLM classification (seconds per email, up to 200 emails); on `notify` it would delay the Telegram `parar` poll (kill switch from the phone) and the morning report | `notify` shares the kill-switch path; `sync-profile` is the KB source diff with its own schedule and failure semantics |
| `@modelcontextprotocol/sdk` added to `apps/api` | MCP protocol handling (sessions, schemas, DNS-rebinding protection) | Hand-rolled JSON-RPC would re-implement the spec; the package is already in the repo (worker) |
| Four new tables | `Reply` (timeline), `MailAccount` (encrypted tokens/status), `ProcessedMail` (idempotency without content), `ApprovalPreview` (two-step approval bound to a session) | JSON columns on `Application`/`SearchPreference` cannot enforce message-id uniqueness or compare-and-set confirmation |
