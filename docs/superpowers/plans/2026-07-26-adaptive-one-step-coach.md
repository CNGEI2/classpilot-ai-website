# Adaptive One-Step Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClassPilot's fixed answer-and-list Coach with a stateful conversational coach that advances exactly one learning step per student turn.

**Architecture:** Extend the browser-side Coach contract to validate and persist a single structured step and coaching phase, then pass only the latest sanitized state to the Worker. Update both Workers AI and OpenAI adapters to share one strict response schema and one-step system prompt. Render the structured turn as a conversation plus one current-step panel with contextual student controls.

**Tech Stack:** Vanilla JavaScript, Node.js built-in test runner, Cloudflare Workers AI, static HTML/CSS, GitHub Pages

## Global Constraints

- Each assistant turn contains no more than one `currentStep` and one `checkpointQuestion`.
- The Coach waits for the student before advancing and does not write a complete submission.
- Assignment-specific guidance is grounded in the selected assignment, syllabus, rubric, and source catalog.
- Browser storage and requests remain course-and-assignment scoped and bounded.
- No provider key is exposed in browser code or local storage.
- Existing Canvas import, submission checker, scheduling, and course organization behavior remains unchanged.

---

### Task 1: Browser Coach Contract And Persistent State

**Files:**
- Modify: `coach.js`
- Modify: `tests/coach.test.js`

**Interfaces:**
- Produces: `validateCoachResponse(value) -> CoachResponseV2`
- Produces: `latestCoachState(messages) -> { phase, currentStepId, waitingForStudent } | null`
- Consumes: `createCoachClient(options).send({ context, messages, signal })`
- `CoachResponseV2` fields: `answer`, `phase`, `currentStep`, `checkpointQuestion`, `waitingForStudent`, `evidence`, `missingInformation`, `usage`, `mode`

- [ ] **Step 1: Write failing response-contract tests**

Add tests that validate a complete V2 response, clamp `estimatedMinutes` to `1..60`, strip unknown fields, reject invalid phases, and convert only the first legacy `nextSteps` item:

```js
const value = validateCoachResponse({
  answer: "Choose one crisis factor to investigate.",
  phase: "research",
  currentStep: {
    id: "choose-factor",
    title: "Choose one factor",
    instruction: "Select the factor that best explains Bitcoin's appeal.",
    doneWhen: "You can name the factor and explain why it matters.",
    estimatedMinutes: 10
  },
  checkpointQuestion: "Which factor did you choose, and why?",
  waitingForStudent: true
});
assert.equal(value.currentStep.id, "choose-factor");
assert.equal(value.phase, "research");
assert.equal(value.waitingForStudent, true);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test tests/coach.test.js`

Expected: failures because `phase`, `currentStep`, `checkpointQuestion`, and coaching state are not yet supported.

- [ ] **Step 3: Implement bounded V2 normalization and legacy conversion**

Add constants for the eight allowed phases, a `cleanCurrentStep` helper, an exported `latestCoachState` helper, and V2 fields in assistant-message normalization. Preserve the existing evidence, usage, mode, and message limits.

- [ ] **Step 4: Send only the latest state with bounded history**

Change the client request body to:

```js
const body = {
  context: context && typeof context === "object" ? context : {},
  messages: boundMessages(messages, 8, 24000),
  coachState: latestCoachState(messages)
};
```

Add assertions that user-only history sends `coachState: null` and assistant state contains only `phase`, `currentStepId`, and `waitingForStudent`.

- [ ] **Step 5: Run Task 1 tests**

Run: `node --test tests/coach.test.js`

Expected: all Coach browser-contract tests pass.

### Task 2: Worker One-Step Protocol

**Files:**
- Modify: `worker/worker.mjs`
- Modify: `tests/coach-worker.test.js`

**Interfaces:**
- Consumes: `{ context, messages, coachState }` from `sanitizeRequestBody`
- Produces: `normalizeCoachPayload(value, usage, mode) -> CoachResponseV2`
- Produces: one shared JSON schema through `coachResponseSchema()`
- Produces: one shared system prompt through `coachInstructions()`

- [ ] **Step 1: Write failing Worker schema and state tests**

Assert that sanitized input preserves only valid state, the schema exposes a single object rather than a `nextSteps` array, and mock/Workers AI/OpenAI modes return the same V2 keys.

```js
assert.equal(value.phase, "understand");
assert.equal(value.currentStep.id, "name-the-requirement");
assert.equal(value.checkpointQuestion, "Which requirement is least clear?");
assert.equal(value.waitingForStudent, true);
assert.equal("nextSteps" in value, false);
```

- [ ] **Step 2: Add system-prompt behavior assertions**

Assert the upstream request contains explicit requirements for exactly one action, at most one checkpoint question, stopping for the student's reply, shrinking a step when stuck, focused draft feedback, course grounding, prompt-injection resistance, and refusal to produce the complete submission.

- [ ] **Step 3: Run focused Worker tests and confirm failure**

Run: `node --test tests/coach-worker.test.js`

Expected: failures reference the old `nextSteps` response contract.

- [ ] **Step 4: Implement input-state sanitization and V2 schema**

Accept only the allowed phase, a cleaned current-step ID, and a boolean `waitingForStudent`. Define `currentStep` as `object | null`, `checkpointQuestion` as one string, and require all top-level V2 fields.

- [ ] **Step 5: Replace the fixed-response prompt with the coaching protocol**

Keep the existing security and grounding instructions. Add language matching and the one-step turn rules. Tell the model to use `currentStep: null` for a diagnostic or factual turn and to set `waitingForStudent: false` only for `complete`.

- [ ] **Step 6: Normalize all providers and mock mode**

Replace list flattening with one `cleanCurrentStep` path shared by Workers AI and OpenAI output. Make mock mode deterministic with one current step and no hidden list.

- [ ] **Step 7: Run Task 2 tests**

Run: `node --test tests/coach-worker.test.js tests/coach.test.js`

Expected: all Worker and browser Coach contract tests pass.

### Task 3: Conversational Coach Interface

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `tests/ui-contract.test.js`
- Modify: `tests/release-contract.test.js`

**Interfaces:**
- Consumes: stored `CoachResponseV2` assistant messages
- Produces: `renderCoachMessage(message, courseId, assignmentId)` with one current-step panel
- Produces: `sendCoachStepFeedback(kind)` for `done`, `stuck`, and `check`
- Consumes: existing `submitCoachQuestion(course, assignment, question, action)`

- [ ] **Step 1: Write failing UI contract tests**

Assert the old `coach-next-steps` list is absent and the source contains controls for:

```html
data-coach-step-feedback="done"
data-coach-step-feedback="stuck"
data-coach-step-feedback="check"
```

Also assert the structured phase, instruction, `doneWhen`, estimate, checkpoint, and add-to-task action are rendered.

- [ ] **Step 2: Run focused UI tests and confirm failure**

Run: `node --test tests/ui-contract.test.js tests/release-contract.test.js`

Expected: failures because the old multi-step list and fixed quick-action labels remain.

- [ ] **Step 3: Replace fixed quick actions and multi-step rendering**

Use conversation starters `Help me start`, `I'm stuck`, and `Check my idea`. Render one current-step panel with phase label, instruction, completion condition, estimate, checkpoint question, and optional add-to-task button.

- [ ] **Step 4: Persist structured assistant messages**

When a response returns, append `phase`, `currentStep`, `checkpointQuestion`, and `waitingForStudent` instead of `nextSteps`. Keep evidence, missing information, mode, and timestamp.

- [ ] **Step 5: Implement contextual student controls**

`Done, continue` sends a short completion message naming the current step. `I'm stuck` sends a request to make that same step smaller. `Check my idea` focuses the composer and sets a non-submitted prompt asking the student to paste their idea, so no empty review request is sent.

- [ ] **Step 6: Style stable desktop and mobile layouts**

Add bounded grid/flex dimensions for the current-step panel and its controls. Use existing neutral, green, and amber design tokens, 8px-or-less radii, visible focus states, and full-width wrapping below the existing mobile breakpoint.

- [ ] **Step 7: Run Task 3 tests**

Run: `node --test tests/ui-contract.test.js tests/release-contract.test.js tests/coach.test.js`

Expected: all interface and Coach tests pass.

### Task 4: Production Model And Documentation

**Files:**
- Modify: `worker/wrangler.toml`
- Modify: `worker/wrangler.toml.example`
- Modify: `worker/README.md`
- Modify: `README.md`
- Test: `tests/release-contract.test.js`

**Interfaces:**
- Consumes: `WORKERS_AI_MODEL` Worker variable
- Produces: default model `@cf/qwen/qwen3-30b-a3b-fp8`

- [ ] **Step 1: Write failing release assertions**

Assert both Wrangler configuration files name `@cf/qwen/qwen3-30b-a3b-fp8` and documentation describes one-step adaptive coaching without claiming guaranteed grading or autonomous assignment completion.

- [ ] **Step 2: Run release tests and confirm failure**

Run: `node --test tests/release-contract.test.js`

Expected: failure because the current Wrangler model is `@cf/meta/llama-3.1-8b-instruct-fast`.

- [ ] **Step 3: Update Worker configuration and product documentation**

Change the default model in both Wrangler files. Document the one-step interaction, course-context boundary, local conversation storage, keyless Workers AI architecture, and the three student controls.

- [ ] **Step 4: Run Task 4 tests**

Run: `node --test tests/release-contract.test.js tests/coach-worker.test.js`

Expected: all release and Worker tests pass.

### Task 5: Full Verification, Deployment, And Public QA

**Files:**
- Modify only when a failing verification exposes a scoped defect.

**Interfaces:**
- Produces: deployed Worker endpoint and updated GitHub Pages site

- [ ] **Step 1: Run all automated verification**

Run: `npm run verify`

Expected: every Node test passes and every listed JavaScript file passes `node --check`.

- [ ] **Step 2: Start a local static server**

Run: `npm start`

Expected: the app responds at `http://127.0.0.1:4173/` without console-breaking load errors.

- [ ] **Step 3: Perform desktop and mobile browser QA**

At desktop and mobile viewport widths, verify the Coach loads, conversation controls fit, current-step content does not overlap, messages scroll, language changes, clear works, and the composer remains usable.

- [ ] **Step 4: Deploy the Worker**

Run: `npx wrangler deploy --config worker/wrangler.toml`

Expected: deployment succeeds for `https://classpilot-ai-coach.cngei2-classpilot.workers.dev`.

- [ ] **Step 5: Run production one-step conversations**

Use the Satoshi Paper assignment context for start, follow-up, done, stuck, draft-check, complete-answer refusal, missing requirement, and Chinese follow-up cases. Each successful turn must satisfy the seven acceptance assertions in the design specification.

- [ ] **Step 6: Commit and push the implementation**

Run:

```bash
git add coach.js worker/worker.mjs app.js styles.css tests README.md worker/README.md worker/wrangler.toml worker/wrangler.toml.example docs/superpowers/plans/2026-07-26-adaptive-one-step-coach.md
git commit -m "Build adaptive one-step AI coach"
git push origin main
```

Expected: `main` is synchronized with `origin/main` and GitHub Pages begins serving the new commit.

- [ ] **Step 7: Verify the public site**

Open `https://cngei2.github.io/classpilot-ai-website/`, confirm the new Coach controls are present, and complete one live multi-turn exchange through the deployed Worker.
