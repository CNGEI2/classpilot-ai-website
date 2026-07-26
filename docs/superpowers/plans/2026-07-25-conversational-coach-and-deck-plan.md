# Conversational Coach And Product Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real multi-turn AI Coach on the public site and update the product deck to describe the complete ClassPilot workflow.

**Architecture:** Keep the existing bounded Coach request contract and add Cloudflare Workers AI as the default provider behind the current Worker. Reshape the existing Coach tab into a message-first chat surface without changing course and assignment scoping. Rebuild the existing deck from its artifact-tool source with fresh product screenshots.

**Tech Stack:** Vanilla JavaScript, Node test runner, Cloudflare Worker and Workers AI binding, CSS, Playwright browser control, `@oai/artifact-tool`.

## Global Constraints

- Never expose provider credentials or Canvas tokens in frontend code or browser storage.
- Send only the selected course, selected assignment, bounded sources, and bounded conversation history.
- Preserve evidence validation, academic-integrity guidance, bilingual responses, Add task, stop, and clear controls.
- Keep Canvas read-only and visibly configuration-gated until the school approves a Developer Key.
- Preserve the existing presentation's visual language and source notes.

---

### Task 1: Workers AI Provider

**Files:**
- Modify: `tests/coach-worker.test.js`
- Modify: `worker/worker.mjs`
- Modify: `worker/wrangler.toml`

**Interfaces:**
- Consumes: sanitized `{ context, messages }` Coach payloads.
- Produces: `workersAiCoachResponse(payload, env)` returning the existing validated Coach response contract.

- [ ] Add a failing test proving `COACH_MODE=workers_ai` calls `env.AI.run` with bounded multi-turn messages and returns `mode: "live"`.
- [ ] Run `node --test tests/coach-worker.test.js` and confirm the new test fails because Workers AI dispatch does not exist.
- [ ] Implement Workers AI request construction, structured-output extraction, timeout handling, and provider dispatch.
- [ ] Run the focused Worker tests and confirm they pass.
- [ ] Commit the provider implementation.

### Task 2: Message-First Coach UI

**Files:**
- Modify: `tests/ui-contract.test.js`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: existing browser-local Coach messages and request state.
- Produces: left/right chat bubbles, pending typing indicator, live connection label, and an accessible composer.

- [ ] Add failing UI contract tests for message alignment classes, typing indicator, transcript scrolling hook, and live wording.
- [ ] Run the focused UI tests and confirm the new assertions fail.
- [ ] Refactor Coach rendering and CSS to the message-first layout while retaining all actions.
- [ ] Run focused Coach UI tests and confirm they pass.
- [ ] Commit the UI implementation.

### Task 3: Product Documentation And Completion Audit

**Files:**
- Modify: `README.md`
- Modify: `worker/README.md`
- Modify: `worker/.dev.vars.example`
- Modify: `tests/release-contract.test.js`

**Interfaces:**
- Consumes: final provider modes and product capabilities.
- Produces: accurate setup, privacy, cost-boundary, and feature documentation.

- [ ] Add failing release-contract assertions for the Workers AI default and complete learning loop.
- [ ] Run the release test and confirm failure.
- [ ] Update documentation and configuration examples.
- [ ] Run release tests and confirm success.
- [ ] Commit documentation changes.

### Task 4: Browser QA And Screenshots

**Files:**
- Replace: `product-presentation/.build/coach-desktop.png`
- Replace: `product-presentation/.build/coach-mobile.png`

**Interfaces:**
- Consumes: the local final application with deterministic test data.
- Produces: verified desktop and mobile screenshots for the deck.

- [ ] Start the local site and open the Coach with a realistic multi-turn thread.
- [ ] Verify no console errors or horizontal overflow at 1440x900 and 390x844.
- [ ] Capture desktop and mobile screenshots showing the conversation surface.
- [ ] Save the screenshots into the presentation build directory.

### Task 5: Presentation Update

**Files:**
- Modify: `product-presentation/build-presentation.mjs`
- Replace: `product-presentation/ClassPilot-AI-Product-Introduction.pptx`

**Interfaces:**
- Consumes: verified product screenshots and completed capability list.
- Produces: a polished nine-slide product introduction deck with source notes.

- [ ] Update slide copy and visuals to show conversational Coach, Today focus, automatic schedule, final check, Canvas boundary, and verification.
- [ ] Build the PPTX with `@oai/artifact-tool`.
- [ ] Render every slide and inspect the montage and individual slides.
- [ ] Run slide overflow checks and repair every unintended issue.
- [ ] Commit the final deck and source.

### Task 6: Release

**Files:**
- Verify all changed runtime and presentation files.

**Interfaces:**
- Consumes: completed application and deck.
- Produces: tested main branch, deployed Pages site, deployed Worker, and final PPTX.

- [ ] Run `npm run verify` and confirm zero failures.
- [ ] Merge the feature branch into `main` and rerun verification.
- [ ] Push `main`, wait for GitHub Pages success, and deploy the Worker.
- [ ] Verify the public site and a live Coach response.
