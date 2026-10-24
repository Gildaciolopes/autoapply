# Implementation Plan: Logged-in Platforms and Assisted Real Submission

**Branch**: `005-logged-in-platforms` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-logged-in-platforms/spec.md`

## Summary

A `Platform` table holds, per platform (Gupy, LinkedIn, Greenhouse, Lever, Ashby, generic), the
encrypted session (Gupy/LinkedIn), caps, minimum interval and pause state. Sessions come from a headed
Chromium window where the user logs in by hand; the worker saves the storageState with AES-256-GCM.
The F4 dry-run engine runs with that session plus two new adapters (Gupy flow, LinkedIn Easy Apply
modal). In review mode the user approves prepared applications; a separate submit path re-opens the
form, verifies it still matches the approval, fills exactly the approved values, sets the
application to `submitting` with a compare-and-set, clicks submit once and records confirmation or
`submit_uncertain` (never retried). Captcha at submit → assisted submit in a visible window where the
user completes the check and submits. Kill switch, caps, interval and backoff gate every action.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, Node ≥ 22).

**Primary Dependencies**: NestJS 12, BullMQ 6 (existing `apply` queue, new job names), Prisma 7, Zod 4,
Playwright 1.64 (headed + headless), `node:crypto` (AES-256-GCM), `@autoapply/apply` (F4 rules,
detection, blockers), Next.js 16. No new third-party dependency.

**Storage**: PostgreSQL (`Platform`, extended `Application`/`Artifact`); MinIO for screenshots; sessions
encrypted in the DB; key only in `.env`.

**Testing**: Vitest — crypto, pure gate/detection rules, adapters on synthetic fixtures, submit path
against a local recording test form, API approval/limits on `autoapply_test`. Never a real platform.

**Target Platform**: the user's Mac (headed windows for login and assisted submit).

**Project Type**: web application (monorepo).

**Performance Goals**: connect < 2 min of user time (SC-001); submission of a prepared application
< 2 min excluding assisted waits.

**Constraints**: no password handling, no captcha solving/evasion, review mode only, at most one
submission per application, concurrency 1, per-platform caps/interval/backoff, LinkedIn opt-in.

**Scale/Scope**: single user; ≤ 40 submissions/day total by default.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | Submit fills only the approved, already-validated F4 answers; no LLM at submit time; changed forms stop. | PASS |
| II. Human in the Loop | Review mode: real submission only after per-application/batch approval; dry-run disables approval; kill switch cancels approvals; uncertain outcomes are resolved by the user. | PASS |
| III. Respect Platforms | Per-platform caps + safe maxima, minimum interval, concurrency 1, backoff/pause on errors and unusual activity; LinkedIn opt-in with low cap; no captcha solving (assisted submit = the user acts), plain Chromium. | PASS |
| IV. Local-First AI | No new AI usage. | PASS |
| V. Typed Contracts, Simple Services | Payloads in `packages/shared`; reuses the `apply` queue (new job names, no new queue/service); one new table justified by R1. | PASS |
| VI. Testable and Observable | Fixture tests per adapter, submit path tested on a local form; RunEvent per step; before/filled/confirmation screenshots for every submit. | PASS |

Sessions: constitution "platform sessions stored encrypted (`SESSION_ENCRYPTION_KEY`)" — satisfied (R2).
Post-design re-check: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/005-logged-in-platforms/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ (rest-api.md, queues.md)
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/platforms.ts          # PlatformKind, PlatformView, bodies, SubmitPayload, SessionJobPayload
packages/shared/src/apply.ts              # statuses + NeedsReasonCode additions
packages/apply/src/detect.ts              # + gupy, linkedin
packages/apply/src/blockers.ts            # + unusual_activity, already applied, platform action page
packages/apply/src/platform.ts            # NEW pure: defaults/maxima, gate decision (caps/interval/pause), backoff, approvalHash
packages/apply/src/confirm.ts             # NEW pure: confirmation / already-applied text patterns

packages/db/prisma/schema.prisma          # Platform, Application fields, statuses; drop applyDailyCap

apps/worker/src/apply/
├── session-crypto.ts                     # AES-256-GCM encrypt/decrypt storageState
├── sessions.ts                           # connect (headed) / test (headless) / load storageState
├── gate.ts                               # platformGate (DB) using packages/apply/platform.ts
├── adapters/gupy.ts  adapters/linkedin.ts
├── submit.ts                             # openSubmitContext + runSubmit + assisted submit
└── run.ts                                # F4 engine: session + gate + new adapters/reasons
apps/worker/src/processors/apply.processor.ts   # job names apply | submit | connect-session | test-session

apps/api/src/platforms/                   # controller + service (platforms, opt-in, connect, test, limits, resume)
apps/api/src/apply/                       # approve, batch approve, mark, stop extension

apps/web/src/app/plataformas/page.tsx     # connect/test/disconnect, caps, usage, pause
apps/web/src/components/apply/*           # approve / batch approve / mark uncertain / statuses

apps/worker/test/fixtures/apply/{gupy-*,linkedin-*}/  # synthetic flows
apps/worker/test/fixtures/submit/                     # local recording test form
```

**Structure Decision**: same as F4 — pure decisions in `packages/apply`, browser I/O in the worker
(dry-run engine and the separate submit path), REST in the api, screens in web.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New table `Platform` | Sessions + caps + pause per apply platform, shared by simulate and submit | `Source` is the discovery catalogue (no Greenhouse/Lever/Ashby rows, LinkedIn MCP ≠ Easy Apply) |
| Second browser context type (`openSubmitContext`) | Real submission needs network writes | Flag inside the dry-run context would make the F4 guarantee depend on a boolean |
