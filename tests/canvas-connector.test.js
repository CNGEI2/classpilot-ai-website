const test = require("node:test");
const assert = require("node:assert/strict");

const {
  captureToCanvasSnapshot,
  mergeCanvasCapture,
  mergeCanvasSnapshot,
  normalizeCanvasDomain
} = require("../canvas-connector.js");

function snapshot() {
  return {
    domain: "sfbu.instructure.com",
    courses: [{
      id: "1742",
      course_code: "AI450-A",
      name: "AI in Modern Day Society",
      term: { name: "Summer 2026" },
      syllabus_body: "<h2>Course schedule</h2><p>Final exam: Aug 8, 2026</p>",
      assignments: [{
        id: "30244",
        name: "Read and respond Contactless Love",
        due_at: "2026-07-14T22:00:00Z",
        points_possible: 20,
        html_url: "https://sfbu.instructure.com/courses/1742/assignments/30244",
        description: "<h3>Mini Play</h3><ul><li>One AI healthcare technology</li><li>One ethical dilemma</li></ul>",
        allowed_extensions: ["docx", "pdf"],
        submission_types: ["online_upload"],
        submission: { workflow_state: "graded", score: 20, submitted_at: "2026-07-14T20:00:00Z" }
      }]
    }]
  };
}

test("normalizeCanvasDomain accepts only HTTPS hostnames", () => {
  assert.equal(normalizeCanvasDomain("https://sfbu.instructure.com/"), "sfbu.instructure.com");
  assert.equal(normalizeCanvasDomain("sfbu.instructure.com"), "sfbu.instructure.com");
  assert.equal(normalizeCanvasDomain("http://sfbu.instructure.com"), "");
  assert.equal(normalizeCanvasDomain("sfbu.instructure.com/path"), "");
  assert.equal(normalizeCanvasDomain("javascript:alert(1)"), "");
});

test("mergeCanvasSnapshot imports structured course and assignment data", () => {
  const merged = mergeCanvasSnapshot({ courses: [] }, snapshot(), new Date("2026-07-25T10:00:00Z"));
  const course = merged.courses[0];
  const assignment = course.assignments[0];

  assert.equal(course.code, "AI450-A");
  assert.equal(course.source.canvasCourseId, "1742");
  assert.equal(course.coursePlan.term, "Summer 2026");
  assert.equal(assignment.title, "Read and respond Contactless Love");
  assert.equal(assignment.dueAt, "2026-07-14T22:00:00.000Z");
  assert.equal(assignment.points, "20 Points Possible");
  assert.equal(assignment.status.score, "20/20");
  assert.equal(assignment.source.canvasAssignmentId, "30244");
  assert.deepEqual(assignment.details.allowedExtensions, ["docx", "pdf"]);
  assert.ok(assignment.details.requirements.some((item) => /ethical dilemma/i.test(item)));
});

test("re-sync updates the same Canvas records and preserves completed tasks", () => {
  const first = mergeCanvasSnapshot({ courses: [] }, snapshot());
  first.courses[0].assignments[0].tasks[0].done = true;
  const changed = snapshot();
  changed.courses[0].assignments[0].name = "Contactless Love response";
  changed.courses[0].assignments[0].due_at = "2026-07-16T22:00:00Z";

  const second = mergeCanvasSnapshot(first, changed);

  assert.equal(second.courses.length, 1);
  assert.equal(second.courses[0].assignments.length, 1);
  assert.equal(second.courses[0].assignments[0].title, "Contactless Love response");
  assert.equal(second.courses[0].assignments[0].tasks[0].done, true);
});

function pageCapture(overrides = {}) {
  return {
    version: 1,
    canvasHost: "sfbu.instructure.com",
    sourceUrl: "https://sfbu.instructure.com/courses/1742/assignments/30251",
    sourceType: "Canvas assignment page",
    course: {
      canvasId: "1742",
      code: "AI450-A",
      name: "AI in Modern Day Society"
    },
    assignment: {
      canvasId: "30251",
      title: "Satoshi Paper",
      dueDate: "Mon Jun 22, 2026 9:00am",
      points: "50 Points Possible",
      status: { state: "Late", nextUp: "Review Feedback" },
      instructionsText: "Read the Bitcoin white paper.\nWrite a strategic analysis.\nInclude original thinking.",
      links: [{ text: "Bitcoin white paper", href: "https://bitcoin.org/bitcoin.pdf" }],
      submissionTypes: ["File Upload"],
      allowedExtensions: ["pdf", "docx"],
      rubric: [{ label: "Strategic Insight Beyond AI", description: "Original thinking", points: "35%" }]
    },
    rawText: "Satoshi Paper\nDue: Mon Jun 22, 2026 9:00am",
    ...overrides
  };
}

test("converts a page capture to a bounded Canvas snapshot", () => {
  const converted = captureToCanvasSnapshot(pageCapture());
  const assignment = converted.courses[0].assignments[0];

  assert.equal(converted.domain, "sfbu.instructure.com");
  assert.equal(converted.courses[0].id, "1742");
  assert.equal(assignment.id, "30251");
  assert.equal(assignment.name, "Satoshi Paper");
  assert.equal(assignment.points_possible, 50);
  assert.equal(assignment.status.state, "Late");
  assert.deepEqual(assignment.allowed_extensions, ["pdf", "docx"]);
  assert.equal(assignment.rubric[0].label, "Strategic Insight Beyond AI");
});

test("repeat page captures update one assignment and preserve completed work", () => {
  const first = mergeCanvasCapture({ courses: [] }, pageCapture(), new Date("2026-07-25T10:00:00Z"));
  const assignment = first.courses[0].assignments[0];
  assignment.tasks[0].done = true;
  const changed = pageCapture();
  changed.assignment.points = "60 Points Possible";
  changed.assignment.instructionsText += "\nInterview one professional.";

  const second = mergeCanvasCapture(first, changed, new Date("2026-07-25T11:00:00Z"));
  const updated = second.courses[0].assignments[0];

  assert.equal(second.courses.length, 1);
  assert.equal(second.courses[0].assignments.length, 1);
  assert.equal(updated.points, "60 Points Possible");
  assert.equal(updated.tasks[0].done, true);
  assert.equal(updated.source.type, "Canvas page capture");
  assert.equal(updated.status.value, "Late");
  assert.equal(updated.status.nextUp, "Review Feedback");
  assert.ok(updated.details.rubric.some((item) => /Strategic Insight/i.test(item.label)));
  assert.ok(updated.links.some((item) => item.includes("https://bitcoin.org/bitcoin.pdf")));
});

test("a syllabus capture updates the matching Canvas course without duplication", () => {
  const first = mergeCanvasCapture({ courses: [] }, pageCapture());
  const syllabus = pageCapture({
    sourceType: "Course syllabus",
    sourceUrl: "https://sfbu.instructure.com/courses/1742/assignments/syllabus",
    assignment: undefined,
    syllabus: {
      text: "AI450 Syllabus\nFinal Exam due August 20, 2026 9:00am\nLate work requires approval."
    }
  });
  const second = mergeCanvasCapture(first, syllabus);

  assert.equal(second.courses.length, 1);
  assert.equal(second.courses[0].assignments.length, 1);
  assert.equal(second.courses[0].coursePlan.syllabusUploaded, true);
  assert.ok(second.courses[0].coursePlan.exams.some((item) => /Final Exam/i.test(item.label)));
});

test("a capture with no visible points does not invent a zero-point assignment", () => {
  const capture = pageCapture();
  delete capture.assignment.points;
  const merged = mergeCanvasCapture({ courses: [] }, capture);

  assert.equal(merged.courses[0].assignments[0].points, "");
});
