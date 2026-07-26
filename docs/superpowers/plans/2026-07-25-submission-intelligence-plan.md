# Submission Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student upload a candidate submission inside an assignment and receive transparent file checks, rubric evidence, a score range, and a non-blocking AI-writing risk reminder.

**Architecture:** Extend local file extraction for DOCX and PPTX, then pass normalized text and metadata into a pure `submission-checker.js` engine. Persist only the compact report and file metadata in the assignment; do not persist the raw file or full extracted text. Render the report in a Final Check section inside the selected assignment.

**Tech Stack:** Browser JavaScript, Node.js `node:test`, existing PDF/OCR readers, JSZip browser bundle, localStorage workspace, existing assignment mutation path.

## Global Constraints

- Objective checks run before heuristic analysis.
- Every failed requirement cites assignment or rubric text.
- Predicted results are ranges labeled `ClassPilot estimate`, not official grades.
- AI-writing risk is a review-priority signal, not a percentage of AI-authored words.
- Scores above 20 show a reminder and never block the student.
- Raw candidate files and full extracted text are not persisted.
- Existing supported imports and selected-course behavior remain unchanged.

---

### Task 1: Pure Submission Checker

**Files:**
- Create: `submission-checker.js`
- Create: `tests/submission-checker.test.js`
- Modify: `package.json`

**Interfaces:**
- `analyzeSubmission(assignment, extraction, options): SubmissionReport`.
- `extraction` is `{ fileName, mimeType, size, text, pageCount, slideCount }`.
- `SubmissionReport` contains `file`, `checks`, `rubric`, `scoreEstimate`, `aiRisk`, and `summary`.
- Each check is `{ id, label, status, evidence, source }` with status `pass`, `warn`, or `fail`.

- [ ] Write failing tests for allowed extension, word/page limits, required deliverables, rubric evidence, score bands, and AI-risk threshold behavior.
- [ ] Run `node --test tests/submission-checker.test.js` and confirm module-not-found RED.
- [ ] Implement bounded text normalization, requirement parsing, deterministic checks, rubric keyword evidence, conservative score bands, and low-confidence authorship risk.
- [ ] Add `node --check submission-checker.js` to `npm run check`.
- [ ] Run checker tests and syntax checks; expect all pass.
- [ ] Commit `submission-checker.js`, its tests, and `package.json`.

### Task 2: DOCX And PPTX Local Extraction

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vendor/jszip/jszip.min.js`
- Modify: `index.html`
- Modify: `file-readers.js`
- Modify: `tests/file-readers.test.js`
- Modify: `.github/workflows/pages.yml`

**Interfaces:**
- `classifyImportFile` recognizes DOCX and PPTX by MIME and extension.
- `readImportFile` returns text plus `slideCount` for PPTX and retains `pageCount` for PDF.
- Browser extraction consumes `window.JSZip`; tests inject a compatible archive reader.

- [ ] Write failing file-classification and archive-extraction tests.
- [ ] Run targeted file-reader tests and confirm RED.
- [ ] Install exact `jszip@3.10.1`, copy its minified browser build into `vendor/jszip/`, and load it before `file-readers.js`.
- [ ] Extract DOCX paragraph text from `word/document.xml` and ordered PPTX slide text from `ppt/slides/slideN.xml` with XML parsing and entity decoding.
- [ ] Extend Pages packaging and release contracts to include the new runtime.
- [ ] Run file-reader and release tests; expect all pass.
- [ ] Commit extraction support and bundled dependency.

### Task 3: Assignment Final Check UI

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- `runAssignmentFinalCheck(courseId, assignmentId, file): Promise<boolean>` reads and analyzes one file.
- `saveSubmissionReport(courseId, assignmentId, report): boolean` persists the compact report.
- UI controls use `data-submission-file`, `data-run-final-check`, and `data-clear-submission-report`.

- [ ] Write failing UI contract and behavioral tests for assignment-scoped upload, report persistence, rerun, clear, and failure rollback.
- [ ] Run targeted UI tests and confirm RED.
- [ ] Add a Final Check section to selected assignment detail with one file input, Check file command, progress, and prior report.
- [ ] Call local extraction and `analyzeSubmission`, persist only the report, and keep failures transactional.
- [ ] Render objective checks, rubric rows, score range/confidence, and AI risk with accessible status text.
- [ ] Add responsive styles that wrap long requirement and evidence text at 360px.
- [ ] Run UI tests and syntax checks; expect all pass.
- [ ] Commit assignment Final Check UI.

### Task 4: Report Integrity And AI Risk Messaging

**Files:**
- Modify: `planner.js`
- Modify: `tests/planner.test.js`
- Modify: `submission-checker.js`
- Modify: `tests/submission-checker.test.js`
- Modify: `app.js`

**Interfaces:**
- Workspace normalization accepts a bounded `submissionReport` object and strips unknown fields.
- Backup parsing validates report fields without requiring reports on older workspaces.
- AI risk renders `Review signal`, score, confidence, reasons, and the explicit sentence `This is not proof of AI use.`

- [ ] Write failing normalization and backup-validation tests for compact reports and malformed report rejection.
- [ ] Run targeted planner tests and confirm RED.
- [ ] Add strict optional report normalization and deep validation.
- [ ] Add the >20 reminder, >50 stronger review state, unsupported-text state, and non-blocking language.
- [ ] Run planner, checker, and UI tests; expect all pass.
- [ ] Commit report integrity and risk messaging.

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents supported submission files, local processing, score-range limitations, AI-risk limitations, and data persistence.

- [ ] Update README product, privacy, and verification sections.
- [ ] Run focused submission, file-reader, planner, UI, and release tests.
- [ ] Run `npm run verify`; expect 0 failures.
- [ ] Check `git status --short` and confirm no raw test documents or secrets are tracked.
- [ ] Commit submission-intelligence documentation.

