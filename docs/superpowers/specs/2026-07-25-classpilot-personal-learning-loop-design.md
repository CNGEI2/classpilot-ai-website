# ClassPilot Personal Learning Loop Design

Date: 2026-07-25
Status: Awaiting written-spec review

## 1. Purpose

ClassPilot should become a personal academic workspace that removes repeated data entry and helps a student move from a Canvas assignment to a checked, scheduled, submission-ready file.

The release joins five product capabilities into one loop:

1. A live, source-grounded AI Coach.
2. An assignment workspace with rubric-aware submission checks.
3. A Today view that starts the most useful next action in one click.
4. A schedule that works backward from due dates and replans missed work.
5. A secure Canvas connection that imports course data without repeated uploads.

The product remains an aid for student judgment. It must not present predicted grades or AI-writing signals as official determinations.

## 2. Product Principles

- Import once, then keep Canvas and ClassPilot linked by stable external IDs.
- Keep every syllabus, assignment, rubric, file, task, and Coach conversation inside the correct course.
- Ground AI claims in visible course or submission evidence.
- Prefer deterministic checks for objective requirements and AI only for judgment-heavy criteria.
- Show uncertainty instead of inventing precision.
- Keep Canvas access tokens and AI provider keys out of frontend code and browser storage.
- Never submit a file to Canvas automatically in this release.
- Preserve manual upload as a complete fallback when Canvas access is unavailable.

## 3. Scope

### Included

- Canvas OAuth connection for supported institutions.
- Read-only import and refresh of active courses, syllabus content, assignments, rubrics, modules, planner items, and the student's own submission status.
- Exact deduplication using Canvas domain, course ID, and assignment ID.
- PDF, DOCX, PPTX, TXT, Markdown, image, and supported archive inspection for a candidate submission.
- Objective file checks and rubric-by-rubric evidence analysis.
- Predicted score range with confidence and criterion-level explanations.
- AI-writing risk indicator with a reminder above 20.
- Source-grounded Coach conversations and conversion of suggestions into tasks.
- One-click next action, focus sessions, backward planning, and automatic replanning.
- Responsive desktop and mobile behavior.

### Not Included

- Automatic Canvas submission, resubmission, grade changes, or instructor actions.
- A claim that ClassPilot can prove academic misconduct.
- A claim that a predicted score is the instructor's future grade.
- Asking public users to paste personal Canvas access tokens.
- Cross-device ClassPilot synchronization in the first implementation cycle.
- A replacement for institution-provided Turnitin or plagiarism reports.

## 4. Recommended Architecture

### 4.1 Frontend

The frontend remains a static web application published from GitHub. Existing browser-local workspace data and local OCR remain available.

New behavior should be split into focused modules instead of expanding the existing large core files:

- `canvas-client.js`: connection state, sync requests, normalization, and conflict handling.
- `source-evidence.js`: stable source IDs, excerpts, page or section locations, and citation formatting.
- `submission-checker.js`: deterministic file and requirement checks.
- `rubric-evaluator.js`: criterion evidence, predicted bands, and confidence.
- `authorship-risk.js`: writing-process and text-risk signals.
- `study-scheduler.js`: backward scheduling, locked sessions, and replanning.

The UI may be wired from `app.js`, but domain logic should remain testable without the DOM.

### 4.2 Cloudflare Worker

The existing Coach Worker becomes the secure API boundary. It will expose separate routes for:

- Canvas authorization start, callback, connection status, refresh, and disconnect.
- Canvas read-only synchronization.
- Live Coach responses.
- Rubric evaluation and AI-writing risk analysis.

The Worker must validate origins, request sizes, course ownership, allowed Canvas hosts, and response schemas. Provider errors must be converted into user-safe error codes.

### 4.3 Secure Storage

Canvas refresh tokens must be encrypted before backend persistence. The frontend receives only an opaque ClassPilot connection or session identifier and never receives a stored Canvas refresh token.

OAuth state values are single-use and expire quickly. Disconnecting Canvas deletes the stored connection and revokes the Canvas token when the institution supports revocation.

Manual access tokens may be used only in local developer testing. They are never added to the public interface, repository, localStorage, logs, or analytics.

### 4.4 Data Ownership

The browser remains the source of truth for the student's ClassPilot tasks, notes, focus history, and scheduling preferences. Canvas remains the source of truth for imported course facts.

Every imported entity stores:

- `sourceSystem`: `canvas`.
- `sourceDomain`: the institution Canvas hostname.
- `externalCourseId` or `externalAssignmentId`.
- `lastSyncedAt`.
- `sourceUpdatedAt` when provided.
- A normalized content hash for change detection.

User-created notes and tasks are never overwritten by a Canvas refresh.

## 5. Canvas Connection And Sync

### 5.1 Authorization

The user selects Connect Canvas, enters or confirms the institution Canvas domain, and is redirected to Canvas OAuth. After authorization, the callback creates a ClassPilot connection and returns the user to the website.

A production connection requires a Developer Key approved by the institution. If SFBU does not approve a key, development can still validate the connector with the owner's personal token, while the public product continues to offer file import.

### 5.2 Read-Only Sync Set

The initial connector requests only the scopes needed to read:

- The current user's profile and enrollments.
- Active courses and syllabus bodies.
- Assignments, due dates, points, submission types, allowed extensions, and lock dates.
- Rubrics and criterion ratings.
- Modules and planner items.
- The current student's own submission state and grade when visible to that student.

No write scope is requested for the first release.

### 5.3 Identity And Deduplication

An imported course key is `canvas:<domain>:course:<courseId>`. An imported assignment key is `canvas:<domain>:course:<courseId>:assignment:<assignmentId>`.

These keys override title similarity. A renamed Canvas course or assignment updates the existing ClassPilot record instead of creating a duplicate. Manual uploads made from inside a selected course remain bound to that course.

### 5.4 Refresh And Conflict Rules

- First connection shows the discovered course list and lets the student choose courses.
- Manual Refresh pulls changes immediately.
- Opening the app may perform a lightweight stale-data check when the last sync is older than the configured interval.
- Canvas changes update imported facts but preserve ClassPilot status, notes, tasks, and schedule history.
- A removed Canvas assignment is labeled unavailable rather than silently deleted.
- Conflicts display the Canvas value and local value, with Canvas facts selected by default.

## 6. Source-Grounded AI Coach

The Coach receives only the selected course, selected assignment, relevant rubric, and the minimum conversation history needed for the request.

Each factual response must include one or more evidence references. A reference contains the source title, source type, and excerpt location. The interface opens the cited source or focuses the matching excerpt.

Supported actions include:

- Explain this assignment in the selected language.
- Identify the next concrete step.
- Compare a draft against one rubric criterion.
- Turn missing requirements into editable tasks.
- Build or revise the work plan.
- Explain why a submission check was flagged.

If the source does not contain the answer, the Coach must say that the information was not found. It may offer a clearly labeled suggestion but cannot present that suggestion as a course requirement.

## 7. Assignment Workspace

Each assignment opens into four stable sections:

1. Requirements: normalized deliverables, constraints, dates, links, and instructor directions.
2. Rubric: criteria, weights or points, rating descriptions, and evidence status.
3. My Submission: candidate files, extraction status, metadata, and replacement controls.
4. Final Check: objective checks, rubric analysis, predicted score, AI-writing risk, and prioritized revisions.

The assignment name remains the workspace title. Course-level syllabus, exams, and modules remain in the course directory rather than appearing as assignments.

## 8. Submission Inspection

### 8.1 Local Extraction

Where practical, the browser extracts text and metadata locally. Files are not sent to an AI service until the student explicitly starts Final Check.

The extraction layer records:

- File name, type, size, and count.
- Page, slide, word, and image counts when available.
- Headings and section order.
- Links, citations, bibliography indicators, tables, and appendices.
- Embedded speaker notes or document comments only when the file format exposes them and the user includes them.
- Extraction warnings for scans, password protection, corruption, or unsupported content.

### 8.2 Deterministic Checks

Objective checks run before AI analysis:

- Allowed file type and number of files.
- Required naming pattern when stated.
- Page, slide, word, or duration limits when stated.
- Required sections and deliverables.
- Required bibliography, appendix, screenshots, interview notes, survey data, or links.
- Broken or malformed URLs that can be checked safely.
- Empty, unreadable, duplicate, or suspiciously incomplete files.

Every failed check cites the assignment sentence or rubric criterion that created the requirement.

### 8.3 Rubric Evaluation

Rubric evaluation runs criterion by criterion. For each criterion, the output contains:

- Criterion name and possible points.
- Evidence found in the submission with page or section references.
- Missing or weak evidence.
- A predicted point band rather than a single guaranteed score.
- Confidence: low, medium, or high.
- The smallest useful revision that could improve the result.

The overall prediction is the sum of criterion bands and is displayed as a range. Missing or ambiguous rubrics widen the range. The interface labels the result `ClassPilot estimate`, never `grade` alone.

The evaluator must not create criteria that are absent from the imported rubric or assignment. General writing suggestions appear separately and do not change the predicted score unless the rubric supports them.

## 9. AI-Writing Risk Indicator

The product uses the label `AI-writing risk`, not `AI percentage`, `cheating probability`, or `AI detected`.

The indicator ranges from 0 to 100 and combines only available signals:

- Writing-process provenance, including large paste events and revision continuity when the student drafts inside ClassPilot.
- Abrupt style changes within the same document or against optional prior writing supplied by the student.
- Citation and attribution problems.
- Claims of personal research, interviews, surveys, or reflection without supporting evidence.
- Text-pattern signals from the configured analysis provider.

The score represents review priority, not the percentage of words written by AI. The interface displays a confidence level and the contributing signals.

Behavior by range:

- 0-20: no warning; limitations remain visible in the details.
- Above 20: show a non-blocking reminder and highlighted reasons.
- Above 50: show a stronger review recommendation and authorship-evidence checklist.

The reminder suggests adding sources, notes, drafts, interview evidence, and personal reasoning. It must not suggest superficial detector evasion or text "humanization."

If the submission is short, non-prose, multilingual outside supported analysis, or lacks writing history, confidence is reduced. The check never blocks exporting or submitting the student's file.

## 10. Today And Focus Flow

Today displays one primary action based on urgency, remaining effort, rubric impact, dependencies, and the student's available time.

The action includes an assignment, a concrete task, and a session duration. Starting it opens a lightweight focus state with pause, complete, and stop controls. Completing the action updates the assignment plan and selects the next eligible action.

The student can override the recommendation. Overrides inform future scheduling but do not permanently alter assignment requirements.

## 11. Smart Scheduling

The student configures:

- Available study windows by weekday.
- Preferred session length and break length.
- Minimum buffer before a due date.
- Dates or periods that must remain free.
- Sessions that are locked and cannot be moved.

The scheduler works backward from each due date. It accounts for task order, remaining effort, points or rubric weight, current progress, and buffer time.

If a session is missed, the scheduler replans only unlocked future sessions. It never places work after the due date without showing an explicit overdue state. Manual edits remain possible at all times.

## 12. Error And Offline Behavior

- Canvas unavailable: keep cached data, show last successful sync, and offer Retry.
- Authorization expired: preserve local work and request reconnection.
- Partial Canvas response: import valid records and list skipped records with reasons.
- File extraction failed: keep the file entry, explain the failure, and allow replacement.
- AI service unavailable: deterministic checks still complete; AI sections show Retry without losing prior results.
- Unsupported rubric: show requirements checks and suppress numeric prediction rather than inventing a score.
- Offline: local courses, tasks, files already extracted, Today, and scheduling remain usable.

## 13. Privacy And Cost Controls

- Raw Canvas tokens and provider keys never reach the public bundle.
- AI requests contain only the selected assignment and extracted submission content required for the selected check.
- The student confirms before submission text leaves the browser.
- AI requests use bounded input sizes, structured outputs, rate limits, and no provider-side storage where supported.
- Repeated checks reuse unchanged extraction results and clearly show when a paid AI analysis will run.
- Logs contain request IDs and error categories, not assignment text or submission contents.

## 14. Testing Strategy

### Unit Tests

- Canvas normalization, stable IDs, deduplication, pagination, and conflict rules.
- Requirement extraction contracts and deterministic file checks.
- Rubric point aggregation, score bands, and confidence rules.
- AI-risk threshold behavior and unsupported-content handling.
- Scheduler deadlines, dependencies, locked sessions, and missed-session replanning.
- Source citation completeness and cross-course isolation.

### Contract Tests

- Worker request validation and structured responses.
- OAuth state expiry, callback failure, token refresh, and disconnect.
- Canvas fixture responses for courses, assignments, rubrics, modules, planner items, and submissions.
- AI provider failure and malformed-output recovery.

### Browser Tests

- Connect, select courses, sync, refresh, and disconnect.
- Open assignment, upload candidate file, run Final Check, and create tasks from findings.
- Start and finish Today action, then observe schedule updates.
- Responsive screenshots at desktop and mobile sizes.
- Keyboard navigation, visible focus, status announcements, and text overflow.

### Calibration Tests

Predicted scores are evaluated against anonymized, previously graded submissions when such samples are available. Until calibration is sufficient, the UI keeps wide ranges and low or medium confidence.

AI-writing risk is tested on human-written ESL samples, human-edited drafts, and AI-assisted samples. The test goal is responsible warning behavior, not a claim of universal detection accuracy.

## 15. Acceptance Criteria

- A Canvas-authorized student can import selected active courses without manual assignment uploads.
- Repeated syncs do not duplicate courses or assignments.
- Imported due dates, points, submission types, allowed extensions, and rubric criteria match Canvas fixtures exactly.
- Every rubric prediction contains evidence or explicitly says evidence was not found.
- Predicted results are ranges with confidence and never appear as official grades.
- AI-writing risk above 20 produces a visible, non-blocking reminder with reasons.
- No Canvas token or AI secret is present in frontend files, browser storage, Git history, or test output.
- Canvas and AI failures do not destroy local course, task, or schedule data.
- Today starts one concrete action in one click.
- The scheduler respects availability, dependencies, locked sessions, buffers, and due dates.
- Existing import, OCR, backup, restore, edit, delete, and course-binding behavior continues to pass regression tests.

## 16. Delivery Order

The design is implemented as independently testable workstreams in this order:

1. Source evidence model and live Coach grounding.
2. Assignment workspace, file extraction, deterministic checks, rubric evaluation, score ranges, and AI-writing risk.
3. Today one-click focus flow.
4. Smart scheduling and replanning.
5. Canvas OAuth and read-only sync, first against fixtures and an owner-only test token, then against an institution-approved Developer Key.
6. Full regression, responsive browser QA, documentation, commit, push, and public deployment.

The Canvas work is placed after the normalized assignment and evidence contracts exist, so both manual imports and Canvas imports feed the same product behavior.
