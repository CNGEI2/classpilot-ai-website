# Conversational Coach And Product Deck Design

## Goal

Make the public Coach a real multi-turn AI conversation and update the product deck to accurately present the complete personal learning workflow.

## Coach Experience

The Coach remains scoped to the selected course and assignment, but the central surface becomes an unmistakable chat conversation. User messages align right, Coach messages align left, a pending turn shows a typing indicator, and the composer remains directly below the transcript. Quick prompts start a conversation rather than rendering a report. Evidence citations and Add task actions stay attached to the relevant Coach message.

Conversation history remains browser-local and separate for each course and assignment. Only the bounded current context and the latest bounded turns are sent after the student submits a question.

## Live AI Architecture

The Cloudflare Worker uses a Workers AI binding as the public default and retains OpenAI as an optional server-side provider. The default model is a current multilingual dialogue model configured through `WORKERS_AI_MODEL`. The Worker requests structured JSON, validates the result, removes invented citations, and returns the existing public response contract.

No model credential is exposed in the browser. The existing origin allowlist, request limits, timeout, source validation, and academic-integrity instructions continue to apply.

## Remaining Product Completion

The release documentation and interface must present the implemented product as one loop: course-bound import, assignment understanding, Today focus, automatic study scheduling, submission pre-check, conversational Coach, Calendar export, backup, and secure Canvas sync readiness. Canvas remains visibly unavailable until a school-approved Developer Key is configured.

## Presentation

Update the existing nine-slide visual system rather than replacing it. New screenshots must show the live conversational Coach. The narrative must cover the complete learning loop, submission intelligence, secure architecture, Canvas boundary, and verified release. Every externally sourced claim receives a source block in speaker notes.

## Verification

Automated tests cover Workers AI request/response handling, provider errors, chat UI contract, existing OpenAI fallback, and all prior product behavior. Browser QA covers desktop and mobile conversation layouts, console errors, and horizontal overflow. The deck is rendered slide by slide and checked for overflow before delivery.
