const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mergeCanvasCalendar,
  normalizeCanvasCalendarFeedUrl,
  parseCanvasCalendarFeed
} = require("../canvas-calendar.js");

const FEED_URL = "https://sfbu.instructure.com/feeds/calendars/user_abc123.ics";

function feed(overrides = "") {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:assignment_30213@sfbu.instructure.com",
    "DTSTART:20260729T065900Z",
    "SUMMARY:Attend a seminar [AI450-A]",
    "DESCRIPTION:Max one page reflection on the seminar you attended.",
    "URL:https://sfbu.instructure.com/courses/1742/assignments/30213",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:event_991@sfbu.instructure.com",
    "DTSTART;VALUE=DATE:20260808",
    "SUMMARY:Final Exam [AI450-A]",
    "URL:https://sfbu.instructure.com/calendar?event_id=991&include_contexts=course_1742",
    "END:VEVENT",
    overrides,
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}

test("normalizes only Canvas HTTPS calendar-feed URLs", () => {
  assert.equal(normalizeCanvasCalendarFeedUrl(FEED_URL), FEED_URL);
  assert.equal(
    normalizeCanvasCalendarFeedUrl("webcal://sfbu.instructure.com/feeds/calendars/user_abc123.ics"),
    FEED_URL
  );
  assert.equal(normalizeCanvasCalendarFeedUrl("https://sfbu.instructure.com/login"), "");
  assert.equal(normalizeCanvasCalendarFeedUrl("https://127.0.0.1/feeds/calendars/user_a.ics"), "");
  assert.equal(normalizeCanvasCalendarFeedUrl("https://user:pass@sfbu.instructure.com/feeds/calendars/user_a.ics"), "");
});

test("parses Canvas assignments and keeps exams at course level", () => {
  const snapshot = parseCanvasCalendarFeed(feed(), FEED_URL);
  const course = snapshot.courses[0];

  assert.equal(snapshot.domain, "sfbu.instructure.com");
  assert.equal(snapshot.eventCount, 2);
  assert.equal(course.id, "1742");
  assert.equal(course.course_code, "AI450-A");
  assert.equal(course.assignments[0].id, "30213");
  assert.equal(course.assignments[0].name, "Attend a seminar");
  assert.equal(course.assignments[0].due_at, "2026-07-29T06:59:00.000Z");
  assert.equal(course.exams[0].label, "Final Exam");
  assert.equal(course.exams[0].date, "2026-08-08");
  assert.equal(course.exams[0].source.canvasEventId, "991");
});

test("merges a calendar into one existing course and preserves completed work", () => {
  const workspace = {
    courses: [{
      id: "local-ai450",
      code: "AI450-A",
      name: "AI in Modern Day Society",
      assignments: [],
      coursePlan: { deadlines: [], exams: [] },
      source: {
        canvasDomain: "sfbu.instructure.com",
        canvasCourseId: "1742"
      }
    }]
  };
  const first = mergeCanvasCalendar(workspace, parseCanvasCalendarFeed(feed(), FEED_URL));
  const course = first.courses[0];
  course.assignments[0].tasks[0].done = true;

  const updatedFeed = feed().replace("20260729T065900Z", "20260730T065900Z");
  const second = mergeCanvasCalendar(first, parseCanvasCalendarFeed(updatedFeed, FEED_URL));

  assert.equal(second.courses.length, 1);
  assert.equal(second.courses[0].id, "local-ai450");
  assert.equal(second.courses[0].assignments.length, 1);
  assert.equal(second.courses[0].assignments[0].tasks[0].done, true);
  assert.equal(second.courses[0].assignments[0].dueAt, "2026-07-30T06:59:00.000Z");
  assert.equal(second.courses[0].coursePlan.exams.length, 1);
  assert.equal(second.courses[0].coursePlan.deadlines.length, 1);
  assert.equal(second.courses[0].coursePlan.exams[0].label, "Final Exam");
});

test("unfolds iCalendar text and ignores events without a course identity", () => {
  const text = feed([
    "BEGIN:VEVENT",
    "UID:assignment_44@sfbu.instructure.com",
    "DTSTART;TZID=America/Los_Angeles:20260730T115900",
    "SUMMARY:Long strategic analysis [BUS500]",
    "DESCRIPTION:First requirement\\nSecond requirement that is",
    " folded onto another line",
    "URL:https://sfbu.instructure.com/courses/99/assignments/44",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:personal-event",
    "DTSTART:20260730T120000Z",
    "SUMMARY:Personal reminder",
    "END:VEVENT"
  ].join("\r\n"));
  const snapshot = parseCanvasCalendarFeed(text, FEED_URL);
  const bus = snapshot.courses.find((course) => course.course_code === "BUS500");

  assert.equal(snapshot.eventCount, 4);
  assert.equal(snapshot.importedEventCount, 3);
  assert.equal(snapshot.skippedEventCount, 1);
  assert.match(bus.assignments[0].description, /Second requirement that isfolded/);
  assert.equal(bus.assignments[0].due_at, "2026-07-30T11:59:00");
});
