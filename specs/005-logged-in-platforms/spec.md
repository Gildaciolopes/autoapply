# Feature Specification: Logged-in Platforms and Assisted Real Submission

**Feature Branch**: `005-logged-in-platforms`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Logged-in platforms: Gupy and LinkedIn Easy Apply adapters, session connect flow (`make linkedin-login`, Playwright storageState encrypted), per-source daily caps, concurrency 1."

## Context

F4 fills public application forms in dry-run and proves the answers are grounded. F5 adds the two
platforms that require the user's own account — Gupy (most Brazilian tech jobs) and LinkedIn Easy
Apply — and the first **real submissions**, always in **review mode**: the system prepares the
application (filled form, answers, attachments, screenshots) and sends it only after the user
approves that specific application (constitution §II). Sessions come from the user logging in
manually in a browser window the system opens; passwords are never typed or stored by the system,
only the resulting session, encrypted. Submission respects per-platform daily caps, one application
at a time per platform, and stops at any captcha, expired session or uncertainty (constitution §III).
Overnight unattended runs and autopilot are out of scope (F6).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a platform account (Priority: P1)

In "Plataformas", the user clicks "Conectar Gupy" (or "Conectar LinkedIn"). A browser window opens on
the platform's own login page; the user signs in there (including two-factor or captcha, by
themselves) and closes the window or clicks "Concluí". The system stores the resulting session
encrypted, shows the platform as "conectada" with the account name when visible, and can test or
disconnect it at any time.

**Why this priority**: Nothing on Gupy or LinkedIn can be filled without the user's session.

**Independent Test**: Connect with a recorded session fixture; the stored session is unreadable
without the encryption key, the status shows "conectada", "Testar sessão" reports valid, and
"Desconectar" deletes it.

**Acceptance Scenarios**:

1. **Given** no Gupy session, **When** the user clicks "Conectar Gupy" and signs in in the window,
   **Then** the session is saved encrypted and the platform shows "conectada" with the time of login.
2. **Given** a saved session, **When** the user clicks "Testar sessão", **Then** the system opens a
   logged-in page and reports "válida" or "expirada" without changing anything on the account.
3. **Given** a saved session, **When** the user clicks "Desconectar", **Then** the stored session is
   deleted and pending applications for that platform move to "precisa de você" (reason "login necessário").
4. **Given** any connect flow, **When** it runs, **Then** the system never fills the password field,
   never reads or stores the password, and never solves the platform's captcha or two-factor step.
5. **Given** LinkedIn, **When** the user connects it, **Then** the UI first warns that LinkedIn's terms
   forbid automation, that the daily cap is low by default, and requires an explicit "Entendo e quero
   usar" confirmation.

---

### User Story 2 - Simulate and prepare applications on Gupy and LinkedIn Easy Apply (Priority: P1)

With a connected platform, "Simular candidatura" on a Gupy job or a LinkedIn job with Easy Apply works
like F4: the system opens the application with the user's session, walks through every step, fills
the fields with grounded answers (F4 rules), attaches the tailored resume, takes screenshots, and
stops right before the final submit with status "pronto para enviar" or "precisa de você".

**Why this priority**: Gupy and LinkedIn carry most of the user's target jobs; preparing them
correctly is the precondition for real submission.

**Independent Test**: On saved copies of a Gupy application flow and a LinkedIn Easy Apply modal
(multi-step), all standard fields are filled from facts, the resume is attached, each step has a
screenshot and nothing is submitted.

**Acceptance Scenarios**:

1. **Given** a connected Gupy session and a Gupy job, **When** simulating, **Then** every step of the
   Gupy flow (personal data, resume, screening questions) is filled or listed as "precisa de você",
   with one screenshot per step, and the final "Enviar" is not activated.
2. **Given** a LinkedIn job without Easy Apply (external apply link), **When** simulating, **Then** the
   system follows the external link and uses the F4 engine (Greenhouse/Lever/Ashby/generic).
3. **Given** the platform already has the user's resume or answers pre-filled, **When** simulating,
   **Then** pre-filled values are kept if they match the facts, replaced if they differ, and the
   choice is recorded per field.
4. **Given** the session expired, **When** simulating, **Then** the result is "precisa de você" with
   reason "sessão expirada" and the platform shows "reconectar".
5. **Given** the job was already applied to on the platform ("Você já se candidatou"), **When**
   simulating, **Then** the result is "já candidatado" and nothing is filled.

---

### User Story 3 - Review and approve real submission (Priority: P1)

Applications in "pronto para enviar" appear in a review list. The user opens one, sees the job, the
filled form screenshots, every answer with its evidence, the attached resume, and clicks "Aprovar e
enviar" (or selects several and approves in batch). The system then re-opens the application, fills
it again with exactly the approved answers, verifies the page matches, submits it, captures the
confirmation, and marks it "enviada". Anything different from what was approved stops the submission.

**Why this priority**: This is the roadmap exit criterion ("assisted real submissions in review mode")
and the first time the system acts on the user's behalf.

**Independent Test**: On a local test form that records submissions, approving a prepared application
submits exactly the approved values once, stores before/after/confirmation screenshots, and marks it
"enviada"; changing one field on the page between preparation and approval blocks the submission.

**Acceptance Scenarios**:

1. **Given** an application in "pronto para enviar", **When** the user clicks "Aprovar e enviar",
   **Then** it is submitted once, a confirmation screenshot is stored, the status becomes "enviada"
   with the submission time, and the answers sent are kept as the record of what was sent.
2. **Given** the form changed since preparation (new required question, different options), **When**
   submitting, **Then** the system does not submit and returns the application to "precisa de você"
   with reason "formulário mudou".
3. **Given** a facts change since preparation (application outdated), **When** the user tries to
   approve, **Then** approval is refused until it is simulated again.
4. **Given** the mode is dry-run, **When** the user opens the review list, **Then** "Aprovar e enviar"
   is disabled with the explanation "modo simulação: nada é enviado".
5. **Given** a confirmation is not detected after submitting, **When** finishing, **Then** the status is
   "envio incerto" with the screenshot, and the system never submits a second time automatically.
6. **Given** the user approves several applications, **When** they run, **Then** they are submitted one
   at a time per platform, respecting daily caps; the rest wait for the next day.

---

### User Story 4 - Assisted submit when the platform asks for a human (Priority: P2)

Some forms show a captcha or a human check only at submit time (common on Lever and LinkedIn). When
that happens during an approved submission, the system does not try to solve it: it opens the
prepared application in a visible browser window for the user, already filled, and asks them to
complete the check and click submit themselves. The system detects the confirmation and records the
application as "enviada (assistida)".

**Why this priority**: Makes captcha-protected forms usable without ever bypassing captchas.

**Independent Test**: On a local test form with a "human check" step, an approved submission opens a
visible window, waits, and records "enviada (assistida)" after the user's click (simulated in test).

**Acceptance Scenarios**:

1. **Given** an approved application whose form shows a captcha at submit, **When** submitting, **Then**
   a visible window opens with the form filled and a banner "Conclua a verificação e clique em
   enviar", and the system waits up to 15 minutes.
2. **Given** the user completes and submits, **When** the confirmation appears, **Then** the status is
   "enviada (assistida)" with the confirmation screenshot.
3. **Given** the user closes the window or the time runs out, **When** finishing, **Then** the
   application returns to "precisa de você" (reason "verificação humana") and nothing is submitted.

---

### User Story 5 - Per-platform daily caps, pacing and backoff (Priority: P2)

Each platform has a daily cap of real submissions and of simulations (defaults: Gupy 15 submissions /
30 simulations, LinkedIn 5 / 10, public tracking systems 20 / 30), a minimum interval between actions
on the same platform, and backoff after errors. The user sees today's usage per platform and can
lower or raise caps within safe limits.

**Why this priority**: Constitution §III; protects the user's accounts from being flagged.

**Independent Test**: With a cap of 2 for Gupy, approving 4 applications submits 2 today and keeps 2
waiting for tomorrow; two consecutive platform errors pause that platform for the backoff period.

**Acceptance Scenarios**:

1. **Given** a platform reached its daily submission cap, **When** more are approved, **Then** they wait
   for the next day with reason "limite diário" and the UI shows when they will run.
2. **Given** two applications on the same platform, **When** they run, **Then** there is at least the
   minimum interval (default 60 s Gupy, 180 s LinkedIn) between them, and never two at once.
3. **Given** a platform returns errors, rate-limit pages or unusual-activity warnings, **When** detected,
   **Then** the platform is paused (backoff: 1 h, then 4 h, then until the user resumes) and pending
   applications wait; an "atividade incomum" warning pauses the platform until the user resumes.
4. **Given** the user sets a cap above the safe maximum (Gupy 40, LinkedIn 15), **When** saving, **Then**
   it is refused with the limit explained.

### Edge Cases

- Session valid but the platform shows a consent/terms update page → stop, "precisa de você"
  ("ação na plataforma"); never accept terms on the user's behalf.
- Gupy job requires a test (online test, video, game) after the form → the form part is submitted
  only if the user approved knowing it; the test is shown as a follow-up the user does themselves.
- LinkedIn Easy Apply asks for a phone verification or "follow company" checkbox pre-checked →
  verification stops the flow; "follow company" is unchecked unless the user has a stored preference.
- The same job exists on Gupy and LinkedIn (dedupe) → only one application per job; the user picks the
  platform; default is the employer's own system.
- Approval given, then the user turns on the kill switch before it runs → nothing is submitted.
- Network drops in the middle of the final submit → status "envio incerto"; never resubmitted
  automatically; the user checks on the platform and marks it.
- Encryption key missing or changed → stored sessions are unusable and shown as "reconectar"; no
  plaintext fallback.
- Two-factor prompt during "Testar sessão" → treated as expired.
- Screenshots and sessions contain personal data → stored only locally, sessions encrypted, deleted
  on disconnect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to connect, test and disconnect a Gupy and a LinkedIn account from
  the UI; connecting opens a visible browser window on the platform's own login page where the user
  signs in themselves.
- **FR-002**: The system MUST NOT type, read, store or transmit the user's platform passwords, and MUST
  NOT solve captchas or two-factor steps in any flow.
- **FR-003**: Platform sessions MUST be stored encrypted with a key that lives only in the local
  configuration; without the key a session MUST be unusable; disconnect MUST delete it.
- **FR-004**: LinkedIn MUST be opt-in behind an explicit confirmation that states the terms-of-service
  risk, and MUST have a lower default cap than other platforms.
- **FR-005**: The system MUST prepare applications on Gupy and LinkedIn Easy Apply with the F4 rules
  (grounded answers, blocking reasons, screenshots per step, no submission during preparation);
  LinkedIn jobs without Easy Apply MUST use the F4 public-form engine via the external link.
- **FR-006**: Expired sessions, already-applied jobs, platform action pages (terms, verification) and
  unusual-activity warnings MUST be detected and reported with specific reasons.
- **FR-007**: A real submission MUST happen only for an application the user approved individually or
  in an explicit batch selection, in review mode, not outdated, and only through a submit path that
  is separate from the dry-run engine.
- **FR-008**: Before submitting, the system MUST re-fill the form with exactly the approved answers and
  verify the page (fields, options, required questions) matches what was approved; any difference MUST
  block the submission with reason "formulário mudou".
- **FR-009**: Each application MUST be submitted at most once by the system; when the outcome is unknown
  the status MUST be "envio incerto" and the system MUST NOT retry the submit automatically.
- **FR-010**: Every submission MUST store before, filled and confirmation screenshots and the exact
  values sent, and emit an event per step (constitution §VI).
- **FR-011**: When a captcha or human check appears at submit time, the system MUST offer an assisted
  submit: a visible window with the approved values filled where the user completes the check and
  submits; the system records the result and never interacts with the captcha itself.
- **FR-012**: The system MUST enforce, per platform, a daily cap for submissions and for simulations,
  a minimum interval between actions, concurrency 1, and backoff/pause on errors and warnings; caps
  MUST be user-adjustable within safe maximums.
- **FR-013**: The kill switch MUST cancel pending approved submissions as well as simulations; a
  submission that has not reached the final click MUST NOT be sent after the switch is pressed.
- **FR-014**: The review list MUST show prepared applications with job, platform, screenshots, answers
  with evidence and the resume, and allow single and batch approval; in dry-run mode approval MUST be
  disabled.
- **FR-015**: The platforms view MUST show per platform: connection status, last test, today's usage
  vs caps, pause state and when pending items will run.
- **FR-016**: Gupy and LinkedIn adapters MUST have tests on saved copies of their flows, and the submit
  path MUST be tested end to end only against a local test form (never a real platform in tests).

### Key Entities

- **Platform session**: per platform — encrypted session, connected-at, last test result, account
  label, status (conectada, expirada, desconectada).
- **Application** (extended): approval (who/when), submission state (enviada, enviada assistida,
  envio incerto, já candidatado), values sent, confirmation evidence.
- **Platform limits**: per platform — daily caps (submissions, simulations), minimum interval, pause
  state and backoff level, today's usage.
- **Artifact** (extended): confirmation screenshot.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The user connects Gupy in under 2 minutes, with the system never handling the password.
- **SC-002**: On at least 5 real Gupy jobs and 3 real LinkedIn Easy Apply jobs, preparation reaches
  "pronto para enviar" or a specific "precisa de você" reason, with standard fields correct in ≥ 95%
  of cases and nothing submitted.
- **SC-003**: At least 3 real applications are submitted after the user's approval, each with a stored
  confirmation, and zero applications are submitted without approval.
- **SC-004**: Zero duplicate submissions: no application is ever sent twice by the system.
- **SC-005**: No daily cap is exceeded and no two actions on the same platform overlap in any run.
- **SC-006**: Zero fabricated answers in submitted applications (same independent checker as F4).

## Assumptions

- Review mode only: autopilot (submitting without per-application approval) and overnight scheduling
  are F6. Real submission applies to F4 public forms (Greenhouse, Lever, Ashby, generic) as well as
  Gupy and LinkedIn Easy Apply.
- The system runs on the user's own computer, so it can open a visible browser window for login and
  assisted submit.
- The existing LinkedIn read-only integration (search/profile) keeps its own session; Easy Apply uses
  a separate browser session connected through the same "Conectar" flow.
- Default caps and intervals listed in US5 are conservative starting points the user can change within
  the safe maximums.
- "Approval" covers the answers, resume and letter shown at approval time; any change invalidates it.
- Tests and evaluations never submit to a real platform; real submissions happen only from the user's
  approvals in normal use.
