# Research: Knowledge Base (F1)

All Technical Context unknowns resolved below. Format: Decision / Rationale / Alternatives.

## R1. PDF text extraction (resume upload, page-count check)

- **Decision**: `unpdf` (pdf.js packaged for Node, ESM, no native deps) for text extraction with
  per-page text and item order. Image-only detection: total extracted chars < 200 → `image_only`.
  Vision fallback renders pages to PNG with `unpdf`'s `renderPageAsImage` + `@napi-rs/canvas`
  and sends them to `qwen2.5vl:7b`.
- **Rationale**: ESM-native (repo is ESM-only), maintained, same lib reused to count pages and
  read back text of rendered PDFs (ATS check, SC-004). No Python hop.
- **Alternatives**: `pdf-parse` (CJS, stale); `pdftotext`/poppler (host binary, not in Docker
  setup); Python `pymupdf` in scraper (wrong service, cross-language payload for no gain).

## R2. Resume → structured JSON with the local LLM

- **Decision**: one `generateObject` call with `qwen3:8b` (`think:false`, temperature 0) over the
  extracted text, schema = `ResumeDraft` (JSON Resume subset in `packages/shared`). Every extracted
  item also returns `quote` (verbatim snippet from the text). A deterministic `foundInSource()`
  check (accent/case/whitespace-insensitive substring of the quote, plus each value token present
  in the source text) sets `flags: ['not_in_source']` (FR-008). Dates normalized by code
  (`parseLooseDate`: "atual", "presente", "hoje", "present", pt-BR/en month names, year-only keeps
  `precision: 'year'`).
- **Rationale**: Resumes are 1–2 pages (~2–4k tokens), fit qwen3:8b context in one call; quotes make
  hallucination detectable without another LLM. Dates by code honors constitution §I (numbers by code).
- **Alternatives**: section-by-section prompts (more calls, slower overnight, little gain at this
  size); regex-only parser (brittle across layouts); cloud LLM (violates §IV default).

## R3. ATS-friendly one-page PDF renderer

- **Decision**: HTML template (single column, system-safe font stack embedded via `@font-face` of a
  bundled open font, `•` as literal text, `<h2>` standard headings in pt-BR or en following the
  resume language) → Playwright Chromium `page.pdf({ format: 'A4', printBackground: false })`. After
  render, `unpdf` reads it back: page count must be 1, extracted text order must equal the model
  order. If pages > 1 → `overflow` result listing items with ids; nothing is cut (FR-022).
- **Rationale**: Playwright already a worker dependency and needed again in F3/F4 (attach PDF from
  memory buffer). Chromium PDFs carry a real text layer with correct reading order for single-column
  layouts. Template is plain HTML/CSS → easy to tweak.
- **Alternatives**: `@react-pdf/renderer` (own layout engine, list markers fine but new heavy dep);
  `pdfkit` (manual layout, painful); Typst/LaTeX (host binaries); CSS `list-style` markers (rejected
  by the spec: markers can be dropped by text extractors).

## R4. "100 on cvlint" acceptance target

- **Decision**: A tool named "cvlint" could not be identified (web search found none). Implement a
  deterministic internal ATS lint (`atsLint(pdfBuffer, expectedModel)`) with a 0–100 score whose
  rules are explicit: 1 page; text layer present; reading order matches model; no images; bullets
  are text characters; standard section headings; contact info (email, phone) in text; fonts
  embedded; no text in header/footer regions; no multi-column overlap. SC-004 is verified with this
  lint; if the user names a concrete external tool later, add it as a manual check in quickstart.
- **Rationale**: Deterministic, runs in CI via fixtures, covers the usual ATS parse failures.
- **Alternatives**: third-party online ATS scorers (send PII to a cloud service — violates local
  data rule FR-028).

## R5. GitHub import

- **Decision**: GitHub **GraphQL v4** with plain `fetch` and `GITHUB_TOKEN` from `.env`
  (fine-grained, read-only). One paginated query (50 repos/page) fetching per repo: name, url,
  isFork, isArchived, isPrivate, pushedAt, `languages(first:20){edges{size node{name}}}`,
  README (`object(expression:"HEAD:README.md")` + `readme.md`/`README`), and manifests via
  `object(expression:"HEAD:<file>")` for `package.json`, `pyproject.toml`, `requirements.txt`,
  `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile`. Manifests over
  100 KB skipped. Private repos only when the token can see them (Assumption in spec).
  Skill derivation is **deterministic**: language names + dependency names + README tokens matched
  against a curated `skills` dictionary (`packages/shared/src/skills.ts`, canonical id + synonyms +
  package aliases, e.g. `@nestjs/core` → `skill:nestjs`). Metrics (repo count, last activity) computed
  by code. No LLM in this path.
- **Rationale**: GraphQL fetches everything for ≤100 repos in ~2–4 requests (REST would need
  1 + 3–10 calls per repo → rate limits). The dictionary doubles as F3's synonym table for the
  Zero-Fabrication validator. Rate-limit: read `rateLimit{remaining resetAt}`; when low, park the
  import with `resumeAt` and mark partial (edge case).
- **Alternatives**: `@octokit/*` (extra deps for 1 query); REST per repo (call-heavy); LLM reading
  READMEs for skills (fabrication risk, slow).

## R6. LinkedIn profile import

- **Decision**: Reuse `LinkedinMcpClient.call('get_my_profile', {})` in the worker. Output (text
  sections) is saved raw as the source snapshot, then mapped to `ResumeDraft` with the same R2
  LLM path + `foundInSource()` check against the raw snapshot text. Only when the
  `ProfileSource(linkedin).enabled = true` (FR-016). If the MCP call fails with auth/session error →
  outcome `failed: session_expired` with hint `make linkedin-login`. Concurrency 1, once per sync.
- **Rationale**: Exact tool already wrapped; same parser keeps one mapping path.
- **Alternatives**: Playwright scrape of own profile (more ToS exposure, duplicate effort).

## R7. Fact identity, merge and conflict detection

- **Decision**: Deterministic `factKey(kind, value)` in `packages/kb`:
  - skill → `skill:<canonical id>` (dictionary) or `skill:<slug>` if unknown;
  - experience → `experience:<companySlug>:<startYYYY>` (year only, so month disagreements between
    sources surface as value conflicts instead of separate facts);
  - education → `education:<institutionSlug>:<degreeSlug>`;
  - certification/language/project → `<kind>:<slug(name)>`;
  - personal → fixed keys (`personal:salary_expectation`, …).
  Merge: same key + equal normalized value → add `FactSource` to existing fact. Same key + different
  value → open `FactConflict` with both candidate values. Fuzzy company names (normalized
  Levenshtein ratio ≥ 0.85 or one contains the other after removing legal suffixes like "S.A.",
  "Ltda") → `FactConflict(type='possible_duplicate')`, never auto-merged (edge case).
- **Rationale**: Deterministic, unit-testable, explainable to the user.
- **Alternatives**: embedding similarity via bge-m3 (opaque thresholds; later possible for
  suggestions only).

## R8. Sync scheduling and dedupe

- **Decision**: API on boot calls `queue.upsertJobScheduler('sync-profile-daily', { pattern:
  '0 6 * * *', tz: 'America/Sao_Paulo' }, { name: 'sync', data: { kind: 'sync_all',
  trigger: 'schedule' } })` on queue `sync-profile`. Processor skips if a `SyncRun` with
  `trigger='schedule'` already exists for the local date (FR-024). Manual `sync now` always runs.
- **Rationale**: BullMQ 6 job schedulers are idempotent across restarts; queue already exists in
  `QUEUES`.
- **Alternatives**: OS cron (outside app, invisible in Bull Board).

## R9. Queue usage (no new queue)

- **Decision**: All knowledge-base background work goes through the existing `sync-profile` queue
  with a discriminated payload `kind: 'parse_resume' | 'import_github' | 'import_linkedin' |
  'sync_all'`. Concurrency 1 (also satisfies FR-027 per-platform concurrency).
- **Rationale**: Constitution §V forbids new queues without need; volumes are tiny.
- **Alternatives**: separate `parse-resume` queue (parsing could then run parallel to sync — not
  needed for a single user).

## R10. Where rendering runs

- **Decision**: New package `packages/resume` exporting `renderResumePdf()`, `extractPdfText()`,
  `atsLint()`. Used by the API for preview/download (synchronous, request ~1–3 s) and by the worker
  later (F4). API gets `playwright` as dependency (Chromium already installed by `make setup`).
- **Rationale**: Rendering is user-initiated and fast; a queue round-trip adds latency and code for
  no benefit. One package means F3/F4 reuse the same output.
- **Alternatives**: render in worker via queue + `waitUntilFinished` (more moving parts).

## R11. File upload and storage

- **Decision**: `POST /kb/resumes` multipart via Nest `FileInterceptor` (multer, bundled with
  `@nestjs/platform-express`), limit 5 MB, mime `application/pdf` + magic bytes `%PDF-`. Stored to
  MinIO `resumes/<resumeId>/original.pdf` with `@aws-sdk/client-s3` (already in worker; added to
  api). Extracted raw text stored in DB (`ResumeBase.rawText`) for `foundInSource()` and diffs.
- **Alternatives**: store PDF in Postgres bytea (bloats DB, against architecture).

## R12. Test runner

- **Decision**: Vitest for TS (`packages/kb`, `packages/resume`, `packages/shared`, worker
  importers with fixtures). Nest controllers tested via pure service functions; no decorator
  metadata needed in unit tests. Fixtures live next to tests (`packages/*/test/fixtures`,
  `apps/worker/test/fixtures`) and use synthetic personas only (no real PII committed).
- **Rationale**: Repo has `turbo run test` but no TS runner yet; Vitest is ESM-native (Jest ESM is
  painful). Constitution §VI requires fixture tests.
- **Alternatives**: `node:test` (no watch/snapshots ergonomics, weaker TS story); Jest (ESM pain).

## R13. Credentials

- **Decision**: GitHub token stays in `.env` (`GITHUB_TOKEN`); LinkedIn session stays in the MCP
  volume. No credential is entered in the UI in F1, so nothing new to encrypt (FR-028 satisfied by
  not storing secrets in DB). `SESSION_ENCRYPTION_KEY` usage remains for F5.
- **Alternatives**: UI token entry encrypted with AES-256-GCM (YAGNI for single user).
