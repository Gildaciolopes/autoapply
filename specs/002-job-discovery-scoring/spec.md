# Feature Specification: Job Discovery and Scoring

**Feature Branch**: `002-job-discovery-scoring`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Discovery and scoring: preferences screen (roles, seniority, stack, Brazil locations, work modes, min salary, blocked companies, excluded keywords, sources on/off, daily caps); sources Gupy portal API, JobSpy (Indeed/Glassdoor/Google, Brazil), LinkedIn MCP; normalize + dedupe hash; embed with bge-m3; score = hard filters → cosine similarity → LLM judge on top N with matched/missing skills and reasons; feed screen."

## Context

F1 gave the system a verified knowledge base of the user. F2 finds tech jobs in Brazil that match
the user's preferences, removes duplicates across job boards, and ranks them with an explainable
score so the user (and later the overnight runs, F6) knows which jobs are worth applying to.
Scoring may only claim a skill "matches" when the user's verified facts back it (constitution §I).
Applying is out of scope (F4/F5).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define search preferences (Priority: P1)

The user sets what they are looking for: target roles (e.g. "Desenvolvedor Full-Stack", "AI
Engineer"), seniority levels, core stack, Brazilian locations, work modes (remote / hybrid /
onsite), minimum salary, companies to never show, keywords that exclude a job, which job sources
are on, and a daily cap per source.

**Why this priority**: Nothing can be searched or filtered without preferences.

**Independent Test**: Save preferences, reload, and check every field persists; turn a source off
and check no search is ever run against it.

**Acceptance Scenarios**:

1. **Given** no preferences, **When** the user opens the screen, **Then** it is pre-filled with
   suggestions derived from the knowledge base (most recent title, verified top skills, city) that
   the user can accept or change; nothing is saved until the user saves.
2. **Given** saved preferences, **When** the user adds a company to the blocked list, **Then** jobs
   from that company disappear from the feed and are never scored again.
3. **Given** a source with daily cap 20, **When** the user lowers it to 5, **Then** at most 5 new
   jobs per day are fetched from that source from then on.
4. **Given** LinkedIn, **When** the user has not explicitly enabled it, **Then** it stays off and
   shows a warning that its terms forbid automation.

---

### User Story 2 - Discover jobs from multiple boards without duplicates (Priority: P1)

The system searches the enabled sources (Gupy, Indeed/Glassdoor/Google Jobs for Brazil, LinkedIn)
using the user's preferences, normalizes every posting into one shape (title, company, location,
work mode, salary range, description, posting date, apply link) and merges the same job seen on
several boards into a single entry that remembers all the places it was found.

**Why this priority**: The raw material for everything after. Without dedupe the feed is noise.

**Independent Test**: Run discovery against recorded responses from each source containing the same
job posted on two boards; the feed shows it once with both origins listed.

**Acceptance Scenarios**:

1. **Given** enabled sources, **When** the user clicks "Buscar agora", **Then** each source is
   queried for each target role, respecting its daily cap, and a run summary shows found / new /
   duplicates / filtered per source.
2. **Given** the same posting on Gupy and Indeed, **When** both are found, **Then** one job exists
   with two origins.
3. **Given** a source fails (site down, session expired, rate limited), **When** discovery runs,
   **Then** other sources still run and the failure is shown with its reason.
4. **Given** a job seen yesterday, **When** found again today, **Then** it is not duplicated and its
   "last seen" date is updated.
5. **Given** daily discovery is enabled, **When** a day passes, **Then** discovery runs once
   automatically (manual runs remain available).

---

### User Story 3 - Score and rank jobs with explanations (Priority: P1)

Every new job goes through three stages: hard filters (blocked company, excluded keyword, work mode,
location, salary below minimum when the job states a salary, seniority mismatch) drop clear
non-matches with a stated reason; the remaining jobs get a similarity score between the job text
and the user's profile; the best N of each run get a detailed judgement from the local language
model listing matched skills, missing skills and short reasons, producing a 0–100 score.

**Why this priority**: The point of F2 — deciding what is worth the user's (and F6's) attention.

**Independent Test**: Score a fixture set of jobs against a fixture profile: excluded ones carry the
right filter reason, the ranking puts the clearly-relevant jobs first, and every "matched" skill
corresponds to a verified fact.

**Acceptance Scenarios**:

1. **Given** a job from a blocked company, **When** scored, **Then** it is filtered with reason
   "empresa bloqueada" and never reaches the language model.
2. **Given** a remote-only preference and an onsite job in another city, **When** scored, **Then**
   it is filtered with reason "modalidade/local".
3. **Given** a job without stated salary, **When** a minimum salary is set, **Then** it is NOT
   filtered for salary (unknown is not below minimum) and the card shows "salário não informado".
4. **Given** passing jobs, **When** ranked, **Then** only the top N by similarity (default 20 per
   run) get the detailed judgement; the rest keep their similarity-based score and are marked
   "não avaliado em detalhe".
5. **Given** a judged job, **When** the user opens it, **Then** they see the score, matched skills
   (each linked to the fact that backs it), missing skills, and reasons.
6. **Given** the language model claims a matched skill the user has no verified fact for, **When**
   the judgement is stored, **Then** that skill is moved to "missing" (never shown as matched).

---

### User Story 4 - Browse the job feed (Priority: P2)

The user sees a ranked feed of discovered jobs with score, title, company, location/work mode,
salary when known, source badges, posting age and matched/missing skills. They can filter (score
range, source, work mode, judged/not judged, new since last visit, show filtered-out), open the
original posting, hide a job, block its company in one click, or mark it "interessante".

**Why this priority**: The user-facing payoff; the morning review in F6 builds on it.

**Independent Test**: With fixture jobs loaded, filter by work mode and score, hide one job and block
one company; the feed updates accordingly and hidden/blocked jobs stay hidden after reload.

**Acceptance Scenarios**:

1. **Given** scored jobs, **When** the user opens the feed, **Then** jobs are ordered by score
   descending, newest first among equal scores.
2. **Given** a job card, **When** the user clicks "bloquear empresa", **Then** the company is added
   to preferences and all its jobs leave the feed.
3. **Given** filtered-out jobs, **When** the user toggles "mostrar filtradas", **Then** they appear
   greyed with their filter reason.
4. **Given** a job that disappeared from its source, **When** shown, **Then** it is marked
   "possivelmente encerrada" rather than removed.

---

### User Story 5 - Re-score when preferences or knowledge change (Priority: P3)

When the user changes preferences or their verified facts change, existing open jobs are re-scored
so the feed reflects the current profile.

**Why this priority**: Keeps the feed honest over time; manual re-run is an acceptable stopgap.

**Independent Test**: Block a company and add a verified skill; re-score; jobs from that company
are filtered and jobs needing that skill move from missing to matched.

**Acceptance Scenarios**:

1. **Given** changed preferences, **When** saved, **Then** hard filters are re-applied to all
   unexpired jobs immediately (no language model needed).
2. **Given** changed verified facts, **When** the user triggers "reavaliar", **Then** similarity is
   recomputed for all and detailed judgement for the new top N.

---

### Edge Cases

- Job posted in English, or with mixed pt/en text: handled the same; matching is language-agnostic.
- Same job reposted by the company with a new date or slightly edited title: treated as the same job
  when company + normalized title + location match (the existing job is re-opened, not duplicated).
- Recruiting agencies posting on behalf of a hidden company: shown as the agency; blocking applies
  to the name shown.
- Salary given as range, per hour, per year, "a combinar", or PJ vs CLT: normalized to monthly BRL
  when unambiguous; otherwise kept as text and treated as unknown for filtering.
- Very long or empty descriptions: empty description → cannot be judged in detail; scored by title
  only and marked accordingly.
- A source returns hundreds of results: only up to the daily cap of *new* jobs are kept.
- LinkedIn session expired: LinkedIn marked failed with hint to reconnect; others proceed.
- Captcha or blocking page from a site: the source run stops for the day (no evasion), reason shown.
- The language model is unavailable: jobs keep similarity scores and are queued for judgement later.
- Knowledge base empty or unverified: discovery still works; scoring explains it cannot match skills
  until facts are verified.

## Requirements *(mandatory)*

### Functional Requirements

**Preferences**

- **FR-001**: Users MUST be able to set roles, seniority levels, stack, Brazilian locations, work
  modes, minimum monthly salary (and contract type it refers to), blocked companies, excluded
  keywords, enabled sources and per-source daily caps.
- **FR-002**: The system MUST suggest initial preferences from verified facts but MUST NOT save
  them without user action.
- **FR-003**: LinkedIn MUST be off by default and require explicit opt-in with a terms warning;
  its daily cap MUST default lower than other sources.

**Discovery**

- **FR-004**: The system MUST query each enabled source per target role and location, and MUST
  stop fetching new jobs from a source once its daily cap is reached.
- **FR-005**: The system MUST normalize every posting to a common shape and keep the original link
  and the source-specific id.
- **FR-006**: The system MUST deduplicate postings across sources and over time, merging origins
  into one job and updating "last seen".
- **FR-007**: A failing source MUST NOT stop other sources; each run MUST record per-source outcome
  (found, new, duplicates, filtered, error reason).
- **FR-008**: The system MUST NOT solve captchas or evade anti-bot measures; a challenge stops that
  source for the day.
- **FR-009**: Users MUST be able to run discovery on demand; an automatic daily run MUST be
  configurable (at most once per day).

**Scoring**

- **FR-010**: Hard filters MUST run first and record the reason; filtered jobs MUST NOT be sent to
  the language model.
- **FR-011**: Unknown salary, unknown work mode or unknown seniority MUST NOT cause a job to be
  filtered.
- **FR-012**: Passing jobs MUST receive a similarity score against the user's profile built only
  from verified facts and preferences.
- **FR-013**: The top N passing jobs per run (configurable, default 20) MUST receive a detailed
  judgement: score 0–100, matched skills, missing skills, reasons.
- **FR-014**: Every matched skill MUST map to at least one verified fact; any claimed match without
  such a fact MUST be moved to missing (deterministic check, no language model).
- **FR-015**: Scores and judgements MUST be stored with the model and date used, so they are
  explainable later.
- **FR-016**: Changing preferences MUST re-apply hard filters to open jobs; the user MUST be able
  to trigger a full re-score.

**Feed**

- **FR-017**: The feed MUST list jobs by score with filters (score range, source, work mode, judged,
  new, show filtered) and actions (open original, hide, block company, mark interesting).
- **FR-018**: Hidden jobs and blocked companies MUST stay hidden across sessions.
- **FR-019**: Jobs not seen at their source for 14 days MUST be marked "possivelmente encerrada".

**Privacy and platforms**

- **FR-020**: Only search queries (roles, locations) are sent to job sources; no personal data and no
  resume content leave the machine during discovery and scoring.
- **FR-021**: Job data and scores MUST stay local.

### Key Entities

- **Search Preference**: the user's criteria (roles, seniority, stack, locations, work modes,
  minimum salary, blocked companies, excluded keywords, judge top-N, auto-discovery on/off).
- **Job Source**: a board (Gupy, Indeed, Glassdoor, Google Jobs, LinkedIn) with enabled flag, daily
  cap, today's usage and last run outcome.
- **Job**: one real posting after dedupe: normalized fields, origins (source + external id + link),
  first/last seen, status (open, possibly closed, hidden), user mark (interesting).
- **Company**: name as shown, blocked flag.
- **Discovery Run**: one execution: trigger, per-source counts and errors.
- **Job Score**: filter result (passed / reason), similarity, detailed judgement (score, matched
  skills with backing fact ids, missing skills, reasons), model, date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user goes from empty preferences to a ranked feed in under 10 minutes, including
  one discovery run.
- **SC-002**: On a fixture set with known duplicates across boards, 100% of duplicates are merged and
  0 distinct jobs are wrongly merged.
- **SC-003**: 0 jobs from blocked companies or containing excluded keywords appear in the default
  feed.
- **SC-004**: 100% of matched skills shown in the feed are backed by a verified fact.
- **SC-005**: On a labelled fixture set of 30 jobs (relevant / not relevant to a fixture profile),
  at least 8 of the 10 top-ranked jobs are labelled relevant.
- **SC-006**: A discovery + scoring run of 100 new jobs completes overnight-compatible: under 30
  minutes on the reference machine, never exceeding any source's daily cap.
- **SC-007**: A failure of any single source never prevents the others from delivering jobs.

## Assumptions

- Brazil-only jobs; tech roles. Location list uses Brazilian cities/states plus "Remoto (Brasil)".
- Gupy is queried through its public job-search endpoint (no login); Indeed / Glassdoor / Google Jobs
  through the existing scraper service; LinkedIn through the already-connected read-only session
  (F0 tooling). Greenhouse/Lever/Ashby boards and smaller Brazilian boards are out of scope for F2.
- Default daily caps: 50 per non-LinkedIn source, 15 for LinkedIn; default judge top-N = 20.
- The user profile used for similarity and judgement is built only from usable facts (verified,
  active, conflict-free) plus preferences; unverified facts are ignored outside dry-run.
- Similarity uses the local embedding model and judgement the local language model already set up
  (F0/F1); no cloud calls.
- Salary normalization: monthly BRL; when the posting gives an annual value it is divided by 12 (CLT
  13th salary not inferred); other currencies are not converted and count as unknown for filtering.
- Overnight scheduling, notifications and application are later features (F3–F6); F2 offers manual
  runs plus a simple optional daily run.
- Job descriptions may be fetched in full in an enrichment step when the search result only has a
  snippet, within the same daily caps.
