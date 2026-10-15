# Feature Specification: Knowledge Base

**Feature Branch**: `001-knowledge-base`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Knowledge base: user uploads base resume PDF (stored in MinIO), it is parsed by the local LLM into JSON Resume shape and reviewed by the user; LinkedIn profile is imported via the linkedin-mcp get_my_profile tool; GitHub repos/languages/READMEs/dependency manifests are imported via the official API as skill evidence. Everything becomes Fact rows with provenance; conflicts between sources are shown for the user to resolve; user enters personal facts (salary expectation, notice period, availability, PCD, work authorization). A resume renderer turns JSON into an ATS-friendly one-page PDF (text bullets, not CSS markers). Daily sync-profile job diffs sources."

## Context

The knowledge base is the single source of truth about the user. Every later feature (scoring,
tailoring, form filling) may only state things that are backed by a fact stored here (constitution
§I, Zero Fabrication). This feature builds that store, fills it from four sources (base resume,
LinkedIn profile, GitHub, user-entered personal data), lets the user verify and reconcile it, keeps it
fresh, and renders it back into a clean resume.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import and verify the base resume (Priority: P1)

The user uploads their current resume (PDF). The system keeps the original file, extracts its content
into a structured resume (contact info, summary, work history with bullets, education, skills,
languages, certifications, projects), and shows it side by side with the original for review. The
user corrects any extraction mistakes, then confirms. On confirmation every item becomes a verified
fact that records it came from the base resume.

**Why this priority**: Without verified facts nothing downstream may claim anything. The resume is the
richest single source and is enough on its own to unblock tailoring.

**Independent Test**: Upload a known fixture resume, correct one deliberately wrong field, confirm,
and check that the fact list contains exactly the resume's items, all marked verified and attributed
to the resume, with the corrected value.

**Acceptance Scenarios**:

1. **Given** no resume uploaded, **When** the user uploads a text-based PDF resume, **Then** the
   original is stored and a structured draft is shown for review within 2 minutes, with each section
   editable.
2. **Given** a draft under review, **When** the user edits a job title and confirms, **Then** the
   facts store the edited title, are marked verified, and keep the resume as their source.
3. **Given** a draft under review, **When** the user leaves without confirming, **Then** no facts are
   marked verified and the draft can be resumed later.
4. **Given** a draft, **When** the extraction produced an item not present in the original text (e.g.
   a skill the PDF never mentions), **Then** the item is flagged as "not found in source" so the user
   can remove it.
5. **Given** a resume was already imported, **When** the user uploads a new version, **Then** the new
   draft is diffed against existing facts and only additions/changes/removals are presented for
   review.

---

### User Story 2 - Enter personal facts (Priority: P1)

The user fills a form with facts that no external source provides: salary expectation (amount,
currency, CLT/PJ), notice period, availability start date, work-mode preference, disability (PCD)
status, work authorization, willingness to relocate, and similar standard application questions.

**Why this priority**: Application forms in Brazil ask these on almost every job; without them every
application parks in `needs_input`. Cheap to build, high leverage.

**Independent Test**: Fill the form, reload, and check each value is stored as a verified,
user-entered fact; leave PCD empty and check it is stored as "not provided" rather than "no".

**Acceptance Scenarios**:

1. **Given** the personal facts form, **When** the user saves salary expectation "R$ 15.000 CLT",
   **Then** a verified fact with source "user-entered" exists with amount, currency and contract type.
2. **Given** a sensitive field (PCD, work authorization) left blank, **When** saved, **Then** the
   field is stored as "not provided", and downstream consumers see it as unknown, never as a default
   "no" or "yes".
3. **Given** an existing personal fact, **When** the user edits it, **Then** the previous value is
   kept in the fact's history.

---

### User Story 3 - Render an ATS-friendly one-page resume (Priority: P2)

From the verified facts the user generates a one-page PDF resume. The layout is single column, uses
real text characters for bullets, standard section headings, selectable text in reading order, and
no images, tables or icons that carry meaning.

**Why this priority**: Applications need a PDF to attach; tailoring (F3) will reuse the same renderer.
It only needs the resume facts (US1).

**Independent Test**: Render from fixture facts, extract the PDF's text with a plain text extractor
and compare to the expected content and order; check page count is 1.

**Acceptance Scenarios**:

1. **Given** verified resume facts, **When** the user requests a PDF, **Then** a one-page PDF is
   produced whose extracted text contains every rendered item in reading order, with bullets as text
   characters.
2. **Given** content that does not fit one page, **When** rendering, **Then** the system does not
   silently cut content; it reports the overflow and lets the user choose which items to hide for this
   rendering.
3. **Given** a rendered PDF, **When** checked by an ATS resume linter, **Then** it reaches the
   maximum score (roadmap F1 goal: 100 on cvlint).
4. **Given** unverified facts exist, **When** rendering outside dry-run, **Then** unverified facts are
   excluded.

---

### User Story 4 - Import GitHub as skill evidence (Priority: P2)

The user connects their GitHub account. The system imports their repositories, language breakdown,
READMEs and dependency manifests, and derives skill evidence ("used TypeScript in 12 repos, last
commit 2026-09", "depends on NestJS in repo X"). Each derived skill links back to the repositories and
files that prove it.

**Why this priority**: Strengthens and extends skill claims with checkable evidence, but tailoring can
start with resume facts alone.

**Independent Test**: Import from a fixture account snapshot and check that each derived skill fact
lists the exact repos/files as provenance and that no skill appears without at least one such link.

**Acceptance Scenarios**:

1. **Given** a connected account, **When** import runs, **Then** each repo's languages, README and
   manifests are read and skills are derived with links to the repos/files that support them.
2. **Given** a skill only found in a fork or archived repo, **When** imported, **Then** the evidence
   is marked as such so the user can judge its weight.
3. **Given** derived GitHub skills, **When** shown to the user, **Then** they start unverified and the
   user can verify, reject, or rename them in bulk.

---

### User Story 5 - Import LinkedIn profile (Priority: P3)

The user, with an already-connected LinkedIn session, imports their own profile (headline, about,
experience, education, skills, certifications, languages). Items become unverified facts attributed
to LinkedIn and are matched against existing facts.

**Why this priority**: Mostly overlaps the resume; value is in catching discrepancies and extra
items. Depends on an external session that may be missing.

**Independent Test**: Import from a saved profile fixture and check facts are created/merged with
LinkedIn provenance, and items that match resume facts are merged rather than duplicated.

**Acceptance Scenarios**:

1. **Given** a valid LinkedIn session, **When** the user imports, **Then** profile items become facts
   with LinkedIn provenance; items equal to existing facts add LinkedIn as an extra source instead of
   duplicating.
2. **Given** no valid session, **When** the user imports, **Then** the system explains how to connect
   the session and creates nothing.
3. **Given** LinkedIn is opt-in, **When** the user never enables it, **Then** no LinkedIn access ever
   happens, including during daily sync.

---

### User Story 6 - Resolve conflicts between sources (Priority: P2)

When two sources disagree about the same fact (e.g. resume says "Senior Engineer, 2021–2024",
LinkedIn says "Tech Lead, 2022–2024"), the system shows a conflicts screen with each value and its
source. The user picks one value, merges/edits a new one, or keeps both as distinct facts. Until
resolved, conflicting facts are not used outside dry-run.

**Why this priority**: Required for safe use of multi-source data; only matters once a second source
exists (US4/US5).

**Independent Test**: Import fixture resume and LinkedIn data with a known title/date conflict; check
the conflict is listed, unusable until resolved, and that the chosen value is the one stored after
resolution with both sources recorded.

**Acceptance Scenarios**:

1. **Given** conflicting values for the same experience, **When** the user opens the conflicts screen,
   **Then** both values are shown with source and import date.
2. **Given** a conflict, **When** the user chooses one value, **Then** the fact holds that value, is
   verified, the conflict is closed, and the rejected value stays in history.
3. **Given** a conflict the user marked as "both are true" (two distinct items), **When** resolved,
   **Then** two separate facts exist.
4. **Given** an open conflict, **When** a downstream feature requests facts outside dry-run, **Then**
   the conflicting fact is excluded.

---

### User Story 7 - Daily profile sync (Priority: P3)

Once a day the system re-reads the enabled external sources (GitHub, LinkedIn if enabled) and diffs
them against stored facts. New items arrive unverified; changed items become conflicts; items that
disappeared from a source are flagged, never deleted automatically. The user sees a summary of what
changed.

**Why this priority**: Keeps the base fresh over months of use, but a manual re-import covers the
need initially.

**Independent Test**: Run the sync against two fixture snapshots of the same source and check the
produced additions/changes/removals match the expected diff and that no verified fact was modified.

**Acceptance Scenarios**:

1. **Given** a new repo since last sync, **When** sync runs, **Then** new skill evidence appears as
   unverified facts and in the change summary.
2. **Given** a verified fact whose source value changed, **When** sync runs, **Then** the verified
   value is untouched and a conflict is opened.
3. **Given** a source is unreachable or its session expired, **When** sync runs, **Then** the sync is
   recorded as failed for that source with the reason, other sources still sync, and existing facts are
   untouched.
4. **Given** sync already ran today, **When** triggered again automatically, **Then** it does not run
   twice; a manual "sync now" remains available.

---

### Edge Cases

- Scanned (image-only) or password-protected PDF: extraction reports it cannot read the text and
  offers retry with the vision fallback or manual entry; nothing is invented.
- Resume in Portuguese, English or mixed: content is kept in its original language; no translation
  is stored as a fact.
- Dates written as "atual", "present", "2021 – hoje", month names in pt-BR: normalized; ambiguous
  dates (year only) keep their precision instead of inventing a month.
- Same company written differently across sources ("Itaú" vs "Itau Unibanco"): proposed as the same
  item with the user confirming, not silently merged.
- GitHub API rate limit hit mid-import: import pauses/resumes later; partial results are marked
  incomplete.
- Very large GitHub accounts (hundreds of repos): import completes without user waiting at the screen;
  progress is visible.
- Upload of a non-PDF or oversized file: rejected with a clear message.
- User deletes a fact that a past application used: the fact is archived, not erased, so past
  applications remain explainable.
- Local language model unavailable during upload: the file is stored and parsing is queued and
  retried; user is told.

## Requirements *(mandatory)*

### Functional Requirements

**Facts and provenance**

- **FR-001**: System MUST store every piece of knowledge about the user as a fact with a kind (e.g.
  experience, education, skill, language, certification, project, personal), a value, and one or more
  sources.
- **FR-002**: Each source reference MUST record the origin (base resume, LinkedIn, GitHub,
  user-entered), the import date, and a pointer to the exact origin location (resume section, profile
  section, repo/file path).
- **FR-003**: Each fact MUST carry a verified flag; only facts the user verified are usable outside
  dry-run.
- **FR-004**: Facts MUST keep a change history (previous values, who/what changed them, when); deleting
  a fact MUST archive it rather than erase it.
- **FR-005**: System MUST let the user view, filter (by kind, source, verified, conflict), edit,
  verify, and archive facts, individually and in bulk.

**Base resume**

- **FR-006**: Users MUST be able to upload a PDF resume; the original file MUST be stored and
  retrievable.
- **FR-007**: System MUST extract the resume into a structured standard resume shape using the local
  language model, and present it for review before any fact is created as verified.
- **FR-008**: System MUST flag any extracted item whose text cannot be found in the original document
  text.
- **FR-009**: Re-uploading a resume MUST produce a diff against existing facts rather than duplicate
  facts.

**Personal facts**

- **FR-010**: Users MUST be able to enter: salary expectation (amount, currency, contract type
  CLT/PJ/both), notice period, availability start date, preferred work modes, PCD status, work
  authorization, willingness to relocate.
- **FR-011**: Unanswered sensitive fields MUST be stored as "not provided" and MUST NOT default to a
  yes/no value.

**GitHub**

- **FR-012**: Users MUST be able to connect a GitHub account and import repositories, language
  statistics, READMEs and dependency manifests.
- **FR-013**: System MUST derive skill facts only from concrete evidence (language stats, declared
  dependencies, README mentions) and link each to the repos/files that support it.
- **FR-014**: Derived skill facts MUST carry computed evidence metrics (repo count, most recent
  activity date) calculated deterministically, not by the language model.
- **FR-015**: GitHub-derived facts MUST start unverified.

**LinkedIn**

- **FR-016**: LinkedIn import MUST be opt-in, read-only, and limited to the user's own profile.
- **FR-017**: LinkedIn-imported items MUST start unverified; items identical to existing facts MUST
  add a source to the existing fact instead of creating a new one.

**Conflicts**

- **FR-018**: System MUST detect when sources give different values for the same fact and mark it as
  a conflict.
- **FR-019**: Users MUST be able to resolve a conflict by choosing a value, editing a new value, or
  splitting into separate facts; resolution MUST be recorded in history.
- **FR-020**: Facts with open conflicts MUST NOT be used outside dry-run.

**Resume rendering**

- **FR-021**: System MUST render verified resume facts into a single-column, one-page PDF with
  selectable text in reading order, standard section headings, and text-character bullets.
- **FR-022**: Rendering MUST NOT silently drop content; overflow beyond one page MUST be reported and
  the user MUST choose what to hide.
- **FR-023**: The renderer MUST accept the same structured resume shape that later tailoring
  produces, so tailored resumes reuse it.

**Sync**

- **FR-024**: System MUST run a profile sync at most once per day automatically over enabled external
  sources, and offer a manual "sync now".
- **FR-025**: Sync MUST never modify a verified fact; changes become conflicts, new items become
  unverified facts, vanished items are flagged.
- **FR-026**: Each sync MUST record its outcome per source (success, partial, failed + reason) and a
  change summary visible to the user.
- **FR-027**: Sync MUST respect platform limits: one concurrent request stream per platform and back
  off on rate limits/errors.

**Privacy**

- **FR-028**: Resume files, facts and source credentials MUST stay on the user's own machine; source
  credentials MUST be stored encrypted.
- **FR-029**: Parsing of personal documents MUST use the local language model by default; any use of
  a cloud model MUST be an explicit opt-in.

### Key Entities

- **Profile**: the single user's identity (name, contact, headline); owner of everything below.
- **Base Resume**: an uploaded original document plus its extracted structured version and review
  state (draft, confirmed); multiple versions over time.
- **Fact**: one atomic piece of knowledge (kind, normalized key, value, verified flag, conflict flag,
  archived flag, history); has one or more Source References.
- **Source Reference**: where a fact came from (origin, location pointer, import date, raw value as
  seen in that source).
- **Conflict**: a set of differing values for one fact from different sources, with resolution
  status and chosen outcome.
- **Source Connection**: an external account the user connected (GitHub, LinkedIn), enabled flag,
  encrypted credentials, last sync status.
- **Sync Run**: one execution of profile sync: time, per-source outcome, change summary (added,
  changed, flagged).
- **Rendered Resume**: a generated PDF from a given set of facts and hidden-item choices; regenerable,
  not the source of truth.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user goes from no data to a verified knowledge base from their resume plus personal
  facts in under 15 minutes.
- **SC-002**: On a set of at least 5 fixture resumes, extraction captures at least 95% of items
  correctly before user review, and 100% of extracted items absent from the original text are
  flagged.
- **SC-003**: 0 facts are created without at least one source reference (checked across all imports).
- **SC-004**: Rendered resumes are exactly one page, score 100 on cvlint, and plain text extraction
  returns all rendered items in correct reading order.
- **SC-005**: On fixture source snapshots with known differences, sync and import detect 100% of
  conflicts and modify 0 verified facts.
- **SC-006**: Every GitHub-derived skill can be traced by the user to at least one repo or file in at
  most 2 clicks.
- **SC-007**: Daily sync over GitHub and LinkedIn finishes without user involvement and its change
  summary is visible the next morning.

## Assumptions

- Single user, self-hosted; no multi-account or sharing.
- The resume PDF has a text layer in most cases; image-only PDFs use the vision fallback or manual
  entry.
- GitHub import covers public repositories by default; private repositories are included only if the
  user grants access with their own token.
- LinkedIn session connection (`make linkedin-login`) already exists from F0 tooling; this feature only
  reads the user's own profile through it and does not build the session-connect UI (F5).
- The structured resume shape follows the public JSON Resume standard, extended where needed for
  provenance.
- Original resume files are stored in the project's local object storage (MinIO); facts in the
  project database.
- Salary values are stored as given; the system does not convert currencies or infer missing values.
- UI is in pt-BR; stored facts keep the language of their source.
- Dependency: local LLM models (`qwen3:8b`, `qwen2.5vl:7b`) available via Ollama on the host, as set
  up in F0.
- Out of scope: tailoring per job (F3), answering form questions (F4), cover letters, multi-page
  resume variants, translation of the resume.
