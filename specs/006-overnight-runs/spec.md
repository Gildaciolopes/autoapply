# Feature Specification: Overnight Runs

**Feature Branch**: `006-overnight-runs`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "F6 — Overnight: BullMQ repeatable schedule from `SearchPreference.scheduleCron`, review queue with batch approve, AnswerMemory learning loop, kill switch, Telegram morning report, live log via SSE."

## Overview

Features F1–F5 give the user every building block: a verified knowledge base, job discovery and
scoring, grounded tailoring, form preparation in simulation, logged-in platforms and approved real
submission. Each step is still started by hand. F6 chains them into one unattended night: at the
scheduled time the system discovers jobs, tailors the best matches and prepares their applications
(never submitting anything without approval), while respecting every platform limit. In the morning
the user receives a short report on their phone, opens one review queue, approves in batch and the
approved applications are sent. Answers the user gives or corrects are learned so the next night asks
less. The user can watch a night live and stop everything at any moment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scheduled overnight run (Priority: P1)

The user turns on "Execução noturna" and keeps the default window (23:00–06:59, São Paulo time) or
edits it. Every night inside the window the system runs a pipeline: discover new jobs, score them,
tailor resumes for the best-scored jobs above the user's threshold, and prepare (simulate) their
applications. Prepared applications wait for review; nothing is ever submitted during the night
unless it was already approved by the user. Each night is one "run" with a start, an end, counters
per step and a final status.

**Why this priority**: it is the core promise of the product ("runs overnight"); every other story
consumes what the night produces.

**Independent Test**: with schedule enabled and a short test window, a run starts by itself, goes
through discovery → scoring → tailoring → preparation on fixture jobs and ends with prepared
applications in `ready` and zero submissions.

**Acceptance Scenarios**:

1. **Given** the overnight schedule is on, **When** the window starts, **Then** exactly one run
   starts for that night, even if the system was restarted or the trigger fires more than once.
2. **Given** a run is in progress, **When** it prepares applications, **Then** it never exceeds the
   nightly application budget, each platform's daily cap, minimum interval or concurrency 1.
3. **Given** the window ends while work remains, **When** the end time is reached, **Then** the run
   stops starting new work, finishes the current step safely and records what was left pending.
4. **Given** the mode is "Simulação" or "Revisão", **When** the run ends, **Then** zero
   applications were submitted except ones the user had approved before or during the run.
5. **Given** a step fails (e.g. a source is down, the local AI is unavailable), **When** the run
   continues, **Then** the failure is recorded, the remaining steps that do not depend on it still
   run, and the run ends as "partial" instead of crashing.
6. **Given** the schedule is off, **When** the window passes, **Then** no run starts; the user can
   still start a run manually ("Rodar agora").

---

### User Story 2 - Morning review queue with batch approve (Priority: P1)

In the morning the user opens one "Revisão" screen listing everything the night left: applications
ready to send (job, company, score, tailored resume, answers with confidence and evidence),
applications needing input (with the exact questions), and failures. The user can approve one,
approve a selection or approve all that pass a filter, reject (with reason, so the job is not
retried), or answer pending questions inline. Approved applications are then sent following the F5
submit rules and platform limits.

**Why this priority**: review mode is the default; without a fast review the night produces work
nobody consumes.

**Independent Test**: after a fixture run, the queue shows ready/needs-input/failed groups with
counts matching the run; batch approving 3 items sends exactly 3 to the submit path, rejecting 1
removes it from future runs.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the user opens the review queue, **Then** items are grouped
   (ready, needs input, failed, uncertain) and ordered by score, with the run they came from.
2. **Given** the user selects items and approves in batch, **When** the confirmation is accepted,
   **Then** each selected item is approved exactly as shown (same approval guarantee as F5) and
   queued for submission in platform-limit order.
3. **Given** an item needs input, **When** the user answers inline, **Then** the item is
   re-prepared and returns to the queue as ready (or with the next question).
4. **Given** the user rejects an item, **When** future runs happen, **Then** that job is never
   prepared again and the rejection reason is kept.
5. **Given** the mode is "Simulação", **When** the user opens the queue, **Then** approval is
   disabled with an explanation, as in F5.
6. **Given** an item was approved but the platform cap for today is reached, **When** submission
   is attempted, **Then** it waits for the next allowed slot and the queue shows "aguardando limite".

---

### User Story 3 - Kill switch across the whole night (Priority: P1)

A single, always-visible "Parar tudo" control stops the current run and everything queued:
discovery, tailoring, preparation and approved-but-not-sent submissions. A stopped system stays
stopped (scheduled nights do not start) until the user resumes it.

**Why this priority**: constitution §II requires a working kill switch; unattended operation makes
it critical.

**Independent Test**: during a fixture run, pressing stop leaves zero jobs running within the stop
time limit, no further submissions, and the next scheduled trigger does not start a run until
resumed.

**Acceptance Scenarios**:

1. **Given** a run is in progress, **When** the user presses "Parar tudo", **Then** no new step
   starts, the step in progress aborts at its next safe point, and the run ends as "stopped".
2. **Given** approved applications are waiting to be sent, **When** the user stops, **Then** none is
   sent and their approvals are cleared (F5 behaviour), visible in the queue.
3. **Given** the system is stopped, **When** the scheduled time arrives, **Then** no run starts and
   the morning report says the system is paused.
4. **Given** the system is stopped, **When** the user presses "Retomar", **Then** scheduling resumes
   from the next window; nothing stopped earlier restarts automatically.
5. **Given** the stop is pressed from the phone report message, **When** the command is received,
   **Then** it has the same effect as the UI control.

---

### User Story 4 - Morning report on the phone (Priority: P2)

At the end of each run (and at a configurable morning time if the run already ended) the user
receives a short message in a private chat bot: jobs found, scored above threshold, tailored,
prepared ready, needing input, failed, submitted (approved ones), platform pauses or expired
sessions, and a link to the review queue. The message contains no personal data beyond job titles
and company names. The user can also send "parar" / "status" to the bot.

**Why this priority**: valuable for the morning routine, but the review queue already works without
it.

**Independent Test**: with a fake messaging endpoint, a finished fixture run produces exactly one
report whose counters match the run; a "parar" message from the configured chat triggers the kill
switch, the same message from any other chat is ignored.

**Acceptance Scenarios**:

1. **Given** the bot is configured, **When** a run ends, **Then** exactly one report is sent for that
   run, even after retries or restarts.
2. **Given** the bot is not configured, **When** a run ends, **Then** nothing is sent and the report
   is still visible in the UI.
3. **Given** sending fails, **When** retries are exhausted, **Then** the run is not affected and the
   UI shows the report as "não enviado".
4. **Given** a message comes from a chat that is not the configured one, **When** it is received,
   **Then** it is ignored and never acted upon.
5. **Given** a session expired or a platform was paused during the night, **When** the report is
   built, **Then** it says so first, with what the user must do.

---

### User Story 5 - Answer memory learning loop (Priority: P2)

Every answer the user provides or corrects (inline in the review queue, in needs-input, or by
editing a prepared answer before approving) becomes a reusable memory, so the same question on
another form is answered the same way next night without asking. The user can see, edit, disable
and delete memories, and see how often each was reused. Memories never override the knowledge base
rules: they are only reused for questions with the same meaning and compatible field type, and only
answers the user confirmed are reused.

**Why this priority**: it makes each night ask less, but the night already works with needs-input.

**Independent Test**: answer a question on fixture form A; run on fixture form B with the same
question worded differently; B is prepared without asking, citing the memory; disabling the memory
makes B ask again.

**Acceptance Scenarios**:

1. **Given** the user edits a prepared answer before approving, **When** the approval is saved,
   **Then** the corrected answer is stored as a confirmed memory and the original is not.
2. **Given** a confirmed memory matches a new question, **When** the form is prepared, **Then** the
   answer is reused, marked as coming from memory, and its use count increases.
3. **Given** a memory is disabled or deleted, **When** the same question appears, **Then** it is no
   longer reused.
4. **Given** a memory answer contradicts a verified fact (e.g. years of experience), **When** it would
   be reused, **Then** the fact wins and the conflict is shown to the user.
5. **Given** an answer was generated by the AI and never confirmed by the user, **When** memories are
   listed, **Then** it is not a memory.

---

### User Story 6 - Live log of the run (Priority: P3)

While a run is in progress the user can open a "Ao vivo" view showing each step as it happens
(source searched, job scored, resume tailored, form prepared, item parked, limit reached) with
timestamps, updating without reloading. Finished runs keep their full event history.

**Why this priority**: observability and trust, not required for the night to work.

**Independent Test**: during a fixture run the live view receives events in order within a few
seconds of each step; reopening after the run shows the same history.

**Acceptance Scenarios**:

1. **Given** a run is in progress, **When** the user opens the live view, **Then** it shows the past
   events of the run and then new ones as they happen.
2. **Given** the connection drops, **When** it reconnects, **Then** missing events are filled in
   without duplicates.
3. **Given** no run is in progress, **When** the user opens the view, **Then** it shows the last run's
   history and when the next one is scheduled.

### Edge Cases

- Computer asleep or system down at window start → the run starts when the system is back if still
  inside the window; if the window passed, it is skipped and recorded as "perdida" in the report.
- A manual run is in progress when the window starts → no second run; the scheduled one is recorded
  as merged.
- Window crossing midnight (23:00–06:59) belongs to the night it started.
- User changes the schedule while a run is in progress → applies to the next run.
- Local AI unavailable → discovery-only steps still run; tailoring/preparation park with a clear
  reason; report says so.
- No new jobs → the run ends "ok" with zero counters and the report says "nada novo".
- Same job found again on later nights → never prepared twice; rejected jobs never return.
- Session expires mid-run → that platform's items park as needs-input (F5), other platforms continue.
- Bot token invalid → report marked "não enviado", a warning shown in the UI, run unaffected.
- Kill switch pressed during a submission click → that submission follows F5 rules (submitted or
  uncertain, never retried); nothing else is sent.
- Memory question matches but field type differs (free text vs. yes/no) → not reused.

## Requirements *(mandatory)*

### Functional Requirements

**Scheduling and runs**

- **FR-001**: The user MUST be able to enable/disable overnight runs and edit the window (start and
  end time, days of week) in São Paulo time; defaults: disabled, 23:00–06:59, every day.
- **FR-002**: The system MUST start at most one run per night window, idempotently across restarts
  and duplicate triggers, and allow a manual "Rodar agora" outside the window (still one run at a
  time).
- **FR-003**: A run MUST execute in order: discovery → scoring → tailoring of the top jobs above the
  score threshold → preparation (simulation) of their applications → submission of applications
  already approved by the user (only in review mode, within platform limits).
- **FR-004**: A run MUST respect a nightly budget (max jobs tailored and applications prepared per
  night, default 20) in addition to every F5 platform cap, minimum interval, backoff and
  concurrency 1.
- **FR-005**: When the window ends, the run MUST stop starting new work, end the current step at a
  safe point and record pending work; pending work is not carried silently into the day.
- **FR-006**: A step failure MUST be recorded and MUST NOT abort independent steps; run final status
  is one of ok, partial, failed, stopped, skipped.
- **FR-007**: A run MUST never submit an application that was not approved by the user, in any mode.
  Autopilot stays out of scope.
- **FR-008**: The system MUST never prepare the same job twice nor prepare a rejected job.

**Review queue**

- **FR-009**: The system MUST provide one review queue grouping items as ready, needs input, failed,
  uncertain and waiting-for-limit, with counts, run of origin and ordering by score.
- **FR-010**: The user MUST be able to approve one, a selection, or all visible items after a
  confirmation summary (count, platforms, estimated send time given caps).
- **FR-011**: The user MUST be able to reject an item with a reason; rejected jobs are excluded from
  all future runs.
- **FR-012**: The user MUST be able to answer pending questions and edit a prepared answer inline;
  an edited item is re-prepared before it can be approved.

**Kill switch**

- **FR-013**: One always-visible control MUST stop the current run, all queued work and all
  approved-not-sent submissions, and pause scheduling until the user resumes.
- **FR-014**: After stop, no new step MUST start and in-progress steps MUST abort at their next safe
  point within 30 seconds (except an already-clicked submission, which follows F5 rules).
- **FR-015**: Resume MUST only re-enable scheduling; stopped items do not restart automatically.

**Morning report**

- **FR-016**: When a run ends, the system MUST build a report (counters per step, needs-input
  count, submissions, platform pauses/expired sessions first, link to the review queue) and show it
  in the UI.
- **FR-017**: If a private chat bot is configured, the system MUST send exactly one report message
  per run; failure to send MUST NOT affect the run and MUST be visible in the UI.
- **FR-018**: The report message MUST NOT include personal data (contact info, salary, answers,
  documents); job titles, companies and counts only.
- **FR-019**: The bot MUST accept only "parar", "retomar" and "status" commands and only from the
  configured chat; everything else is ignored. "parar" has the same effect as FR-013.

**Answer memory**

- **FR-020**: Answers provided or corrected by the user (needs input, inline answer, edit before
  approval) MUST be stored as confirmed memories; AI-generated answers the user did not touch MUST
  NOT become memories.
- **FR-021**: Preparation MUST reuse a confirmed, enabled memory only for a question with the same
  meaning and compatible field type, mark the answer as from memory and count the use.
- **FR-022**: A verified knowledge-base fact MUST win over a conflicting memory; the conflict MUST be
  shown to the user.
- **FR-023**: The user MUST be able to list, search, edit, disable and delete memories and see use
  counts and last use.

**Live log**

- **FR-024**: Each run MUST record ordered, timestamped events per step (start, item outcome, limit
  reached, error, end).
- **FR-025**: The UI MUST stream a run's events live, replaying past events on open and after
  reconnects without duplicates or gaps.

### Key Entities

- **Night Schedule**: enabled flag, window start/end, days of week, timezone, paused-by-kill-switch
  state, nightly budget, morning report time.
- **Run**: one night (or manual) execution: trigger (schedule/manual), night date, start/end, status
  (running, ok, partial, failed, stopped, skipped), per-step counters, pending work, report.
- **Run Event**: ordered event of a run: time, step, type, related job/application, message.
- **Review Item**: an application from a run as seen in the queue: group, score, platform,
  approval/rejection state, rejection reason.
- **Answer Memory** (exists since F4): question, normalized meaning, field type, answer, evidence,
  confirmed, enabled, origin (needs-input, inline, edit), use count, last used.
- **Report Delivery**: run, channel, status (sent, not sent, not configured), attempts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A full night runs unattended in review mode: from window start to report with zero
  manual steps and zero unapproved submissions (verified on fixtures and on one real night).
- **SC-002**: 100% of runs end with a recorded final status and a report, including failed, stopped
  and skipped nights.
- **SC-003**: The user reviews and approves a night of 20 prepared applications in under 10 minutes.
- **SC-004**: After stop, nothing new starts and running work ends within 30 seconds; zero
  submissions after the stop except one already clicked.
- **SC-005**: Over successive nights, the share of applications parked for needs-input decreases;
  a question answered once is not asked again for the same meaning (verified on fixtures).
- **SC-006**: Zero personal data in report messages (verified by test on the message content).
- **SC-007**: Live events appear in the UI within 5 seconds of happening.
- **SC-008**: Platform caps and intervals are never exceeded during a run (0 violations in tests).

## Assumptions

- Single user on their own Mac; the night runs only while the machine and services are up (no
  wake-from-sleep). Missed windows are reported, not recovered later.
- The existing `scheduleCron` preference is replaced by an explicit window (start/end/days) because a
  window, not a repeating trigger, is what the user configures; the hourly-trigger form is an
  implementation choice.
- "Telegram" is the private chat bot channel (token and chat id already in `.env.example`); the user
  creates the bot themselves. No other channel in F6.
- Autopilot (submitting without approval) stays out of scope; constitution §II requires extra gates
  that F6 does not add. The night only submits applications the user approved.
- Discovery, scoring, tailoring, preparation and submission reuse F2–F5 behaviour and limits
  unchanged; F6 orchestrates them.
- The F4 needs-input answer already writes a memory; F6 extends it to inline answers and pre-approval
  edits, adds enable/disable, use tracking and the management screen.
- Default nightly budget 20 applications; morning report time defaults to the end of the window.
- The UI is local (no remote access); the report link points to the local web address.
