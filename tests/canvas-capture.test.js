const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const parser = require("../extension/capture.js");

function fixtureText(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

test("captures a Canvas assignment with stable course and assignment identity", () => {
  const capture = parser.parseCanvasSnapshot({
    url: "https://sfbu.instructure.com/courses/1742/assignments/30213?module_item_id=87010",
    title: "Attend a seminar",
    capturedAt: "2026-07-25T12:00:00.000Z",
    breadcrumbs: ["SUMMER 2026 AI450 - A", "Assignments", "Attend a seminar"],
    mainText: fixtureText("canvas-assignment.html"),
    links: [],
    submissionTypes: ["Text", "Web URL", "Media", "Upload"]
  });

  assert.equal(capture.version, 1);
  assert.equal(capture.sourceType, "Canvas assignment page");
  assert.equal(capture.canvasHost, "sfbu.instructure.com");
  assert.deepEqual(capture.course, {
    canvasId: "1742",
    code: "AI450-A",
    name: "SUMMER 2026 AI450 - A"
  });
  assert.equal(capture.assignment.canvasId, "30213");
  assert.equal(capture.assignment.title, "Attend a seminar");
  assert.equal(capture.assignment.dueDate, "Tue Jul 28, 2026 11:59pm");
  assert.equal(capture.assignment.points, "100 Points Possible");
  assert.equal(capture.assignment.status.state, "In Progress");
  assert.equal(capture.assignment.status.nextUp, "Submit Assignment");
  assert.match(capture.assignment.instructionsText, /Max one page reflection/);
  assert.deepEqual(capture.assignment.submissionTypes, ["Text", "Web URL", "Media", "Upload"]);
});

test("captures a Canvas syllabus without inventing an assignment", () => {
  const capture = parser.parseCanvasSnapshot({
    url: "https://sfbu.instructure.com/courses/1742/assignments/syllabus",
    title: "AI450 Syllabus",
    capturedAt: "2026-07-25T12:00:00.000Z",
    breadcrumbs: ["SUMMER 2026 AI450 - A", "Syllabus"],
    mainText: fixtureText("canvas-syllabus.html"),
    headings: ["AI450 - AI in Modern Day Society: A Survey", "Course Schedule", "Course Policy"]
  });

  assert.equal(capture.sourceType, "Course syllabus");
  assert.equal(capture.course.canvasId, "1742");
  assert.equal(capture.course.code, "AI450-A");
  assert.equal(capture.assignment, undefined);
  assert.match(capture.syllabus.text, /Final Exam: August 20, 2026/);
});

test("validates required Canvas identity and material content", () => {
  assert.deepEqual(parser.validateCapture({}), {
    valid: false,
    missing: ["canvasHost", "course", "material"],
    message: "Open a Canvas assignment, rubric, or syllabus page and try again."
  });

  const valid = parser.validateCapture({
    canvasHost: "sfbu.instructure.com",
    course: { code: "AI450-A", name: "AI450" },
    assignment: { title: "Satoshi Paper" }
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.missing, []);
});

test("bounds raw content and ignores unavailable values instead of guessing", () => {
  const capture = parser.parseCanvasSnapshot({
    url: "https://sfbu.instructure.com/courses/99/assignments/100",
    capturedAt: "2026-07-25T12:00:00.000Z",
    breadcrumbs: ["CS500", "Assignments", "Research Brief"],
    mainText: "Research Brief\n" + "x".repeat(120000)
  });

  assert.equal(capture.rawText.length, 100000);
  assert.equal(capture.assignment.title, "Research Brief");
  assert.equal(capture.assignment.dueDate, undefined);
  assert.equal(capture.assignment.points, undefined);
});
