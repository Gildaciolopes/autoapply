# Data Model: Tailoring (F3)

Migration `tailoring`.

## TailoredDocument (new)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| jobId | → Job (cascade) | |
| kind | enum `resume|cover_letter` | `@@unique([jobId, kind])` (latest version) |
| status | enum `queued|generating|draft|needs_review|approved|outdated|failed` | |
| lang | `pt|en` | base resume language by default |
| plan | Json | resume: `{ bulletOrder, entryOrder, skillOrder, hiddenItemIds, relevance }` |
| sentences | Json | `[{ text, factIds[], role?, computed?: { token, value, source } }]` (summary or letter) |
| validation | Json | `{ ok, attempts, findings: [{ sentenceIndex, type, token }] }` |
| factIds | String[] | every fact the document includes or cites |
| factsHash | String | sha256 over those facts' (id, updatedAt, verified, status, hasOpenConflict) |
| model | String | |
| userEdited | Boolean | summary/letter edited by user |
| approvedAt | DateTime? | |
| error | String? | |
| createdAt / updatedAt | | |

State: `queued → generating → (draft | needs_review | failed)`; user edit → re-validate → `draft |
needs_review`; `draft → approved`; any → `outdated` when factsHash differs (computed on read and by
a check after fact changes). Only `approved` and not outdated is usable outside dry-run.

## EvalRun (new)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| suite | String | `tailor` (F4 will add `answers`) |
| model | String | |
| cases | Int | |
| fabrications | Int | |
| passed | Boolean | `fabrications === 0` |
| report | Json | per-case results |
| createdAt | DateTime | |

## SearchPreference (extend)

`autoTailor Boolean @default(false)`, `autoTailorN Int @default(5)` (`scoreThreshold` exists, 70).

## Shared Zod (`packages/shared/src/tailor.ts`)

`TailorSentence`, `TailoredResumePlan`, `ValidationFinding` (type enum `uncited|unusable_fact|
tech_without_evidence|org_without_evidence|title_without_evidence|cert_without_evidence|
number_without_evidence`), `ValidationReport`, `TailoredDocumentView`, `LlmSentences` (LLM schema),
`TailorPayload` (queue).
