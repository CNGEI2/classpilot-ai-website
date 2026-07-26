# ClassPilot AI

ClassPilot AI is a browser-based academic planning workspace. It turns course material into a private, editable view of what is due, what belongs to each course, when to work on it, and how to keep the data portable.

Live site: [https://cngei2.github.io/classpilot-ai-website/](https://cngei2.github.io/classpilot-ai-website/)

## Product

ClassPilot has four primary views:

- **Today** prioritizes the next action, starts a 25-minute focus session in one click, and builds an automatic study schedule from the work that remains.
- **Courses** keeps syllabi, searchable assignments, requirements, deliverables, completion steps, submission checks, and course guidance together.
- **Conversational AI Coach** uses the selected course and assignment context for follow-up questions, requirement checks, and practical work plans. Each course and assignment keeps a separate browser-local conversation.
- **Calendar** combines assignment, exam, and automatically replanned study-session dates and exports visible dates as an ICS file.
- **Data** connects approved Canvas accounts, exports and restores JSON backups, and lets the student explicitly clear local data.

Import PDF, DOCX, PPTX, PNG, JPEG, WebP, TXT, Markdown, CSV, or pasted text. Document and image reading run in the browser, including local OCR for scanned pages. Imports are limited to 25 MB and PDFs to 40 pages.

Start an import from a selected course to bind the result to that course. The review step lets the student correct extracted course or assignment details before saving. Students can edit assignments, checklist task titles, course identity, and syllabus details. They can also delete assignments, courses, or tasks and undo the most recent deletion until another successful workspace change occurs.

Today uses a deterministic planning score that combines overdue and remaining time, submitted or completed state, estimated remaining effort, points or weight, and missing required information. The interface translates the result into only **Do now**, **Do next**, or **Planned**; it never exposes the raw score.

Each assignment has a **Final check** file input. One upload checks file type, page or word constraints, deliverables, bibliography or primary-research markers, and rubric evidence. It returns a conservative **ClassPilot estimate** range. The AI-writing review is explicitly non-blocking and is never presented as proof of AI use. Raw submission text is not stored in the workspace.

## Canvas Sync

### Canvas Companion Without A Developer Key

The production fallback for schools that do not approve a Canvas Developer Key is **ClassPilot Canvas Companion**, a Manifest V3 browser extension. Open one Canvas assignment, rubric, or syllabus page, review the detected fields, and send it to ClassPilot. The capture is merged by Canvas host, course ID, and assignment ID, so syllabus and assignment imports remain under the same course and repeated captures update instead of duplicating records.

Download the current package: [`ClassPilot-Canvas-Companion.zip`](https://cngei2.github.io/classpilot-ai-website/downloads/ClassPilot-Canvas-Companion.zip)

The extension uses temporary `activeTab` access after an explicit student click. It never reads Canvas passwords, SSO credentials, MFA codes, cookies, or personal access tokens. The Worker keeps the sanitized capture for at most ten minutes, returns an opaque one-time code, and deletes the capture when ClassPilot redeems it. See [`extension/README.md`](extension/README.md) for installation, permissions, privacy, and removal instructions.

### Canvas Calendar Feed Without A Developer Key

Paste the private Canvas calendar feed URL once in **Data > Canvas** to refresh assignment deadlines and course-level exam dates. Calendar events merge by Canvas course and assignment identity, so they update existing records instead of creating another course. The feed URL stays only in that browser's local storage, is excluded from workspace backups, and is sent only when the student selects **Sync calendar**.

### Optional Institution OAuth

ClassPilot includes a read-only Canvas OAuth flow. After authorization, **Sync now** imports the student's active courses, syllabi, assignments, due dates, points, submission state, and allowed file types. Stable Canvas IDs keep repeated syncs in the same course and preserve completed ClassPilot tasks.

Canvas tokens never enter the static site or `localStorage`. The Worker stores OAuth tokens in Cloudflare KV and gives the browser an opaque session kept in `sessionStorage`. The proxy exposes only fixed Canvas `GET` routes for courses and assignments. The public connection becomes active after SFBU approves a scoped Canvas Developer Key and its Client ID, Client Secret, and KV binding are configured on the Worker.

## AI Coach

Open an assignment and choose **Ask Coach** to carry that exact assignment into the Coach tab. Quick questions explain the assignment, identify the next step, check requirements, or make a plan. Responses show the course evidence they rely on, and English, Chinese, and bilingual modes are available.

Coach evidence is built from a bounded source catalog for only the selected course and assignment. Live responses must return a valid source ID; citations with invented IDs are removed by the Worker, while accepted citations show the original source location and excerpt. Select a citation to return to its course or assignment context. Assignment-level Coach next steps include **Add task**, which adds an editable, duplicate-safe task only to that assignment.

The static site never contains a model API key. Coach requests go through the deployed Cloudflare Worker at `https://classpilot-ai-coach.cngei2-classpilot.workers.dev/api/coach`, which validates the origin and payload, removes unexpected fields, applies request limits, and uses a Cloudflare Workers AI binding for the public conversational service. OpenAI Responses remains an optional server-side provider and uses `store: false` when enabled.

For deterministic interface testing, open the site with `?coach=mock`. Practice mode is visibly labeled and returns local guidance; it never claims to be a live AI response.

## Data And Privacy

ClassPilot stores its workspace and Coach conversation history in this browser. OCR, PDF, DOCX, PPTX, and submission-file reading remain local. The selected course and assignment context is sent to the configured Coach backend only when the student sends a question; unrelated courses are excluded and complete raw uploads are not resent.

Export a JSON backup before changing browsers or clearing data. Restore deeply validates course, assignment, and task records before replacing the current workspace. Transient storage failures remain retryable, and restore or clear can recover from corrupt version 7 data. The current workspace uses schema version 7 and migrates the prior version 6 local course storage on first load while retaining the version 6 value as a recovery copy.

This release does not provide notifications after the page closes or live cross-device synchronization. The public Coach uses Cloudflare Workers AI; the optional OpenAI provider still requires a server-side key. Full background Canvas API sync still requires a school-approved Canvas Developer Key. Canvas Companion provides detailed one-page imports and the Canvas calendar feed refreshes deadlines without that key.

The complete personal workflow is intentionally connected: **Final check** evaluates the student's proposed submission before the deadline, while **Canvas** sync can supply official course and assignment records after school authorization.

## Local Development

```bash
npm ci
npm run verify
npm start
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/) after starting the local server. A server is required for browser module and OCR workflows; opening `index.html` directly is not a supported verification path.

## Verification

```bash
npm test
npm run check
npm run verify
```

The GitHub Pages workflow runs `npm ci`, then `npm run verify`, and packages the exact static runtime files, local readers, planning modules, Coach and Canvas connectors, styles, and vendored browser dependencies into a fresh Pages artifact on every deployment.

See [`worker/README.md`](worker/README.md) for secure Coach backend deployment and live-mode configuration.
