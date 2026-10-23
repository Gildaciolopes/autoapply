# Research: Resume Tailoring with Evidence Validation (F3)

Decision / Rationale / Alternatives.

## R1. Selection and ordering are deterministic (no LLM)

- **Decision**: Pure `rankForJob(job, facts)` in new package `packages/tailor`: job requirements =
  dictionary skills found in job title+description (`findSkillsInText` + full alias scan) plus
  normalized keyword set (tokens ≥ 3 chars, stopwords removed). Bullet score = 3 × matched dictionary
  skills + 1 × keyword overlap (capped). Experience entries keep reverse-chronological order (ATS
  convention); bullets are reordered inside each entry; projects and certifications sorted by score;
  skills: job-matched first (in job order), then by GitHub evidence/recency. Overflow: hide lowest
  scoring bullets of the oldest entries first, then projects, until one page (render loop, max 8
  iterations). Bullet text is never modified (FR-002).
- **Rationale**: Selection cannot fabricate; deterministic = testable and fast (render loop ~1–3 s).
- **Alternatives**: LLM picks bullets (slower, non-deterministic, no gain); embeddings per bullet
  (heavier, marginal).

## R2. LLM writes only summary and cover letter, as cited sentences

- **Decision**: qwen3:8b, `think:false`, temperature 0.2, Zod schema
  `{ sentences: { text: string, factIds: string[] }[] }` (summary ≤ 4, letter ≤ 12 sentences with
  `role: 'greeting'|'body'|'closing'`). Closed context: `[factId] kind: summary` lines for usable facts
  only, ranked by relevance (top 25), job title/company/requirements (description ≤ 4 000 chars,
  wrapped in `<job_posting>` tags and declared untrusted data in the system prompt — prompt-injection
  defence, trap R6). Durations: the model must write placeholders `{{anos}}` / `{{anos:<skill>}}`;
  code replaces them with values computed from fact dates (`yearsOfExperience`) and records the
  source (FR-007).
- **Rationale**: Smallest generative surface; citations make every claim checkable.

## R3. Deterministic validator (FR-006)

- **Decision**: `validateDocument(sentences, ctx)` in `packages/tailor`, no LLM. Per sentence:
  1. ≥ 1 factId, all ids ∈ usable facts → else `uncited` / `unusable_fact`.
  2. **Technologies**: every dictionary alias found in the sentence (word-boundary; short/ambiguous
     aliases like Go, C, R, REST, Next only when case matches the canonical label) must be found in the
     text of the cited facts (alias-aware, `valueInSource`) → else `tech_without_evidence`.
  3. **Organizations**: names from a known-org list (user's experience/education companies, all
     `Company` names seen in jobs, the target company) found in the sentence must be in cited facts,
     except the target company in `greeting`/`closing` sentences → else `org_without_evidence`.
  4. **Titles/seniority**: role words with level (`sênior|senior|pleno|júnior|lead|líder|head|staff|
     principal|gerente|coordenador|arquitet[oa]|CTO|CEO`) must appear in cited facts' text →
     `title_without_evidence`.
  5. **Certifications**: patterns (`certified|certificação|certificado|AWS Certified|CKA|CKAD|PMP|
     PSM|CSM|Scrum`) must match a cited certification fact → `cert_without_evidence`.
  6. **Numbers**: digits (incl. `%`, `k`, `mil`, `x`) and number words pt/en (um…vinte, dez, cem,
     one…twenty, hundred) must appear in cited facts' text (normalized) unless produced by a
     placeholder substitution → `number_without_evidence`.
  Report = `{ ok, findings: { sentenceIndex, type, token }[] }`.
- **Rationale**: Mirrors constitution §I literally; each rule is unit-testable and explainable.
- **Alternatives**: LLM-as-judge (non-deterministic, can be fooled by the same injection).

## R4. Retry and statuses

- **Decision**: generate → substitute placeholders → validate; on failure, one retry with a message
  listing findings ("remove 'Go': not in cited facts"); on second failure status `needs_review` with
  findings. Status machine per document: `queued → generating → draft | needs_review → approved →
  outdated`; `outdated` when the `factsHash` (sha256 of included fact ids + `updatedAt` + status +
  verified + conflict flags) differs from current.

## R5. Rendering

- **Decision**: extend `packages/resume` `factsToRenderModel` with `opts.plan`
  (`{ summary?: string, bulletOrder: Record<factId, number[]>, entryOrder?: Record<section, factId[]>,
  skillOrder: factId[], hiddenItemIds }`) so base and tailored resumes share the renderer and ATS lint
  (FR-004). New `renderLetterPdf(letter, profile)` with the same font/template conventions.
  PDFs rendered on demand by the API; not stored.

## R6. Trap evaluation (`make eval`, FR-014..016)

- **Decision**: `apps/worker/test/fixtures/eval-tailor/` — persona Ana facts + 10 trap jobs:
  missing tech (Go, Kubernetes, Java), inflated years ("10+ anos"), seniority bait ("Head of
  Engineering"), foreign employer names in the job text, certification bait ("AWS Professional
  obrigatória"), two prompt-injection jobs (pt/en), one benign control. Pipeline runs with recorded
  real qwen3 outputs (`record-tailor-eval.ts`) or live (`TAILOR_EVAL_LIVE=1`). **Independent
  checker** (different algorithm, FR-015): tokenizes every claim, flags any dictionary technology or
  number absent from the *whole* persona fact text and any org name from the job not in persona facts
  (excluding greeting/closing). Result written to `EvalRun` table (`suite: 'tailor'`, fabrications,
  pass). Validator seeded set (SC-002): `packages/tailor/test/fixtures/validator-cases.json` with ≥ 30
  bad and ≥ 20 good sentences.
- **Rationale**: Two independent checks reduce shared blind spots.

## R7. Queue and API

- **Decision**: existing `tailor` queue (payload `{ jobId, kinds: ('resume'|'cover_letter')[],
  documentId }`), worker `TailorProcessor` concurrency 1. API enqueues, returns document ids; web
  polls. Auto-tailor (US6): `SearchPreference.autoTailor` (false) + `autoTailorN` (5); `process-run`
  enqueues tailoring for top jobs with `score ≥ scoreThreshold` and no current document.
- **Cover-letter detection**: regex over job text (`carta de apresenta[cç][aã]o|cover letter|motivation
  letter|carta de motiva[cç][aã]o`).
