# Data Model: Apply Engine in Dry-Run (F4)

Migration `apply_dry_run`. Extends existing F0 tables (`Application`, `FormAnswer`, `Artifact`,
`AnswerMemory`, `RunEvent`, `SearchPreference`).

## Application (extended)

| Field | Type | Notes |
|---|---|---|
| ats | String? | `greenhouse \| lever \| ashby \| generic` (detected) |
| formUrl | String? | resolved form URL (after redirects / iframe) |
| needsReasons | Json `[]` | `[{ code, fieldKey?, message }]`; codes: `captcha, bot_protection, login_required, low_confidence, no_evidence, missing_fact, validation_failed, tailoring_needs_review, cover_letter_required, attachment_rejected, daily_cap, cancelled` |
| report | Json `{}` | `{ steps, blockedRequests[], submitAttempts, captchaOnSubmit, unverifiedFactIds[], durations }` |
| factsHash | String `""` | R10 |
| tailoredDocIds | String[] | documents attached |
| lastRunAt | DateTime? | start of the latest attempt (daily cap) |

Existing kept: `jobId @unique`, `status`, `mode` (`dry_run` here), `needsReason` (first reason, short
text for lists), `error`, `attempts`, `submittedAt` (always null in F4).

Status in F4: `queued → tailoring? → applying → ready | needs_input | failed`; any → `skipped`
(kill switch). `ready` = "Simulado — pronto para enviar". Re-run: `attempts += 1`, answers replaced,
artifacts kept. `outdated` computed on read (not a status).

## FormAnswer (extended; replaced on each attempt)

| Field | Type | Notes |
|---|---|---|
| fieldKey | String | stable selector/name of the field |
| fieldType | String | `text, email, tel, number, url, date, textarea, select, radio, checkbox, file` |
| required | Boolean | |
| options | String[] | option labels (select/radio/checkbox) |
| step | Int `0` | multi-step index |
| frameUrl | String? | |
| question | String | (existing) label |
| answer | String? | (existing) value filled; null = left empty |
| source | String | (existing) `fato \| memória \| calculado \| regra \| modelo \| usuário \| anexo` |
| confidence | Float | (existing) |
| evidence | String[] | (existing) fact ids (`profile:me` for Profile fields) |
| blocking | Boolean `false` | required and unanswered |
| reason | String? | reason code when blocking/empty |
| findings | Json `[]` | validator findings (free text) |
| filled | Boolean `false` | value actually set on the page (fill succeeded) |

## Artifact (extended)

| Field | Type | Notes |
|---|---|---|
| type | String | `screenshot_before \| screenshot_step \| screenshot_after \| screenshot_last` |
| label | String | `before`, `step-1`, `after`, `last` |
| attempt | Int | |
| minioKey | String | `applications/<applicationId>/<attempt>/<label>.png` |

## AnswerMemory (extended)

| Field | Type | Notes |
|---|---|---|
| fieldType | String? | type the answer applies to |
| normalized | String | lowercased, accents/punctuation stripped question (index) |
| source | String `"user"` | |
| updatedAt | DateTime | |

Embedding (`vector(1024)`, existing) filled lazily by the worker (bge-m3) when null. User answers from
the "precisa de você" view upsert by `normalized` with `approved = true`.

## SearchPreference (extended)

| Field | Type | Default |
|---|---|---|
| applyConfidence | Float | 0.7 |
| applyDailyCap | Int | 30 (per ATS) |

## Validation rules

- An answer with source `modelo` MUST have `evidence.length ≥ 1` and, for free text, a passing
  validation report; otherwise it is stored with `answer = null`, `blocking = required`.
- Affirmative yes/no answers MUST have evidence.
- `submittedAt` MUST stay null and `report.submitAttempts` MUST be 0 for `mode = dry_run`.
