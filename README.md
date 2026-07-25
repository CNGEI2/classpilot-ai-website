# ClassPilot AI

ClassPilot AI is a browser-based academic planning workspace. It turns course material into a private, editable view of what is due, what belongs to each course, when to work on it, and how to keep the data portable.

Live site: [https://cngei2.github.io/classpilot-ai-website/](https://cngei2.github.io/classpilot-ai-website/)

## Product

ClassPilot has four views:

- **Today** prioritizes the next action, upcoming work, this week's deadlines, and a compact Recently completed history.
- **Courses** keeps syllabi, searchable and status-filtered assignments, requirements, deliverables, completion steps, and course guidance together.
- **Calendar** combines assignment and exam dates, filters by course or item type, and exports visible dates as an ICS calendar file.
- **Data** exports and restores complete JSON backups, reports the current schema, and lets the student explicitly clear local data.

Import PDF, PNG, JPEG, WebP, TXT, Markdown, CSV, or pasted text. PDF and image reading run in the browser, including local OCR for scanned pages. Imports are limited to 25 MB and PDFs to 40 pages.

Start an import from a selected course to bind the result to that course. The review step lets the student correct extracted course or assignment details before saving. Students can edit assignments, checklist task titles, course identity, and syllabus details. They can also delete assignments, courses, or tasks and undo the most recent deletion until another successful workspace change occurs.

Today uses a deterministic planning score that combines overdue and remaining time, submitted or completed state, estimated remaining effort, points or weight, and missing required information. The interface translates the result into only **Do now**, **Do next**, or **Planned**; it never exposes the raw score.

## Data And Privacy

ClassPilot stores its workspace in this browser only. There is no account, backend, server-side AI processing, or transmission of course material to an application server.

Export a JSON backup before changing browsers or clearing data. Restore deeply validates course, assignment, and task records before replacing the current workspace. Transient storage failures remain retryable, and restore or clear can recover from corrupt version 7 data. The current workspace uses schema version 7 and migrates the prior version 6 local course storage on first load while retaining the version 6 value as a recovery copy.

This release does not provide notifications after the page closes, live cross-device synchronization, server AI, or direct Canvas login. It can parse uploaded or pasted Canvas content, but it does not sign in to Canvas or connect to a Canvas API.

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

The GitHub Pages workflow runs `npm ci`, then `npm run verify`, and packages the exact static runtime files (`index.html`, `app.js`, `logic.js`, `planner.js`, `file-readers.js`, `styles.css`, `vendor/`, and `.nojekyll`) into a fresh Pages artifact on every deployment.
