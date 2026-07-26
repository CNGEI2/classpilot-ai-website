# Keyless Canvas Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready Chrome extension that captures an open Canvas assignment or syllabus, sends it through an expiring one-time Worker handoff, and imports it into the correct ClassPilot course without a Canvas Developer Key.

**Architecture:** A Manifest V3 extension extracts a bounded structured snapshot only after a student click. The Cloudflare Worker stores that sanitized snapshot in a dedicated KV namespace for ten minutes and returns an opaque code. The ClassPilot site redeems the code once, converts the capture to the existing Canvas snapshot shape, merges by Canvas host and stable IDs, and preserves local task completion.

**Tech Stack:** Vanilla JavaScript, Chrome Manifest V3, Cloudflare Workers and KV, Node.js built-in test runner, existing ClassPilot parser/planner modules, GitHub Pages.

## Global Constraints

- Never collect or transmit Canvas passwords, SSO credentials, MFA codes, cookies, or access tokens.
- The extension reads page content only after the student clicks it.
- Request only `activeTab`, `scripting`, `storage`, and access to the ClassPilot Worker endpoint.
- Captures expire after ten minutes and can be redeemed once.
- Raw page content is bounded to 100,000 characters and excludes scripts, styles, forms, navigation, and hidden content.
- Captured Canvas course identity is authoritative; parsing cannot move content to another course.
- Existing file, OCR, Coach, planner, final-check, backup, and GitHub Pages behavior must continue to pass.

---

### Task 1: Canvas Page Capture Parser

**Files:**
- Create: `extension/capture.js`
- Create: `tests/fixtures/canvas-assignment.html`
- Create: `tests/fixtures/canvas-syllabus.html`
- Create: `tests/canvas-capture.test.js`

**Interfaces:**
- Consumes: a browser `Document` and `Location`, or a plain snapshot for Node tests.
- Produces: `parseCanvasSnapshot(snapshot): Capture` and `captureCanvasPage(document, location): Capture` through both `module.exports` and `globalThis.ClassPilotCanvasCapture`.

- [ ] **Step 1: Write failing parser tests**

```js
test("captures assignment identity and requirements", () => {
  const capture = parser.parseCanvasSnapshot({
    url: "https://sfbu.instructure.com/courses/1742/assignments/30244",
    title: "Read and respond Contactless Love",
    breadcrumbs: ["SUMMER 2026 AI450 - A", "Assignments", "Read and respond Contactless Love"],
    mainText: fixtureText,
    links: [{ text: "Reading", href: "https://archive.org/details/example" }]
  });
  assert.equal(capture.course.canvasId, "1742");
  assert.equal(capture.assignment.canvasId, "30244");
  assert.equal(capture.assignment.title, "Read and respond Contactless Love");
  assert.equal(capture.assignment.dueDate, "Tue Jul 14, 2026 3:00pm");
  assert.equal(capture.assignment.points, "20 Points");
  assert.match(capture.assignment.instructionsText, /Mini Play/);
});
```

- [ ] **Step 2: Run the tests and confirm the missing module failure**

Run: `node --test tests/canvas-capture.test.js`

Expected: FAIL because `extension/capture.js` does not exist.

- [ ] **Step 3: Implement bounded DOM extraction and pure parsing**

Implement the exact public functions `parseCanvasSnapshot(snapshot = {})`, `captureCanvasPage(documentRef, locationRef)`, and `validateCapture(capture = {})`. The parser must extract course and assignment IDs from `/courses/:courseId/assignments/:assignmentId`, prefer Canvas breadcrumbs for names, recognize `Due:`, points, visible submission status, submission types, links, rubric rows, and syllabus content. It must omit unavailable fields instead of inventing values. Validation returns `{ valid, missing, message }` and requires Canvas host plus course identity and either an assignment title or syllabus text.

- [ ] **Step 4: Run capture tests**

Run: `node --test tests/canvas-capture.test.js`

Expected: all capture tests PASS.

- [ ] **Step 5: Commit the parser**

```bash
git add extension/capture.js tests/fixtures tests/canvas-capture.test.js
git commit -m "Add Canvas page capture parser"
```

### Task 2: Chrome Extension Interaction

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/service-worker.js`
- Create: `extension/popup.html`
- Create: `extension/popup.js`
- Create: `extension/popup.css`
- Create: `extension/icons/icon-16.png`
- Create: `extension/icons/icon-32.png`
- Create: `extension/icons/icon-48.png`
- Create: `extension/icons/icon-128.png`
- Create: `tests/extension-contract.test.js`

**Interfaces:**
- Consumes: `captureCanvasPage()` from Task 1 and Worker `POST /api/import-handoffs` from Task 3.
- Produces: a popup preview and `createImportHandoff(capture): Promise<{ code, expiresAt }>` in `service-worker.js`.

- [ ] **Step 1: Write failing extension contract tests**

Verify Manifest V3, exact permissions, no `all_urls`, a popup action, service worker, accessible controls, preview fields, and an extension package icon set.

```js
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions.sort(), ["activeTab", "scripting", "storage"]);
assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
assert.match(popupHtml, /id="sendCapture"/);
```

- [ ] **Step 2: Run the tests and confirm missing extension files**

Run: `node --test tests/extension-contract.test.js`

Expected: FAIL because the extension manifest and popup do not exist.

- [ ] **Step 3: Implement the explicit-click capture flow**

The popup state machine is `reading -> preview -> sending -> success | error`. On open it asks the service worker to inject `capture.js` into the active tab and execute `captureCanvasPage(document, location)`. The preview displays material type, course, title, due date, and points. `Add to ClassPilot` sends the capture to the Worker, then opens:

```text
https://cngei2.github.io/classpilot-ai-website/?import=<opaque-code>
```

No capture text may be present in the URL. Errors remain in the popup and preserve the preview for retry.

- [ ] **Step 4: Generate simple branded raster icons and run contract tests**

Run: `node --test tests/extension-contract.test.js`

Expected: all extension contract tests PASS.

- [ ] **Step 5: Commit the extension shell**

```bash
git add extension tests/extension-contract.test.js
git commit -m "Add ClassPilot Canvas companion extension"
```

### Task 3: Expiring Worker Handoff

**Files:**
- Modify: `worker/worker.mjs`
- Modify: `worker/wrangler.toml`
- Modify: `worker/wrangler.toml.example`
- Modify: `worker/.dev.vars.example`
- Create: `tests/import-handoff-worker.test.js`

**Interfaces:**
- Consumes: a capture from Task 1 and `env.IMPORT_HANDOFFS` implementing KV `get`, `put`, and `delete`.
- Produces: `POST /api/import-handoffs` and `POST /api/import-handoffs/redeem`.

- [ ] **Step 1: Write failing Worker endpoint tests**

```js
const created = await handleImportHandoffRequest(postCaptureRequest(capture), env(kv), {
  randomUUID: () => "handoff-123",
  now: () => 1_000
});
assert.equal(created.status, 201);
assert.equal((await created.json()).code, "handoff-123");

const redeemed = await handleImportHandoffRequest(redeemRequest("handoff-123"), env(kv), {
  now: () => 2_000
});
assert.equal(redeemed.status, 200);
assert.equal((await redeemed.json()).capture.assignment.title, "Satoshi Paper");
assert.equal(await kv.get("import-handoff:handoff-123"), null);
```

Also test invalid schema, oversized raw text, missing KV, expired capture, second redemption, wrong website origin, and rate limiting.

- [ ] **Step 2: Run tests and confirm missing route failure**

Run: `node --test tests/import-handoff-worker.test.js`

Expected: FAIL because the handoff handler is not exported.

- [ ] **Step 3: Implement sanitization, storage, and one-time redemption**

Export `sanitizeImportCapture(value)` and `handleImportHandoffRequest(request, env, options)`. Store:

```js
await env.IMPORT_HANDOFFS.put(`import-handoff:${code}`, JSON.stringify({
  capture: sanitizeImportCapture(body.capture),
  createdAt: now
}), { expirationTtl: 600 });
```

Redeem by loading, validating age, deleting before returning, and sending `Cache-Control: no-store`. Creation accepts extension requests and development localhost; redemption accepts only the configured ClassPilot origin. Apply the existing rate-limiter pattern independently from Coach requests.

- [ ] **Step 4: Run Worker and full tests**

Run: `node --test tests/import-handoff-worker.test.js tests/canvas-worker.test.js tests/coach-worker.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit Worker support**

```bash
git add worker tests/import-handoff-worker.test.js
git commit -m "Add one-time Canvas import handoffs"
```

### Task 4: ClassPilot Handoff Redemption and Course Merge

**Files:**
- Modify: `canvas-connector.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `tests/canvas-connector.test.js`
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `POST /api/import-handoffs/redeem` and the capture schema from Task 1.
- Produces: `captureToCanvasSnapshot(capture)` and `mergeCanvasCapture(workspace, capture, now)` from `canvas-connector.js`; `redeemPendingCanvasImport()` in `app.js`.

- [ ] **Step 1: Write failing merge and startup tests**

```js
const first = mergeCanvasCapture(workspace, capture, now);
const second = mergeCanvasCapture(first, updatedCapture, now);
assert.equal(second.courses.length, 1);
assert.equal(second.courses[0].assignments.length, 1);
assert.equal(second.courses[0].assignments[0].points, "50 Points Possible");
assert.equal(second.courses[0].assignments[0].tasks[0].done, true);
```

Add syllabus coverage proving that an existing Canvas course receives syllabus data without becoming a second course. Add a UI contract proving startup reads the `import` query parameter, removes it after redemption, reports progress through the live status element, and never writes a handoff code to `localStorage`.

- [ ] **Step 2: Run tests and confirm missing functions**

Run: `node --test tests/canvas-connector.test.js tests/ui-contract.test.js`

Expected: FAIL because capture merge and redemption do not exist.

- [ ] **Step 3: Implement capture conversion and merge**

`captureToCanvasSnapshot()` maps the capture to one Canvas-like course with zero or one assignments. Use captured host and IDs when present, and deterministic fallback IDs from course code/name and assignment title/due date when absent. Add rubric, links, instructions, submission types, allowed extensions, and source type `Canvas page capture` to the assignment draft.

- [ ] **Step 4: Implement one-time startup redemption**

On startup, call `redeemPendingCanvasImport()` after the workspace loads. It posts the code to the Worker, merges the returned capture, persists the normalized workspace, selects the imported course and assignment, navigates to Courses, renders the UI, removes `import` with `history.replaceState`, and announces success. On failure it removes the code and shows an actionable retry message.

- [ ] **Step 5: Run focused and full tests**

Run: `npm run verify`

Expected: all tests and syntax checks PASS.

- [ ] **Step 6: Commit the website integration**

```bash
git add canvas-connector.js app.js index.html tests/canvas-connector.test.js tests/ui-contract.test.js
git commit -m "Import Canvas extension captures into ClassPilot"
```

### Task 5: Packaging, Documentation, and Release Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `worker/README.md`
- Modify: `.github/workflows/pages.yml`
- Modify: `tests/release-contract.test.js`
- Create: `extension/README.md`
- Create: `scripts/package-extension.mjs`
- Create: `dist/ClassPilot-Canvas-Companion.zip` through the packaging script

**Interfaces:**
- Consumes: all production files from Tasks 1-4.
- Produces: `npm run package:extension`, a validated ZIP, deployment documentation, and a Pages artifact that includes any new website runtime files.

- [ ] **Step 1: Add failing release tests**

Require the extension package script, required ZIP entries, Worker KV documentation, installation instructions, privacy statement, and exact Pages runtime files.

- [ ] **Step 2: Run release tests and confirm failure**

Run: `node --test tests/release-contract.test.js`

Expected: FAIL until packaging and documentation are present.

- [ ] **Step 3: Implement deterministic extension packaging and documentation**

The packaging script deletes only `dist/ClassPilot-Canvas-Companion.zip`, validates required files, and creates a ZIP with `manifest.json` at its root. README instructions cover Chrome `Load unpacked`, normal use, permissions, limitations, uninstall, and data deletion.

- [ ] **Step 4: Verify code, tests, package, and clean extraction**

Run:

```bash
npm run verify
npm run package:extension
unzip -t dist/ClassPilot-Canvas-Companion.zip
```

Expected: all tests PASS, syntax checks PASS, and ZIP integrity reports no errors.

- [ ] **Step 5: Browser QA**

Load `extension/` unpacked in Chrome, open the provided SFBU assignment page fixture through a local test harness, capture it, redeem it on local ClassPilot, and verify the course, assignment, due date, points, requirements, and links. Repeat with syllabus fixture and mobile website viewport.

- [ ] **Step 6: Configure and deploy infrastructure**

Create the `IMPORT_HANDOFFS` KV namespace, place its ID in `worker/wrangler.toml`, deploy the Worker, then push `main`. Verify the public Worker health and GitHub Pages URL return success. Do not commit secrets.

- [ ] **Step 7: Commit and publish**

```bash
git add package.json README.md worker/README.md .github/workflows/pages.yml tests/release-contract.test.js extension scripts dist/ClassPilot-Canvas-Companion.zip
git commit -m "Package and document Canvas companion"
git push origin main
```
