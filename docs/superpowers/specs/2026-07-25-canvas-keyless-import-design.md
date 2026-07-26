# ClassPilot Keyless Canvas Import Design

## Summary

ClassPilot will support useful Canvas imports without a Canvas Developer Key by combining two student-controlled channels:

1. A Manifest V3 browser extension that captures the currently open Canvas page only after an explicit click.
2. A Canvas iCal subscription that refreshes course events and due dates without exposing Canvas credentials.

The existing file, screenshot, document, and pasted-text import remains the mobile and universal fallback. ClassPilot account sign-in is a separate concern used for cloud data ownership and cross-device synchronization; it does not authenticate to Canvas.

This design does not collect Canvas passwords or ask users to paste personal access tokens.

## Goals

- Import a Canvas assignment or syllabus with one explicit action from the Canvas page.
- Reliably bind imported content to the correct course.
- Import assignment title, due date, points, instructions, links, submission requirements, rubric text, and visible status when those fields are present.
- Use the Canvas calendar feed to refresh deadlines across courses.
- Preserve the current ClassPilot parsing, review, planning, Coach, and final-check workflows.
- Keep the public GitHub Pages site usable when the extension is not installed.
- Minimize permissions and keep Canvas credentials out of ClassPilot.

## Non-Goals

- Silently crawl an entire Canvas account in the background.
- Read grades, submissions, or course pages the student has not intentionally opened or synchronized.
- Imitate Canvas login, collect school passwords, or bypass SSO and MFA.
- Ask general users for Canvas personal access tokens.
- Guarantee compatibility with every institution-specific Canvas theme in the first release.

## User Experience

### Assignment Capture

1. The student signs into Canvas normally through the school.
2. The student opens an assignment page and clicks the ClassPilot extension action.
3. The extension displays a compact preview containing course, assignment, due date, and points.
4. The student selects `Add to ClassPilot`.
5. The extension sends a normalized capture to the public ClassPilot site and opens or focuses ClassPilot.
6. ClassPilot runs the existing smart-import analysis, shows review only for missing or low-confidence fields, and saves the assignment under the captured course.
7. The assignment receives requirements, deliverables, actionable steps, and Coach context.

### Syllabus Capture

1. The student opens the syllabus page inside a course.
2. The extension detects syllabus content and the active course identity.
3. One click imports the syllabus into that exact course.
4. ClassPilot updates course-level meeting information, exams, policies, and schedule items without creating a duplicate course.

### Calendar Feed

1. In ClassPilot Data settings, the student chooses `Connect Canvas calendar`.
2. ClassPilot explains where to copy the private Canvas iCal feed URL and warns that the URL must be treated as a secret.
3. The browser stores the feed URL locally. The Worker receives it only in a refresh request and does not persist it.
4. The Worker validates the URL, fetches the feed, and returns normalized calendar events.
5. ClassPilot groups events under known courses, presents unresolved course matches once, and merges future refreshes by stable event identity.

### Mobile

Mobile browsers continue to use the responsive public website. Students can upload or share a screenshot, PDF, DOCX, PPTX, TXT, or downloaded ICS file. The UI does not imply that the desktop extension is available on unsupported mobile browsers.

## Architecture

### Browser Extension

The extension is a separate `extension/` package in the repository and uses Manifest V3.

Components:

- `service-worker.js`: handles toolbar actions, tab messaging, and delivery to ClassPilot.
- `capture.js`: reads the active page DOM and returns a structured capture.
- `popup.html` and `popup.js`: displays the preview, consent action, errors, and success state.
- `manifest.json`: requests only `activeTab`, `scripting`, and the minimum storage permission needed for pending delivery.
- Parser fixtures and unit tests: cover Canvas assignment, submitted assignment, rubric, and syllabus page variants.

The extension reads page content only after the student clicks it. It does not request broad persistent access to all browsing history.

### Website Bridge

The extension opens ClassPilot with a short-lived import handoff. The payload must not be placed directly in the URL. The preferred delivery sequence is:

1. Extension posts the capture to a narrow Worker endpoint.
2. Worker validates size, schema, origin metadata, and expiration, then returns a one-time opaque handoff code.
3. Extension opens `https://cngei2.github.io/classpilot-ai-website/?import=<code>`.
4. ClassPilot redeems the code once and deletes or expires the payload.

The handoff contains Canvas page content but no cookies, password, session token, or personal access token. Captures expire after ten minutes and can be redeemed once.

### Calendar Proxy

The existing Cloudflare Worker gains a fixed calendar-feed endpoint. It accepts only HTTPS URLs whose resolved host is the user-entered Canvas host, blocks private and reserved network targets, enforces response size and timeout limits, rejects redirects to unapproved hosts, parses or returns only calendar content, and does not persist the feed URL. The feed URL is sent in the request body so it does not appear in request paths.

### Existing Import Pipeline

Extension captures are converted into the same draft shape used by file and screenshot imports. The selected or captured Canvas course identity is authoritative. Parsing may enrich the draft but cannot move it to another course unless the user explicitly changes the course in review.

## Capture Schema

Each capture contains:

- `version`
- `capturedAt`
- `sourceUrl`
- `sourceType`
- `canvasHost`
- `course.canvasId` when visible in the URL
- `course.code`
- `course.name`
- `assignment.canvasId` when visible in the URL
- `assignment.title`
- `assignment.dueDate`
- `assignment.points`
- `assignment.status`
- `assignment.instructionsText`
- `assignment.links`
- `assignment.submissionTypes`
- `assignment.allowedExtensions`
- `assignment.rubric`
- `syllabus.text`
- `rawText` as a bounded fallback

Fields that are not visible are omitted rather than guessed. Raw content has a strict size limit and scripts, styles, form values, hidden navigation, and credential-related fields are excluded.

## Course Matching and Deduplication

Matching priority:

1. Existing Canvas course ID plus Canvas host.
2. Exact normalized course code within the same Canvas host.
3. Exact normalized course name and term.
4. One-time student confirmation when no safe match exists.

Assignment matching priority:

1. Existing Canvas assignment ID plus Canvas host.
2. Course plus normalized title and due date.
3. Course plus normalized title when no due date exists.

An updated capture merges official fields while preserving completed ClassPilot checklist items and student notes.

## Security and Privacy

- Never collect or transmit Canvas passwords, SSO credentials, MFA codes, cookies, or access tokens.
- Use explicit user action before page capture.
- Request temporary `activeTab` access instead of broad `all_urls` access.
- Show a preview before sending content to ClassPilot.
- Use one-time, expiring handoff codes instead of URL-embedded page text.
- Enforce strict Worker allowlists, private-network blocking, payload limits, timeouts, content types, and rate limits.
- Treat Canvas calendar feed URLs as secrets; keep them in the student's browser and never include them in logs or analytics.
- Provide disconnect, clear calendar URL, clear pending import, and delete imported data controls.

## Failure Handling

- Unsupported Canvas page: explain that the student should open an assignment, rubric, or syllabus page.
- Missing course identity: allow a course selection before delivery.
- Partial page load: identify missing required fields and keep the capture available for retry.
- Expired handoff: return to the extension preview and issue a fresh one-time code.
- Canvas layout change: retain bounded raw text so the existing ClassPilot parser can recover common fields.
- Calendar feed unavailable: keep the last successful events, mark them stale, and show the last refresh time.
- Calendar course ambiguity: hold unresolved events in an inbox instead of creating duplicate courses.

## Testing

### Unit Tests

- DOM extraction for each provided Canvas screenshot and copied-text case.
- Course and assignment ID extraction from Canvas URLs.
- Hidden UI and navigation removal.
- Rubric, due date, points, status, links, and submission requirement extraction.
- Course matching and repeat-import merge behavior.
- ICS parsing, recurrence handling, timezone conversion, deduplication, and stale-event updates.
- Handoff expiration, one-time redemption, size limits, and invalid schema rejection.

### Integration Tests

- Extension capture to Worker handoff to ClassPilot review and save.
- Assignment update preserving completed tasks and notes.
- Syllabus import remaining inside the selected Canvas course.
- Calendar refresh merging with assignment captures without duplicate deadlines.
- Offline and expired-handoff recovery.

### Browser QA

- Chrome desktop at common laptop widths.
- Public ClassPilot site on desktop and mobile viewports.
- Keyboard navigation, focus states, reduced motion, and screen-reader status announcements.
- Extension behavior on the SFBU Canvas page shapes represented by the user's screenshots.

## Delivery Phases

### Phase 1: One-Click Page Capture

Build the extension, secure handoff, Canvas page parser, preview, course binding, tests, README, and local installation package. This provides the largest immediate reduction in student effort.

### Phase 2: Calendar Feed

Add private iCal connection, Worker proxy, downloaded ICS import, calendar merge behavior, and refresh controls.

### Phase 3: Account Sync

Add ClassPilot email or magic-link authentication only when cloud backup and cross-device synchronization are ready. Account login remains separate from Canvas access.

### Phase 4: Distribution and Maintenance

Prepare Chrome Web Store assets and privacy disclosures, publish after user approval, add parser telemetry that contains no page content, and maintain fixture-based compatibility tests for Canvas layout changes.

## Success Criteria

- A student can import an open Canvas assignment into the correct course with one confirmation click.
- The test screenshots produce the expected assignment title, course, due date, points, requirements, and visible status.
- Re-importing an assignment updates it instead of duplicating it.
- A syllabus capture never creates a second course when the Canvas course is already known.
- Calendar refresh adds or updates deadlines without duplicating captured assignments.
- No Canvas credential, cookie, access token, or calendar-feed secret is persisted on the Worker.
- Existing file, OCR, Coach, planner, final-check, backup, and GitHub Pages release tests continue to pass.
