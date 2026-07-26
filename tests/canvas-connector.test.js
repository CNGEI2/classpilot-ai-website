const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
