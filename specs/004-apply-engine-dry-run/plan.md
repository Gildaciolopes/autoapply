# Implementation Plan: Apply Engine in Dry-Run

**Branch**: `004-apply-engine-dry-run` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-apply-engine-dry-run/spec.md`

## Summary

For a job, the worker opens its application form in a Playwright context that cannot submit
(network guard blocks every non-GET request, submit events and `form.submit()` are trapped, submit
controls are never clicked). It detects the tracking system (Greenhouse, Lever, Ashby → dedicated
adapters using public question APIs; anything else → generic extractor across frames and steps),
extracts the fields, answers them through a deterministic-first pipeline (standard fields from
facts → approved answer memory → computed years → evidence yes/no rules → batched LLM with the F3
validator), fills them, attaches the tailored resume/letter from memory buffers, and stores
before/step/after screenshots in MinIO. Captcha, bot protection, login walls and any unanswered
required field end in `needs_input` with reasons; the user answers them once (saved as approved
memory) and re-runs. Batch runs, daily cap per tracking system and a kill switch are included.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, Node ≥ 22).

**Primary Dependencies**: NestJS 12, BullMQ 6 (existing `apply` queue), Prisma 7, Zod 4, Playwright
1.64 (already in worker), `@aws-sdk/client-s3` (already in worker), `OllamaProvider` (qwen3:8b,
bge-m3), `@autoapply/tailor` (validator, `yearsOfExperience`, `factsHash`), `@autoapply/resume`
(renderers), `@autoapply/shared` (skills dictionary). New pure package `packages/apply`. No new
third-party dependency.

**Storage**: PostgreSQL (extended `Application`, `FormAnswer`, `Artifact`, `AnswerMemory`,
`SearchPreference`); MinIO for screenshots; PDFs only in memory.

**Testing**: Vitest — pure rules (`packages/apply`), adapters/filler on offline rendered-DOM form
snapshots with real Chromium, dry-run guard test, answer traps with recorded real LLM outputs, API
lifecycle on `autoapply_test`; live `make answers-eval` and the 20-form proof script.

**Target Platform**: single Mac host (headless Chromium).

**Project Type**: web application (monorepo).

**Performance Goals**: one simulation < 3 min on supported systems excluding tailoring (SC-005):
page load + extraction < 20 s, deterministic answers < 1 s, one batched LLM call ~30–90 s, fill +
screenshots < 20 s.

**Constraints**: never submit (engine-enforced); no captcha solving/evasion/stealth; only GETs leave
the machine; field labels and job text are untrusted; usable facts only (unverified marked in
dry-run report); concurrency 1; daily cap per tracking system.

**Scale/Scope**: single user; ≤ 30 simulations/day per tracking system.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Zero Fabrication | Every answer stores source + evidence + confidence; standard/computed/rule stages are deterministic; LLM answers must cite facts and pass the F3 validator (one retry); affirmative yes/no without evidence forbidden; numbers computed; answer trap eval with 0 fabrications. | PASS |
| II. Human in the Loop | Dry-run only (no submit path exists in F4); any uncertainty → `needs_input`; kill switch. | PASS |
| III. Respect Platforms | Public forms + public GET question APIs only; concurrency 1; daily cap per ATS; backoff; captcha/bot protection → stop; plain Chromium, no stealth. | PASS |
| IV. Local-First AI | qwen3/bge-m3 via `LlmProvider`; Zod-validated outputs. | PASS |
| V. Typed Contracts, Simple Services | Payloads/views in `packages/shared`; reuses `apply` queue; one new pure package (justified below). | PASS |
| VI. Testable and Observable | Fixture tests per adapter; `RunEvent` per step; before/after screenshots in MinIO for every simulation. | PASS |

Post-design re-check: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/004-apply-engine-dry-run/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ (rest-api.md, queues.md)
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/apply.ts        # FormField, AnswerSource, NeedsReason, ApplyPayload, views, bodies, LlmFieldAnswers

packages/apply/                     # NEW, pure
├── src/detect.ts                   # detectAts(url, html?) → {ats, board/site/org, jobId}
├── src/classify.ts                 # standard-field + demographic classifier (pt/en)
├── src/standard.ts                 # standard field answers from profile/personal/experience facts, phone/date formatting
├── src/options.ts                  # option matching (pt/en, buckets, yes/no polarity, "prefer not")
├── src/rules.ts                    # computed years + evidence yes/no rules
├── src/memory.ts                   # question normalization, memory match decision
├── src/llm.ts                      # prompt (fields fenced as untrusted), post-checks (cite, polarity, validator)
├── src/answer.ts                   # answerFields pipeline → FormAnswer plan + blocking reasons
├── src/blockers.ts                 # captcha / bot protection / login detection over DOM snapshot
├── src/hash.ts                     # application factsHash
└── test/ (+ fixtures: label corpus, trap-form.json)

apps/worker/src/apply/
├── browser.ts                      # openDryRunContext (network guard, submit trap), screenshots
├── extract.ts                      # in-page field extractor (frames, steps)
├── fill.ts                         # fill/attach per field type, next-step navigation
├── adapters/{greenhouse,lever,ashby,generic}.ts
├── attachments.ts                  # resume/letter buffers (inline tailoring when missing)
├── run.ts                          # runApply orchestration, caps, kill-switch checks, persistence
└── memory.ts                       # embed AnswerMemory lazily, nearest approved memory
apps/worker/src/processors/apply.processor.ts
apps/worker/src/kb/deps.ts          # BlobStore.put

apps/api/src/apply/                 # controller + service (apply, batch, stop, list, summary, view, artifact, answers, rerun)

apps/web/src/app/candidaturas/page.tsx                 # list + filters + batch + stop + summary
apps/web/src/app/vagas/[id]/candidatura/page.tsx       # screenshots, answers, reasons, answer missing
apps/web/src/components/apply/*

apps/worker/test/fixtures/apply/    # form snapshots + trap-form + recording
apps/worker/scripts/{snapshot-form,record-apply-eval,apply-proof}.ts
Makefile: `make answers-eval`
```

**Structure Decision**: same pattern as F1–F3 — pure decision logic in a package, browser/DB/LLM I/O
in the worker, REST in the api, screens in web.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New package `packages/apply` | Field classification, answer rules and post-checks are the Zero-Fabrication core of form answering; used by the worker engine, the API (re-check user answers, outdated), the trap eval, and F5/F6 | Putting them in `apps/worker` makes them untestable without a browser and unreachable from the API; mixing into `packages/tailor` blurs the resume vs form domains |
