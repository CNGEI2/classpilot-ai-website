const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStudySchedule } = require("../study-scheduler.js");

function workspaceFixture(done = false) {
  return {
    courses: [{
      id: "ai450",
      code: "AI450",
      name: "AI in Society",
      assignments: [{
        id: "paper",
        title: "Satoshi Paper",
        dueAt: "2026-07-27T23:00:00.000Z",
        estimateMinutes: 120,
        tasks: [
          { id: "outline", title: "Draft outline", done },
          { id: "report", title: "Write report", done: false }
        ]
      }, {
        id: "reflection",
        title: "AI Reflection",
        dueAt: "2026-07-29T23:00:00.000Z",
        estimateMinutes: 60,
        tasks: [{ id: "draft", title: "Draft reflection", done: false }]
      }]
    }]
  };
}

test("buildStudySchedule creates bounded sessions before each deadline", () => {
  const now = new Date("2026-07-25T08:00:00.000Z");
  const plan = buildStudySchedule(workspaceFixture(), now, {
    days: 5,
    sessionMinutes: 50,
    blocks: [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }]
  });

  assert.ok(plan.sessions.length >= 4);
  assert.ok(plan.sessions.every((session) => session.minutes > 0 && session.minutes <= 50));
  assert.ok(plan.sessions.every((session) => new Date(session.startAt) < new Date(session.dueAt)));
  assert.equal(plan.sessions[0].assignmentId, "paper");
  assert.equal(plan.sessions[0].nextAction, "Draft outline");
});

test("completing a task automatically reduces and reallocates scheduled time", () => {
  const now = new Date("2026-07-25T08:00:00.000Z");
  const before = buildStudySchedule(workspaceFixture(false), now);
  const after = buildStudySchedule(workspaceFixture(true), now);
  const totalForPaper = (plan) => plan.sessions
    .filter((session) => session.assignmentId === "paper")
    .reduce((sum, session) => sum + session.minutes, 0);

  assert.equal(totalForPaper(before), 120);
  assert.equal(totalForPaper(after), 60);
  assert.ok(after.sessions.some((session) => session.assignmentId === "reflection"));
});

test("schedule output is deterministic and does not mutate the workspace", () => {
  const workspace = workspaceFixture();
  const before = JSON.stringify(workspace);
  const now = new Date("2026-07-25T08:00:00.000Z");

  assert.deepEqual(buildStudySchedule(workspace, now), buildStudySchedule(workspace, now));
  assert.equal(JSON.stringify(workspace), before);
});
