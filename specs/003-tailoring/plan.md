# Implementation Plan: Resume Tailoring with Evidence Validation

**Branch**: `003-tailoring` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-tailoring/spec.md`

## Summary

For a job, a deterministic ranker selects and orders the user's existing resume items (bullets kept
verbatim) and the local LLM writes only a short summary and, when needed, a cover letter as
sentences that cite fact ids, with durations as placeholders filled by code. A deterministic
validator checks every technology, organization, title, certification and number against the cited
usable facts; one retry, then "precisa de revisão". The user reviews a diff against the base resume,
edits (re-validated) and approves; approval is invalidated when cited facts change. A trap evaluation
suite (`make eval`) with an independent checker stores its result for future autopilot gating.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, Node ≥ 22).

**Primary Dependencies**: NestJS 12, BullMQ 6 (existing `tailor` queue), Prisma 7, Zod 4, Next.js 16,
`OllamaProvider` (qwen3:8b), `@autoapply/kb` (skills dictionary, `valueInSource`, dates),
`@autoapply/resume` (renderer, ATS lint), `@autoapply/jobs` (normalize). New pure package
`packages/tailor`. No new third-party dependency.

**Storage**: PostgreSQL (`TailoredDocument`, `EvalRun`); PDFs rendered on demand, not stored.

**Testing**: Vitest — validator unit tests + seeded case set (SC-002), ranking/overflow tests, worker
processor with recorded real LLM outputs, API lifecycle on `autoapply_test`, trap eval (recorded /
live).

**Target Platform**: single Mac host.

**Project Type**: web application (monorepo).

**Performance Goals**: tailored resume ready < 3 min (SC-003): ranking + render loop < 5 s, summary
LLM call ~30–60 s, letter ~60–90 s.

**Constraints**: no bullet rewriting; only usable facts outside dry-run; local LLM only; job text is
untrusted input (prompt injection).

**Scale/Scope**: single user; up to ~20 tailored jobs/day.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | Bullets verbatim; generated sentences carry `factIds` (min 1); deterministic validator per R3 (tech/org/title/cert/number); durations computed by code; one retry → `needs_review`; trap eval with independent checker must report 0 fabrications. | PASS |
| II. Human in the Loop | Tailored docs require user approval to be usable outside dry-run; approval invalidated by fact changes; auto-tailor only prepares drafts. | PASS |
| III. Respect Platforms | No external calls in F3. | PASS |
| IV. Local-First AI | qwen3 via `LlmProvider`; Zod-validated outputs. | PASS |
| V. Typed Contracts, Simple Services | Payloads in `packages/shared`; reuses the existing `tailor` queue; one new pure package (justified). | PASS |
| VI. Testable and Observable | Unit + fixture tests; `RunEvent` per step; `EvalRun` persisted. | PASS |

Post-design re-check: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-tailoring/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ (rest-api.md, queues.md)
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/tailor.ts      # TailorSentence, plan, ValidationReport, views, LlmSentences, TailorPayload

packages/tailor/                   # NEW, pure
├── src/rank.ts                    # job requirements, item scoring, ordering, overflow candidates
├── src/validate.ts                # deterministic validator (R3)
├── src/numbers.ts                 # number/number-word detection
├── src/years.ts                   # yearsOfExperience + placeholder substitution
├── src/prompts.ts                 # summary/letter prompts (job text fenced as untrusted)
├── src/diff.ts                    # base vs tailored changes
├── src/letter.ts                  # cover-letter requirement detection
├── src/hash.ts                    # factsHash
└── test/ (+ fixtures/validator-cases.json)

packages/resume/src/model.ts       # factsToRenderModel opts.plan (order/summary/hidden)
packages/resume/src/letter.ts      # renderLetterPdf

packages/db/prisma/schema.prisma   # TailoredDocument, EvalRun, SearchPreference.autoTailor/N

apps/worker/src/
├── tailor/generate.ts             # rank → LLM → placeholders → validate → retry → persist
├── processors/tailor.processor.ts
└── jobs/run.ts                    # auto-tailor hook after scoring

apps/api/src/tailor/               # controller + service (tailor, view, diff, patch, approve, pdf, eval runs)

apps/web/src/app/vagas/[id]/curriculo/page.tsx   # review (diff, summary citations, letter), approve, PDF

apps/worker/test/fixtures/eval-tailor/ + test/tailor-eval.test.ts + scripts/record-tailor-eval.ts
Makefile: `make eval`
```

**Structure Decision**: same pattern as F1/F2 — pure logic in a package, I/O in worker/api.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New package `packages/tailor` | Validator and ranker are used by worker (generation), API (re-validate user edits, diff) and the eval; must be pure and heavily unit-tested | Putting them in `packages/jobs`/`kb` mixes domains; duplicating in apps breaks the single source of truth for the Zero-Fabrication rules |
