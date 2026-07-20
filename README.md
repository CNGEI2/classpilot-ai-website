# ClassPilot AI

ClassPilot AI is a browser-based academic planning app for students. It imports syllabi, Canvas assignment pages, copied text, and screenshots, then organizes the work course by course.

Live site after GitHub Pages deployment:

```text
https://cngei2.github.io/classpilot-ai-website/
```

## What It Does

- Creates a separate directory for each course.
- Lets students upload each course syllabus separately.
- Lets students upload assignments directly inside a selected course directory, so a syllabus and assignments from the same class stay together.
- Reads Canvas assignment text for assignment title, due date, points, status, submission type, requirements, deliverables, links, and rubric signals.
- Supports screenshot OCR through bundled Tesseract.js assets.
- Builds assignment workplans with must-include requirements, deliverables, rubric signals, and step-by-step completion guidance.
- Keeps exams and course-level policies under the course directory, not under individual assignments.
- Includes an English/Chinese assignment coach that explains how to finish the selected assignment.

## How To Use

Open the live site in a browser.

1. Upload or paste a syllabus to create a course.
2. Select that course in the course list.
3. In the course directory, use **Upload into this course** for that course's syllabus updates, assignments, Canvas text, or screenshots.
4. Review the extracted information if the app asks for confirmation.
5. Use the assignment workplan and coach to understand what to submit and how to complete it.

## Local Development

For text-only imports, opening `index.html` directly works in most browsers.

For screenshot OCR, run a local server:

```bash
./start.command
```

Then open the printed local URL.

## Test

```bash
npm test
```

or:

```bash
node --test tests/logic.test.js
```

## GitHub Pages

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml`.

When the repository is pushed to `main`, the workflow:

1. Runs the logic tests.
2. Copies the static site files into a Pages artifact.
3. Deploys the site to GitHub Pages.

## Privacy

ClassPilot AI runs in the browser. Course data is stored in the browser's local storage on the user's own device. Uploaded screenshots are processed in the browser with bundled OCR files; this project does not include a backend server.
