# Source-Grounded Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Coach answer verifiable course citations and let the student convert Coach next steps into assignment tasks without leaking context across courses.

**Architecture:** Add a pure `source-evidence.js` module that builds a bounded source catalog from the selected course and assignment. Extend the existing Coach client and Worker contract to exchange stable source IDs, then render those citations and task actions in the existing course Coach workspace. Keep mock and live responses on the same validated schema.

**Tech Stack:** Browser JavaScript, Node.js `node:test`, Cloudflare Worker modules, OpenAI Responses API structured JSON, existing localStorage workspace and Coach thread store.

## Global Constraints

- The frontend remains a static web application published from GitHub.
- Canvas tokens and AI provider keys never enter frontend code or browser storage.
- Coach requests include only the selected course, selected assignment, relevant rubric, and bounded conversation history.
- Every factual Coach answer must cite supplied evidence or explicitly say the information was not found.
- User-created tasks remain editable and bound to the selected assignment.
- Existing import, OCR, backup, restore, edit, delete, and selected-course binding behavior must continue to pass.
- Mock responses remain visibly labeled and use the same public response contract as live responses.

---

### Task 1: Stable Source Evidence Catalog

**Files:**
- Create: `source-evidence.js`
- Create: `tests/source-evidence.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing course records with `coursePlan` and assignment records with `details`.
- Produces: `buildSourceCatalog(course, assignment): SourceRecord[]`, `findSourceRecord(catalog, sourceId): SourceRecord | null`, and `validateSourceCitation(value, catalog): SourceCitation | null`.
- `SourceRecord` is `{ id, kind, title, location, text }` with bounded plain-text strings.
- `SourceCitation` is `{ sourceId, label, excerpt, location }` and must reference a catalog ID.

- [ ] **Step 1: Write failing catalog tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSourceCatalog,
  findSourceRecord,
  validateSourceCitation
} = require("../source-evidence.js");

test("buildSourceCatalog creates stable bounded records for the selected assignment", () => {
  const course = {
    id: "course-1",
    code: "AI450",
    name: "AI in Modern Society",
    coursePlan: { policies: [{ label: "Late work", description: "10% per day" }] }
  };
  const assignment = {
    id: "assignment-1",
    title: "Satoshi Paper",
    dueDate: "2026-06-22T09:00:00-07:00",
    details: {
      requirements: ["Interview one professional"],
      rubric: [{ label: "Strategic insight", weight: "35%", description: "Go beyond AI output" }]
    }
  };

  const catalog = buildSourceCatalog(course, assignment);

  assert.ok(catalog.some((item) => item.id === "assignment:assignment-1:requirement:1"));
  assert.ok(catalog.some((item) => item.id === "assignment:assignment-1:rubric:1"));
  assert.equal(findSourceRecord(catalog, "assignment:assignment-1:requirement:1").text, "Interview one professional");
});

test("validateSourceCitation rejects invented source IDs", () => {
  const catalog = [{ id: "source-1", kind: "requirement", title: "Requirement", location: "Requirement 1", text: "Use two sources" }];
  assert.equal(validateSourceCitation({ sourceId: "invented", excerpt: "Use two sources" }, catalog), null);
  assert.deepEqual(validateSourceCitation({ sourceId: "source-1", excerpt: "Use two sources" }, catalog), {
    sourceId: "source-1",
    label: "Requirement",
    excerpt: "Use two sources",
    location: "Requirement 1"
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/source-evidence.test.js`

Expected: FAIL with `Cannot find module '../source-evidence.js'`.

- [ ] **Step 3: Implement the pure evidence module**

Create a UMD-style module matching `coach.js`. Normalize control characters, whitespace, IDs, duplicate records, collection limits, and text limits. Build records for assignment deadline, points, overview, requirements, deliverables, rubric, and steps, plus course syllabus topics, grading, policies, exams, and weekly guidance.

```js
(function attachSourceEvidence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotSourceEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSourceEvidence() {
  "use strict";

  function buildSourceCatalog(course = {}, assignment = null) {
    const records = [];
    // Push bounded, stable records from only this course and assignment.
    return records;
  }

  return { buildSourceCatalog, findSourceRecord, validateSourceCitation };
});
```

- [ ] **Step 4: Add syntax verification and run GREEN**

Modify `package.json` so `npm run check` includes `node --check source-evidence.js`.

Run: `node --test tests/source-evidence.test.js && npm run check`

Expected: all source-evidence tests pass and syntax checks exit 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add source-evidence.js tests/source-evidence.test.js package.json
git commit -m "Add stable Coach source evidence catalog"
```

### Task 2: Add Source Catalog To Coach Context

**Files:**
- Modify: `coach.js:70-126`
- Modify: `tests/coach.test.js`

**Interfaces:**
- Consumes: `buildSourceCatalog(course, assignment)` from Task 1.
- Produces: `buildCoachContext(course, assignment, language, action, sourceCatalog)` with a bounded `sources` array.
- Each context source is `{ id, kind, title, location, text }`.

- [ ] **Step 1: Write a failing selected-source context test**

```js
test("buildCoachContext includes only bounded sources for the selected assignment", () => {
  const sources = [
    { id: "assignment:a:requirement:1", kind: "requirement", title: "Requirement", location: "Requirement 1", text: "Interview one professional" }
  ];
  const context = buildCoachContext(selectedCourse, selectedCourse.assignments[0], "en", "check", sources);
  assert.deepEqual(context.sources, sources);
  assert.equal(context.action, "check");
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --test --test-name-pattern="includes only bounded sources" tests/coach.test.js`

Expected: FAIL because `context.sources` is undefined.

- [ ] **Step 3: Implement bounded source cleaning**

Add `cleanSources(values)` to `coach.js`. Accept at most 40 records and bound `id` to 180 characters, `kind` to 80, `title` to 240, `location` to 240, and `text` to 1600. Add `sources: cleanSources(sourceCatalog)` to the context.

- [ ] **Step 4: Run Coach tests and verify GREEN**

Run: `node --test tests/coach.test.js tests/source-evidence.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add coach.js tests/coach.test.js
git commit -m "Include bounded sources in Coach context"
```

### Task 3: Enforce Citation Integrity In The Worker

**Files:**
- Modify: `worker/worker.mjs:34-95`
- Modify: `worker/worker.mjs:169-266`
- Modify: `tests/coach-worker.test.js`

**Interfaces:**
- Consumes: request context `sources` from Task 2.
- Produces: response evidence items `{ sourceId, label, excerpt, location }` whose `sourceId` exists in the supplied catalog.
- Invalid upstream citations are removed; a factual answer with no valid citations gains a `missingInformation` warning.

- [ ] **Step 1: Write failing Worker contract tests**

```js
test("worker strips invented citations and preserves valid source references", async () => {
  const { handleCoachRequest } = await workerModule();
  const body = validBody();
  body.context.sources = [{
    id: "assignment:future-care:requirement:1",
    kind: "requirement",
    title: "Requirement",
    location: "Requirement 1",
    text: "Include one ethical dilemma"
  }];
  const response = await handleCoachRequest(request(body), {
    ...baseEnv,
    COACH_MODE: "live",
    OPENAI_API_KEY: "test-key-not-real"
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            answer: "The ethical dilemma is required.",
            evidence: [
              { sourceId: "invented", label: "Wrong", excerpt: "Made up", location: "Unknown" },
              { sourceId: "assignment:future-care:requirement:1", label: "Requirement", excerpt: "Include one ethical dilemma", location: "Requirement 1" }
            ],
            nextSteps: [],
            missingInformation: []
          })
        }]
      }],
      usage: { input_tokens: 100, output_tokens: 40 }
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const value = await response.json();
  assert.deepEqual(value.evidence.map((item) => item.sourceId), ["assignment:future-care:requirement:1"]);
});
```

- [ ] **Step 2: Run the targeted Worker test and verify RED**

Run: `node --test --test-name-pattern="strips invented citations" tests/coach-worker.test.js`

Expected: FAIL because the existing evidence contract has no `sourceId` validation.

- [ ] **Step 3: Extend request sanitation and response schema**

Sanitize `context.sources` with the same bounds as the frontend. Change the structured response schema so each evidence item requires `sourceId`, `label`, `excerpt`, and `location`. Add a post-parse allowlist check against supplied IDs.

- [ ] **Step 4: Update the Coach system instruction**

Require the model to cite only supplied source IDs, preserve the relevant source wording, and put unknown requirements in `missingInformation`. Explicitly prohibit presenting general advice as an instructor requirement.

- [ ] **Step 5: Run Worker tests and verify GREEN**

Run: `node --test tests/coach-worker.test.js`

Expected: all Worker tests pass in mock, unconfigured-live, valid-live, rate-limit, and citation-integrity cases.

- [ ] **Step 6: Commit Task 3**

```bash
git add worker/worker.mjs tests/coach-worker.test.js
git commit -m "Validate source-grounded Coach citations"
```

### Task 4: Validate And Persist Rich Citations In The Browser

**Files:**
- Modify: `coach.js:130-230`
- Modify: `tests/coach.test.js`

**Interfaces:**
- Consumes: rich evidence items from Task 3.
- Produces: persisted assistant messages whose evidence is `{ sourceId, label, excerpt, location }`.
- Backward compatibility: existing `{ label, text }` messages remain readable and are normalized to an empty `sourceId` with `excerpt` from `text`.

- [ ] **Step 1: Write failing response-normalization tests**

```js
test("validateCoachResponse keeps rich citations and strips extra fields", () => {
  const value = validateCoachResponse({
    answer: "Use the interview evidence.",
    evidence: [{
      sourceId: "assignment:a:requirement:1",
      label: "Requirement",
      excerpt: "Interview one professional",
      location: "Requirement 1",
      secret: "remove"
    }]
  });
  assert.deepEqual(value.evidence[0], {
    sourceId: "assignment:a:requirement:1",
    label: "Requirement",
    excerpt: "Interview one professional",
    location: "Requirement 1"
  });
});
```

- [ ] **Step 2: Run the targeted Coach test and verify RED**

Run: `node --test --test-name-pattern="keeps rich citations" tests/coach.test.js`

Expected: FAIL because the current cleaner returns `{ label, text }`.

- [ ] **Step 3: Implement backward-compatible citation normalization**

Replace `cleanEvidence` with a normalizer that accepts the new fields and legacy `text`. Keep an exported compatibility shape only in stored messages; do not retain unexpected properties.

- [ ] **Step 4: Run Coach tests and verify GREEN**

Run: `node --test tests/coach.test.js`

Expected: all tests pass, including old stored-message fixtures.

- [ ] **Step 5: Commit Task 4**

```bash
git add coach.js tests/coach.test.js
git commit -m "Preserve rich Coach source citations"
```

### Task 5: Render Citations And Create Tasks From Coach Steps

**Files:**
- Modify: `index.html:13-16`
- Modify: `app.js:1014-1359`
- Modify: `styles.css`
- Modify: `tests/ui-contract.test.js`
- Modify: `tests/release-contract.test.js`

**Interfaces:**
- Consumes: `window.ClassPilotSourceEvidence`, rich assistant evidence, and existing assignment task mutation helpers.
- Produces: citation buttons with `data-coach-source-id` and next-step buttons with `data-add-coach-task`.
- `addCoachStepAsTask(courseId, assignmentId, title): boolean` adds one normalized, duplicate-safe task.

- [ ] **Step 1: Add failing UI contract tests**

```js
test("Coach renders source citations and turns a next step into an assignment task", () => {
  assert.match(html, /source-evidence\.js/);
  assert.match(appSource, /data-coach-source-id/);
  assert.match(appSource, /data-add-coach-task/);
  assert.match(appSource, /function addCoachStepAsTask/);
});
```

Add a behavioral test that opens Assignment 1, invokes `addCoachStepAsTask`, and asserts that Assignment 1 receives exactly one new task while Assignment 2 is unchanged.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test --test-name-pattern="Coach renders source citations|turns a next step" tests/ui-contract.test.js`

Expected: FAIL because the source script, data attributes, and helper do not exist.

- [ ] **Step 3: Load the source module before Coach and App**

Add `<script src="source-evidence.js?v=17" defer></script>` before `coach.js`. Update release contract expectations so the Pages artifact includes `source-evidence.js`.

- [ ] **Step 4: Build the catalog for every Coach request**

In `submitCoachQuestion`, call `buildSourceCatalog(course, assignment)` and pass it to `buildCoachContext`. Store the same catalog in the current Coach view state for citation lookup.

- [ ] **Step 5: Render evidence and task actions**

Render each evidence item as an accessible button showing label, location, and excerpt. Clicking it opens the relevant assignment or course tab and announces the source text. Render an Add Task button beside each next step when an assignment is selected.

- [ ] **Step 6: Implement duplicate-safe task creation**

Normalize the Coach step title, reject empty values, compare case-insensitively against existing assignment tasks, then append through the existing workspace mutation and persistence path. Keep task creation unavailable at course level.

- [ ] **Step 7: Style and verify responsive behavior**

Add compact citation and action styles using the existing palette, spacing, focus-ring, and card-radius conventions. Ensure long source excerpts wrap and controls do not overflow at 360px.

- [ ] **Step 8: Run UI and release tests and verify GREEN**

Run: `node --test tests/ui-contract.test.js tests/release-contract.test.js`

Expected: all tests pass.

- [ ] **Step 9: Commit Task 5**

```bash
git add index.html app.js styles.css tests/ui-contract.test.js tests/release-contract.test.js
git commit -m "Add actionable Coach citations"
```

### Task 6: Regression Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `worker/README.md`

**Interfaces:**
- Consumes: the complete source-grounded Coach feature.
- Produces: documented public behavior, deployment requirements, and verification evidence.

- [ ] **Step 1: Update product documentation**

Document stable citations, selected-assignment isolation, Add Task behavior, mock/live parity, and the requirement to configure `OPENAI_API_KEY` before production can claim live AI.

- [ ] **Step 2: Run focused tests**

Run: `node --test tests/source-evidence.test.js tests/coach.test.js tests/coach-worker.test.js tests/ui-contract.test.js tests/release-contract.test.js`

Expected: all focused tests pass with 0 failures.

- [ ] **Step 3: Run complete verification**

Run: `npm run verify`

Expected: all repository tests pass and every JavaScript file passes `node --check`.

- [ ] **Step 4: Verify repository scope**

Run: `git status --short`

Expected: only intentional Coach files and the pre-existing PowerPoint lock file are visible; the lock file remains untracked.

- [ ] **Step 5: Commit Task 6**

```bash
git add README.md worker/README.md
git commit -m "Document source-grounded Coach workflow"
```
