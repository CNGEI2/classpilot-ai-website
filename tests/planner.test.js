const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const {
  createAssignmentFromDraft,
  createCourseDraftFromMaterial
} = require("../logic.js");
const {
  WORKSPACE_SCHEMA_VERSION,
  buildCalendarItems,
  createEmptyWorkspace,
  createIcsCalendar,
  createWorkspaceSnapshot,
  buildTodayQueue,
  enrichWorkspacePlanningFields,
  estimateAssignmentMinutes,
  hasMeaningfulScore,
  migrateLegacyCourses,
  normalizeWorkspace,
  removeAssignment,
  removeWorkspaceCourse,
  parseDueAt,
  parseWorkspaceBackup,
  replaceCoursePlan,
  restoreWorkspaceSnapshot,
  serializeWorkspaceBackup,
  updateCourse,
  updateAssignment
} = require("../planner.js");

function planningFixture() {
  return {
    courses: [{
      id: "cs450",
      code: "CS450",
      name: "Technology and Society",
      assignments: [{
        id: "late-reflection",
        title: "Late Reflection",
        dueDate: "Jul 20, 2026, 11:59 PM",
        details: { steps: ["Revise the conclusion"] }
      }, {
        id: "research-paper",
        title: "Research Paper",
        dueDate: "Jul 24, 2026, 11:59 PM",
        details: {
          steps: [
            { title: "Choose sources", done: true },
            "Draft the analysis"
          ]
        }
      }, {
        id: "submitted-paper",
        title: "Submitted Paper",
        dueDate: "Jul 21, 2026, 11:59 PM",
        status: { submittedAt: "2026-07-21T18:00:00.000Z" }
      }]
    }]
  };
}

function workspaceFixture() {
  return {
    schemaVersion: 7,
    courses: [{
      id: "cs450",
      code: "CS450",
      name: "Technology and Society",
      coursePlan: { syllabusUploaded: false, professor: "" },
      assignments: [{
        id: "paper",
        title: "Research Paper",
        dueDate: "Jul 25, 2026, 11:59 PM",
        estimateMinutes: 120,
        tasks: []
      }]
    }, {
      id: "cs101",
      code: "CS101",
      name: "Computer Science",
      assignments: [{ id: "problem-set", title: "Problem Set", tasks: [] }]
    }],
    preferences: {
      activeView: "today",
      activeCourseId: "cs450",
      language: "en",
      calendarCourseFilter: "all"
    },
    metadata: {
      updatedAt: "2026-07-22T16:00:00.000Z",
      lastBackupAt: ""
    }
  };
}

function calendarFixture() {
  return {
    courses: [{
      id: "cs450",
      code: "CS450",
      name: "Technology and Society",
      assignments: [{
        id: "paper",
        title: "Research Paper",
        dueDate: "Jul 25, 2026, 11:59 PM"
      }],
      coursePlan: { exams: [{ label: "Midterm", date: "Jul 28, 2026" }] }
    }, {
      id: "cs101",
      code: "CS101",
      name: "Computer Science",
      assignments: [{ id: "problem-set", title: "Problem Set" }],
      coursePlan: { exams: [{ label: "Final", date: "Jul 30, 2026" }] }
    }]
  };
}

test("creates an empty version 7 workspace", () => {
  const workspace = createEmptyWorkspace(new Date("2026-07-22T09:00:00-07:00"));
  assert.equal(workspace.schemaVersion, 7);
  assert.deepEqual(workspace.courses, []);
  assert.equal(workspace.preferences.activeView, "today");
});

test("migrates version 6 courses without losing assignment completion", () => {
  const legacy = [{
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: [{
      id: "paper",
      title: "Research Paper",
      tasks: [{ id: "read", title: "Read white paper", done: true }]
    }]
  }];
  const workspace = migrateLegacyCourses(legacy, new Date("2026-07-22T09:00:00-07:00"));
  assert.equal(workspace.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(workspace.courses[0].assignments[0].tasks[0].done, true);
});

test("normalizing malformed input returns a valid workspace", () => {
  const workspace = normalizeWorkspace({ schemaVersion: 7, courses: "wrong" });
  assert.deepEqual(workspace.courses, []);
  assert.equal(workspace.preferences.activeView, "today");
});

test("updates one assignment without changing another course", () => {
  const source = workspaceFixture();
  const updated = updateAssignment(source, "cs450", "paper", {
    dueDate: "Jul 30, 2026, 11:59 PM",
    estimateMinutes: 180
  }, new Date("2026-07-22T10:00:00-07:00"));
  assert.equal(updated.courses[0].assignments[0].estimateMinutes, 180);
  assert.equal(updated.courses[1].assignments[0].title, "Problem Set");
  assert.notEqual(updated, source);
});

test("editing an assignment due date refreshes its normalized due timestamp", () => {
  const source = workspaceFixture();
  source.courses[0].assignments[0].dueAt = "2026-07-25T06:59:00.000Z";

  const updated = updateAssignment(source, "cs450", "paper", {
    dueDate: "Aug 3, 2026, 5:00 PM"
  }, new Date("2026-07-22T10:00:00-07:00"));

  assert.equal(updated.courses[0].assignments[0].dueDate, "Aug 3, 2026, 5:00 PM");
  assert.equal(
    updated.courses[0].assignments[0].dueAt,
    new Date("Aug 3, 2026, 5:00 PM").toISOString()
  );
});

test("unrelated assignment updates preserve an existing normalized due timestamp", () => {
  const source = workspaceFixture();
  const dueAt = "2026-07-25T06:59:00.000Z";
  source.courses[0].assignments[0].dueAt = dueAt;

  const updated = updateAssignment(source, "cs450", "paper", {
    estimateMinutes: 180,
    status: { late: true },
    tasks: [{ id: "outline", title: "Outline the paper", done: false }]
  }, new Date("2026-07-22T10:00:00-07:00"));

  assert.equal(updated.courses[0].assignments[0].dueAt, dueAt);
  assert.equal(updated.courses[0].assignments[0].estimateMinutes, 180);
  assert.deepEqual(updated.courses[0].assignments[0].status, { late: true });
  assert.deepEqual(updated.courses[0].assignments[0].tasks, [
    { id: "outline", title: "Outline the paper", done: false }
  ]);
});

test("removes an assignment and restores the pre-delete snapshot", () => {
  const source = workspaceFixture();
  const snapshot = createWorkspaceSnapshot(source);
  assert.equal(removeAssignment(source, "cs450", "paper").courses[0].assignments.length, 0);
  assert.deepEqual(restoreWorkspaceSnapshot(snapshot), source);
});

test("replacing a syllabus preserves assignments", () => {
  const source = workspaceFixture();
  const updated = replaceCoursePlan(source, "cs450", {
    syllabusUploaded: true,
    professor: "Professor Lin"
  });
  assert.equal(updated.courses[0].coursePlan.professor, "Professor Lin");
  assert.equal(updated.courses[0].assignments[0].title, "Research Paper");
});

test("updates course identity in place without losing plan or assignments", () => {
  const source = workspaceFixture();
  source.courses[0].coursePlan.deadlines = [{
    label: "Final Exam",
    date: "Dec 12, 2026"
  }];
  source.courses[0].assignments[0].tasks = [{
    id: "read",
    title: "Read the paper",
    done: true
  }];

  const updated = updateCourse(source, "cs450", {
    code: "AI 450",
    name: "AI and Modern Society"
  }, new Date("2026-07-23T10:00:00-07:00"));

  assert.equal(updated.courses.length, 2);
  assert.equal(updated.courses[0].id, "cs450");
  assert.equal(updated.courses[0].code, "AI 450");
  assert.equal(updated.courses[0].name, "AI and Modern Society");
  assert.equal(updated.preferences.activeCourseId, "cs450");
  assert.equal(updated.courses[0].coursePlan.deadlines[0].date, "Dec 12, 2026");
  assert.equal(updated.courses[0].assignments[0].tasks[0].done, true);
  assert.equal(source.courses[0].code, "CS450");
});

test("missing assignment and course IDs leave workspace metadata untouched", () => {
  const source = workspaceFixture();
  const now = new Date("2026-07-23T10:00:00-07:00");

  assert.equal(removeAssignment(source, "cs450", "missing", now).metadata.updatedAt,
    source.metadata.updatedAt);
  assert.equal(removeWorkspaceCourse(source, "missing", now).metadata.updatedAt,
    source.metadata.updatedAt);
  assert.equal(replaceCoursePlan(source, "missing", { professor: "Nobody" }, now)
    .metadata.updatedAt, source.metadata.updatedAt);
});

test("removing the active course selects the next course and preserves the source", () => {
  const source = workspaceFixture();
  const before = JSON.parse(JSON.stringify(source));
  const updated = removeWorkspaceCourse(source, "cs450",
    new Date("2026-07-23T10:00:00-07:00"));

  assert.equal(updated.preferences.activeCourseId, "cs101");
  assert.equal(updated.courses.length, 1);
  assert.equal(updated.courses[0].assignments[0].title, "Problem Set");
  assert.deepEqual(source, before);
});

test("successful mutations update workspace and assignment timestamps", () => {
  const source = workspaceFixture();
  const now = new Date("2026-07-23T10:00:00-07:00");
  const expected = now.toISOString();

  const updated = updateAssignment(source, "cs450", "paper", {}, now);
  assert.equal(updated.metadata.updatedAt, expected);
  assert.equal(updated.courses[0].assignments[0].updatedAt, expected);
  assert.equal(replaceCoursePlan(source, "cs450", {}, now).metadata.updatedAt, expected);
  assert.equal(removeAssignment(source, "cs450", "paper", now).metadata.updatedAt, expected);
  assert.equal(removeWorkspaceCourse(source, "cs450", now).metadata.updatedAt, expected);
});

test("updating an assignment with no patch is a timestamped immutable no-op", () => {
  const source = workspaceFixture();
  const before = JSON.parse(JSON.stringify(source));
  const updated = updateAssignment(source, "cs450", "paper", undefined,
    new Date("2026-07-23T10:00:00-07:00"));

  assert.equal(updated.courses[0].assignments[0].title, "Research Paper");
  assert.deepEqual(source, before);
});

test("restoring a sparse snapshot supplies optional workspace defaults", () => {
  const restored = restoreWorkspaceSnapshot(JSON.stringify({
    schemaVersion: 7,
    courses: [],
    preferences: {},
    metadata: {}
  }));

  assert.equal(restored.preferences.activeView, "today");
  assert.equal(restored.preferences.activeCourseId, "");
  assert.equal(restored.preferences.language, "en");
  assert.equal(restored.preferences.calendarCourseFilter, "all");
  assert.equal(restored.metadata.lastBackupAt, "");
  assert.match(restored.metadata.updatedAt, /^20/);
});

test("orders overdue work before near-due and submitted work", () => {
  const queue = buildTodayQueue(planningFixture(), new Date("2026-07-22T09:00:00-07:00"));
  assert.equal(queue.active[0].title, "Late Reflection");
  assert.equal(queue.active[0].priorityBand, "do-now");
  assert.ok(queue.active.every((item) => item.title !== "Submitted Paper"));
});

test("uses the first incomplete step as the next action", () => {
  const queue = buildTodayQueue(planningFixture(), new Date("2026-07-22T09:00:00-07:00"));
  const paper = queue.active.find((item) => item.title === "Research Paper");
  assert.equal(paper.nextAction, "Draft the analysis");
});

test("checklist tasks drive next action before imported detail steps", () => {
  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: [{
        id: "lab",
        title: "Systems lab",
        dueDate: "Jul 25, 2026, 5:00 PM",
        details: {
          steps: [
            { title: "Stale imported first step", done: false },
            { title: "Stale imported second step", done: false }
          ]
        },
        tasks: [
          { id: "outline", title: "Outline the report", done: true },
          { id: "draft", title: "Draft the report", done: false },
          { id: "review", title: "Review the report", done: false }
        ]
      }]
    }]
  };

  const queue = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );
  assert.equal(queue.now.nextAction, "Draft the report");

  workspace.courses[0].assignments[0].tasks[1].done = true;
  const advanced = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );
  assert.equal(advanced.now.nextAction, "Review the report");
});

test("estimates more time for research and interviews", () => {
  const minutes = estimateAssignmentMinutes({
    details: {
      requirements: ["Interview three stakeholders", "Write a 5 page report"],
      steps: ["Research", "Interview", "Draft", "Revise"]
    }
  });
  assert.ok(minutes >= 240);
});

test("persists normalized planning fields on assignments", () => {
  const enriched = enrichWorkspacePlanningFields(workspaceFixture());
  const assignment = enriched.courses[0].assignments[0];
  assert.ok(assignment.dueAt);
  assert.ok(assignment.estimateMinutes >= 30);
  assert.ok(["do-now", "do-next", "planned"].includes(assignment.priorityBand));
});

test("normalizes valid due dates and rejects invalid input", () => {
  assert.equal(parseDueAt("2026-07-25T18:30:00-07:00"),
    "2026-07-26T01:30:00.000Z");
  assert.ok(parseDueAt("02/29/2024"));
  assert.ok(parseDueAt("2024-02-29"));
  assert.equal(parseDueAt("02/31/2026"), "");
  assert.equal(parseDueAt("13/01/2026"), "");
  assert.equal(parseDueAt("2026-02-29"), "");
  assert.equal(parseDueAt("2026-13-01"), "");
  assert.equal(parseDueAt("not a date"), "");
  assert.equal(parseDueAt(undefined), "");
});

test("yearless English dates use injected context across planning and Calendar", () => {
  const now = new Date("2026-07-20T12:00:00-07:00");
  const expected = parseDueAt("Jul 25, 2026, 11:59 PM", now);
  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS777",
      assignments: [{
        id: "literal-day",
        title: "Literal Day",
        dueDate: "Jul 25 11:59 PM",
        dueAt: "2001-07-26T06:59:00.000Z",
        tasks: []
      }, {
        id: "fallback-day",
        title: "Fallback Day",
        dueDate: "not a date",
        dueAt: "2026-07-26T01:00:00.000Z",
        tasks: []
      }]
    }]
  };

  assert.equal(parseDueAt("Jul 25 11:59 PM", now), expected);
  assert.equal(
    enrichWorkspacePlanningFields(workspace, now)
      .courses[0].assignments[0].dueAt,
    expected
  );
  const items = buildCalendarItems(workspace, { now });
  assert.equal(
    items.find((item) => item.id === "literal-day").dueAt,
    expected
  );
  assert.equal(
    items.find((item) => item.id === "fallback-day").dueAt,
    "2026-07-26T01:00:00.000Z"
  );
});

test("academic year range imports stay on the selected endpoint across planning exports", () => {
  const now = new Date("2026-07-20T12:00:00-07:00");
  const draft = createCourseDraftFromMaterial(`
    Academic Year 2026-2027 CS779 > Assignments > Winter checkpoint
    Winter checkpoint
    Due: Jan 25 9:00 AM
    Submit the checkpoint
  `, "winter-checkpoint.txt", { now });
  const assignment = createAssignmentFromDraft(draft, "cs779");
  const workspace = {
    courses: [{
      id: "cs779",
      code: "CS779",
      name: "Academic Year",
      assignments: [assignment]
    }]
  };
  const expected = parseDueAt("Jan 25, 2027, 9:00 AM", now);

  assert.equal(assignment.dueDate, "Jan 25, 2027, 9:00 AM");
  assert.equal(
    enrichWorkspacePlanningFields(workspace, now)
      .courses[0].assignments[0].dueAt,
    expected
  );
  assert.equal(buildTodayQueue(workspace, now).active[0].dueAt, expected);
  const calendarItems = buildCalendarItems(workspace, { now });
  assert.equal(calendarItems[0].dueAt, expected);
  assert.match(
    createIcsCalendar(calendarItems),
    new RegExp(
      "DTSTART:" +
      expected.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    )
  );
});

test("strictly validates structured English month dates across Calendar and ICS", () => {
  const now = new Date("2026-01-10T12:00:00-08:00");
  const invalidDates = [
    "Feb 31, 2026, 11:59 PM",
    "Tuesday, Apr 31, 2026 at 8:30 AM",
    "Feb 29, 2025",
    "Sept 31, 2026",
    "Sep. 31, 2026",
    "31 Feb 2026",
    "Sep 31st, 2026"
  ];
  const validDates = [
    ["Thursday, Feb 29, 2024 at 8:30 AM", "Feb 29, 2024, 8:30 AM"],
    ["Sept 30, 2026", "Sep 30, 2026"],
    ["Sep. 30, 2026", "Sep 30, 2026"],
    ["29 Feb 2024", "Feb 29, 2024"]
  ];
  invalidDates.forEach((value) => {
    assert.equal(parseDueAt(value, now), "", value);
  });
  validDates.forEach(([value, canonical]) => {
    assert.equal(
      parseDueAt(value, now),
      parseDueAt(canonical, now),
      value
    );
  });

  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS777",
      assignments: [
        ...invalidDates.map((dueDate, index) => ({
          id: "invalid-" + index,
          title: "Invalid " + index,
          dueDate
        })),
        ...validDates.map(([dueDate], index) => ({
          id: "valid-" + index,
          title: "Valid " + index,
          dueDate
        }))
      ]
    }]
  };
  const items = buildCalendarItems(workspace, { now });
  invalidDates.forEach((value, index) => {
    assert.equal(
      items.find((item) => item.id === "invalid-" + index).dueAt,
      "",
      value
    );
  });
  validDates.forEach(([dueDate, canonical], index) => {
    assert.equal(
      items.find((item) => item.id === "valid-" + index).dueAt,
      parseDueAt(canonical, now),
      dueDate
    );
  });
  const ics = createIcsCalendar(items);
  assert.match(ics, /SUMMARY:CS777 - Valid 0/);
  assert.match(ics, /SUMMARY:CS777 - Valid 3/);
  assert.doesNotMatch(ics, /SUMMARY:CS777 - Invalid/);
});

test("strictly handles separated English month dates across planner Calendar and ICS", () => {
  const now = new Date("2026-01-10T12:00:00-08:00");
  const invalidDates = [
    "31-Feb-2026",
    "31/Feb/2026",
    "31.Feb.2026",
    "Feb-31-2026",
    "Feb/31/2026",
    "Feb.31.2026"
  ];
  const validDates = [
    "29-Feb-2024",
    "29/Feb/2024",
    "29.Feb.2024",
    "Feb-29-2024",
    "Feb/29/2024",
    "Feb.29.2024"
  ];
  const expectedDueAt = new Date(2024, 1, 29, 0, 0, 0, 0)
    .toISOString();

  invalidDates.forEach((value) => {
    assert.equal(parseDueAt(value, now), "", value);
  });
  validDates.forEach((value) => {
    assert.equal(parseDueAt(value, now), expectedDueAt, value);
  });

  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS777",
      assignments: [
        ...invalidDates.map((dueDate, index) => ({
          id: "separated-invalid-" + index,
          title: "Separated invalid " + index,
          dueDate
        })),
        ...validDates.map((dueDate, index) => ({
          id: "separated-valid-" + index,
          title: "Separated valid " + index,
          dueDate
        }))
      ]
    }]
  };
  const items = buildCalendarItems(workspace, { now });
  invalidDates.forEach((value, index) => {
    assert.equal(
      items.find((item) =>
        item.id === "separated-invalid-" + index
      ).dueAt,
      "",
      value
    );
  });
  validDates.forEach((value, index) => {
    assert.equal(
      items.find((item) =>
        item.id === "separated-valid-" + index
      ).dueAt,
      expectedDueAt,
      value
    );
  });

  const ics = createIcsCalendar(items);
  assert.doesNotMatch(ics, /SUMMARY:CS777 - Separated invalid/);
  validDates.forEach((value, index) => {
    assert.match(
      ics,
      new RegExp(`SUMMARY:CS777 - Separated valid ${index}`),
      value
    );
  });
  assert.match(ics, /DTSTART:20240229T/);
});

test("keeps ISO date-only values on their literal local day west of UTC", () => {
  const plannerPath = path.join(__dirname, "..", "planner.js");
  const script = `
    const planner = require(${JSON.stringify(plannerPath)});
    const dueAt = planner.parseDueAt("2026-07-25");
    const date = new Date(dueAt);
    const localKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    const items = planner.buildCalendarItems({
      courses: [{
        id: "course-1",
        code: "CS101",
        assignments: [{
          id: "assignment-1",
          title: "Local-day lab",
          dueDate: "2026-07-25"
        }]
      }]
    });
    const ics = planner.createIcsCalendar(items);
    process.stdout.write(JSON.stringify({ dueAt, localKey, ics }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: "America/Los_Angeles" }
  }));

  assert.equal(result.dueAt, "2026-07-25T07:00:00.000Z");
  assert.equal(result.localKey, "2026-07-25");
  assert.match(result.ics, /DTSTART:20260725T070000Z/);
});

test("clamps explicit estimates to the supported range", () => {
  assert.equal(estimateAssignmentMinutes({ estimateMinutes: 5 }), 30);
  assert.equal(estimateAssignmentMinutes({ estimateMinutes: 5000 }), 1200);
});

test("keeps incomplete assignments active while excluding exact completion statuses", () => {
  const categories = ["Incomplete", "submitted", "complete", "completed", "feedback"];
  const workspace = { courses: [{ id: "course", assignments: categories.map((category, index) => ({
    id: category,
    title: category,
    category,
    dueDate: `2026-07-${23 + index}, 11:59 PM`
  })) }] };
  const queue = buildTodayQueue(workspace, new Date("2026-07-22T09:00:00-07:00"));
  assert.deepEqual(queue.active.map((item) => item.title), ["Incomplete"]);
});

test("completed and submitted assignments leave active Today and enter Recently completed", () => {
  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: [{
        id: "active",
        title: "Active lab",
        dueDate: "Jul 25, 2026, 5:00 PM",
        status: { completed: false }
      }, {
        id: "completed",
        title: "Completed lab",
        dueDate: "Jul 20, 2026, 5:00 PM",
        status: {
          completed: true,
          completedAt: "2026-07-21T18:00:00.000Z"
        }
      }, {
        id: "submitted",
        title: "Submitted paper",
        dueDate: "Jul 22, 2026, 5:00 PM",
        status: { submittedAt: "2026-07-22T15:00:00.000Z" }
      }]
    }]
  };

  const queue = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );

  assert.deepEqual(queue.active.map((item) => item.id), ["active"]);
  assert.deepEqual(
    queue.recentlyCompleted.map((item) => [item.id, item.completionLabel]),
    [
      ["submitted", "Submitted"],
      ["completed", "Completed"]
    ]
  );
});

test("graded categories, statuses, and meaningful scores are terminal work", () => {
  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: [{
        id: "score-only",
        title: "Scored paper",
        status: { score: "92/100" }
      }, {
        id: "graded-category",
        title: "Graded project",
        category: "Graded"
      }, {
        id: "graded-status",
        title: "Graded quiz",
        status: "Graded"
      }, {
        id: "not-graded",
        title: "Awaiting a grade",
        status: { score: "N/A" }
      }]
    }]
  };

  const queue = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );
  const completionLabels = Object.fromEntries(
    queue.recentlyCompleted.map((item) => [item.id, item.completionLabel])
  );

  assert.deepEqual(queue.active.map((item) => item.id), ["not-graded"]);
  assert.deepEqual(completionLabels, {
    "graded-category": "Graded",
    "graded-status": "Graded",
    "score-only": "Graded"
  });
});

test("meaningful score placeholders stay active while real zero and grades are terminal", () => {
  const cases = [
    ["blank", "", false],
    ["null", null, false],
    ["na-upper", "N/A", false],
    ["na-lower", "n/a", false],
    ["pending", "Pending", false],
    ["ungraded", "Ungraded", false],
    ["not-graded", "Not graded", false],
    ["zero-number", 0, true],
    ["zero-fraction", "0/100", true],
    ["percent", "85%", true],
    ["letter", "A", true],
    ["fraction", "45/50", true]
  ];
  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: cases.map(([id, score]) => ({
        id,
        title: id,
        status: { score }
      }))
    }]
  };
  const queue = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );
  const activeIds = new Set(queue.active.map((item) => item.id));
  const completedIds = new Set(
    queue.recentlyCompleted.map((item) => item.id)
  );

  for (const [id, score, meaningful] of cases) {
    assert.equal(hasMeaningfulScore(score), meaningful);
    assert.equal(activeIds.has(id), !meaningful);
    assert.equal(completedIds.has(id), meaningful);
  }
});

test("Today exposes an empty Recently completed collection when nothing is done", () => {
  const queue = buildTodayQueue(
    { courses: [{ id: "course-1", assignments: [] }] },
    new Date("2026-07-22T09:00:00-07:00")
  );
  assert.deepEqual(queue.recentlyCompleted, []);
});

test("assigns all priority bands from the supplied current time", () => {
  const workspace = { courses: [{ id: "course", assignments: [
    { id: "overdue", title: "Overdue", dueDate: "2026-07-21T12:00:00-07:00" },
    { id: "soon", title: "Soon", dueDate: "2026-07-22T18:00:00-07:00" },
    { id: "next", title: "Next", dueDate: "2026-07-24T09:00:00-07:00" },
    { id: "planned", title: "Planned", dueDate: "2026-07-30T09:00:00-07:00" }
  ] }] };
  const queue = buildTodayQueue(workspace, new Date("2026-07-22T09:00:00-07:00"));
  assert.deepEqual(Object.fromEntries(queue.active.map((item) => [item.id, item.priorityBand])), {
    overdue: "do-now",
    soon: "do-now",
    next: "do-next",
    planned: "planned"
  });
});

test("high-impact high-effort work can outrank a trivial task due slightly earlier", () => {
  const workspace = {
    courses: [{
      id: "course-1",
      code: "BUS501",
      assignments: [{
        id: "trivial",
        title: "Short check-in",
        dueDate: "2026-07-23T15:00:00-07:00",
        estimateMinutes: 30,
        points: "5 points",
        details: {
          requirements: ["Answer one question"],
          steps: ["Submit response"]
        }
      }, {
        id: "major",
        title: "Capstone analysis",
        dueDate: "2026-07-23T21:00:00-07:00",
        estimateMinutes: 600,
        points: "200 Points Possible",
        details: {
          requirements: [
            "Research the market",
            "Interview stakeholders",
            "Write the final analysis"
          ],
          deliverables: ["Ten-page report"],
          steps: ["Research", "Interview", "Draft", "Revise"]
        }
      }]
    }]
  };

  const queue = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );

  assert.equal(queue.active[0].id, "major");
  assert.equal(queue.active[0].priorityBand, "do-next");
  assert.ok(queue.active[0].priorityScore > queue.active[1].priorityScore);
});

test("priority bands are monotonic with combined risk ordering", () => {
  const workspace = {
    courses: [{
      id: "course-1",
      assignments: [{
        id: "urgent",
        title: "Urgent response",
        dueDate: "2026-07-23T05:00:00-07:00",
        estimateMinutes: 30,
        details: {
          requirements: ["Answer one question"],
          deliverables: ["Response"],
          steps: ["Submit"]
        }
      }, {
        id: "major",
        title: "Major project needing review",
        dueDate: "2026-07-26T10:00:00-07:00",
        estimateMinutes: 1200,
        points: "400 Points Possible",
        details: {},
        tasks: []
      }, {
        id: "trivial",
        title: "Tiny check-in",
        dueDate: "2026-07-26T08:00:00-07:00",
        estimateMinutes: 30,
        details: {
          requirements: ["Confirm attendance"],
          deliverables: ["Confirmation"],
          steps: ["Submit"]
        }
      }, {
        id: "undated",
        title: "Imported work needing review",
        details: {},
        tasks: []
      }]
    }]
  };
  const queue = buildTodayQueue(
    workspace,
    new Date("2026-07-22T09:00:00-07:00")
  );
  const bandRank = { "do-now": 3, "do-next": 2, planned: 1 };

  assert.deepEqual(
    queue.active.map((item) => item.id),
    ["urgent", "major", "trivial", "undated"]
  );
  assert.deepEqual(
    Object.fromEntries(
      queue.active.map((item) => [item.id, item.priorityBand])
    ),
    {
      urgent: "do-now",
      major: "do-next",
      trivial: "planned",
      undated: "planned"
    }
  );
  queue.active.slice(1).forEach((item, index) => {
    const previous = queue.active[index];
    assert.ok(previous.priorityScore >= item.priorityScore);
    assert.ok(
      bandRank[previous.priorityBand] >= bandRank[item.priorityBand],
      `${previous.id} cannot rank ahead with a lower urgency band`
    );
  });
});

test("undated missing-information work retains a nonzero planning risk", () => {
  const queue = buildTodayQueue({
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: [{
        id: "unknown",
        title: "Imported work needing review",
        details: {},
        tasks: []
      }]
    }]
  }, new Date("2026-07-22T09:00:00-07:00"));

  assert.equal(queue.now.id, "unknown");
  assert.equal(queue.now.dueAt, "");
  assert.equal(queue.now.priorityBand, "planned");
  assert.ok(queue.now.priorityScore > 0);
});

test("includes overdue and near-term work in thisWeek but excludes undated and far-future work", () => {
  const workspace = { courses: [{ id: "course", assignments: [
    { id: "overdue", title: "Overdue", dueDate: "2026-07-20T12:00:00-07:00" },
    { id: "near", title: "Near", dueDate: "2026-07-28T09:00:00-07:00" },
    { id: "far", title: "Far", dueDate: "2026-07-30T09:01:00-07:00" },
    { id: "undated", title: "Undated" }
  ] }] };
  const queue = buildTodayQueue(workspace, new Date("2026-07-22T09:00:00-07:00"));
  assert.deepEqual(queue.thisWeek.map((item) => item.title).sort(), ["Near", "Overdue"]);
});

test("building and enriching planning data do not mutate the workspace", () => {
  const source = planningFixture();
  const before = JSON.parse(JSON.stringify(source));
  const queue = buildTodayQueue(source, new Date("2026-07-22T09:00:00-07:00"));
  const enriched = enrichWorkspacePlanningFields(source,
    new Date("2026-07-22T09:00:00-07:00"));
  queue.active[0].details.steps.push("Changed queue copy");
  enriched.courses[0].assignments[0].title = "Changed enriched copy";
  assert.deepEqual(source, before);
});

test("builds filtered assignment and exam calendar items", () => {
  const assignmentItems = buildCalendarItems(calendarFixture(), {
    courseId: "cs450",
    type: "assignment"
  });
  const examItems = buildCalendarItems(calendarFixture(), {
    courseId: "cs450",
    type: "exam"
  });
  const paper = assignmentItems.find((item) => item.title === "Research Paper");
  assert.ok(paper);
  assert.ok(paper.dueAt);
  assert.equal(Date.parse(paper.dueAt),
    Date.parse("Jul 25, 2026, 11:59 PM"));
  assert.ok(assignmentItems.every((item) => item.type === "assignment"));
  assert.ok(examItems.some((item) => item.type === "exam"));
  assert.ok(examItems.every((item) => item.type === "exam"));
  assert.ok(assignmentItems.every((item) => item.courseId === "cs450"));
  assert.ok(examItems.every((item) => item.courseId === "cs450"));
});

test("escapes ICS summary characters without allowing property-line injection", () => {
  const ics = createIcsCalendar([{
    id: "paper",
    title: "Back\\slash\r\nInjected:evil; comma, final",
    courseCode: "CS450",
    dueAt: "2026-07-28T06:59:00.000Z",
    type: "assignment"
  }]);
  const summary = ics.split("\r\n").find((line) => line.startsWith("SUMMARY:"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.equal(summary,
    "SUMMARY:CS450 - Back\\\\slash\\nInjected:evil\\; comma\\, final");
  assert.doesNotMatch(ics, /\r\nInjected:evil/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("ICS UIDs include type, course, and item identity without collisions", () => {
  const items = [{
    id: "shared-assignment",
    courseId: "course-a",
    courseCode: "CS101",
    title: "Course A paper",
    dueAt: "2026-07-28T06:59:00.000Z",
    type: "assignment"
  }, {
    id: "shared-assignment",
    courseId: "course-b",
    courseCode: "CS102",
    title: "Course B paper",
    dueAt: "2026-07-29T06:59:00.000Z",
    type: "assignment"
  }, {
    id: "shared-assignment",
    courseId: "course-a",
    courseCode: "CS101",
    title: "Course A exam",
    dueAt: "2026-07-30T06:59:00.000Z",
    type: "exam"
  }, {
    id: "identity,\r\nInjected:evil;value",
    courseId: "course,unsafe;one",
    courseCode: "SAFE",
    title: "Escaped identity",
    dueAt: "2026-07-31T06:59:00.000Z",
    type: "assignment"
  }];
  const uidLines = (ics) => ics.split("\r\n")
    .filter((line) => line.startsWith("UID:"));
  const first = uidLines(createIcsCalendar(items));
  const second = uidLines(createIcsCalendar(items));

  assert.equal(new Set(first).size, items.length);
  assert.deepEqual(first, second);
  assert.ok(first.some((line) =>
    line.includes("assignment|course-a|shared-assignment")
  ));
  assert.ok(first.some((line) =>
    line.includes("assignment|course-b|shared-assignment")
  ));
  assert.ok(first.some((line) =>
    line.includes("exam|course-a|shared-assignment")
  ));
  assert.ok(first.some((line) =>
    line.includes("course\\,unsafe\\;one|identity\\,\\nInjected:evil\\;value")
  ));
  assert.doesNotMatch(first.join("\r\n"), /\r\nInjected:evil/);
});

test("generated exam identities remain stable when syllabus exams reorder", () => {
  const workspace = {
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: [],
      coursePlan: {
        exams: [
          { label: "Midterm", date: "Oct 10, 2026, 9:00 AM" },
          { label: "Final", date: "Dec 10, 2026, 9:00 AM" }
        ]
      }
    }]
  };
  const reversed = JSON.parse(JSON.stringify(workspace));
  reversed.courses[0].coursePlan.exams.reverse();
  const uidBySummary = (value) => Object.fromEntries(
    createIcsCalendar(buildCalendarItems(value))
      .split("BEGIN:VEVENT\r\n")
      .slice(1)
      .map((block) => {
        const lines = block.split("\r\n");
        return [
          lines.find((line) => line.startsWith("SUMMARY:")),
          lines.find((line) => line.startsWith("UID:"))
        ];
      })
  );

  assert.deepEqual(uidBySummary(workspace), uidBySummary(reversed));
});

test("skips calendar items with invalid non-empty dates", () => {
  const ics = createIcsCalendar([
    { id: "bad", title: "Bad", courseCode: "CS450", dueAt: "not a date" },
    { id: "good", title: "Good", courseCode: "CS450", dueAt: "2026-07-28T06:59:00.000Z" }
  ]);
  assert.doesNotMatch(ics, /SUMMARY:CS450 - Bad/);
  assert.match(ics, /SUMMARY:CS450 - Good/);
});

test("Calendar keeps invalid numeric assignment dates in Needs a date", () => {
  const items = buildCalendarItems({
    courses: [{
      id: "course-1",
      code: "CS101",
      assignments: [{
        id: "invalid-date",
        title: "Impossible deadline",
        dueDate: "02/31/2026"
      }, {
        id: "leap-date",
        title: "Leap deadline",
        dueDate: "02/29/2024"
      }]
    }]
  });
  const invalid = items.find((item) => item.id === "invalid-date");
  const leap = items.find((item) => item.id === "leap-date");

  assert.equal(invalid.dueAt, "");
  assert.equal(invalid.displayDate, "Needs a date");
  assert.ok(leap.dueAt);
  assert.equal(leap.displayDate, "02/29/2024");
});

test("serializes a portable backup without mutating the workspace", () => {
  const source = workspaceFixture();
  const before = JSON.parse(JSON.stringify(source));
  const backup = serializeWorkspaceBackup(source, new Date("2026-07-22T09:00:00-07:00"));
  const parsed = JSON.parse(backup);
  assert.equal(parsed.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(parsed.metadata.lastBackupAt, "2026-07-22T16:00:00.000Z");
  assert.deepEqual(source, before);
});

test("restores a sparse but valid backup with workspace defaults", () => {
  const restored = parseWorkspaceBackup(JSON.stringify({
    courses: [{ id: "cs450", code: "CS450" }]
  }));
  assert.equal(restored.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(restored.courses[0].id, "cs450");
  assert.equal(restored.preferences.calendarCourseFilter, "all");
  assert.equal(restored.metadata.lastBackupAt, "");
});

test("rejects an explicit future backup schema with upgrade guidance", () => {
  assert.throws(
    () => parseWorkspaceBackup(JSON.stringify({
      schemaVersion: 8,
      courses: []
    })),
    (error) => error.message ===
      "Backup schemaVersion 8 is newer than supported version 7. Update ClassPilot before restoring this backup."
  );
});

test("rejects malformed backup roots and course entries", () => {
  const invalidBackups = [
    "[]",
    JSON.stringify(42),
    JSON.stringify("bad"),
    JSON.stringify({ courses: "bad" }),
    JSON.stringify({ courses: [null] }),
    JSON.stringify({ courses: [[]] }),
    JSON.stringify({ courses: [{ code: "CS450" }] }),
    JSON.stringify({ courses: [{ id: "cs450", name: "AI", assignments: {} }] }),
    JSON.stringify({ courses: [{ id: "cs450", code: "", name: "" }] })
  ];
  invalidBackups.forEach((backup) => {
    assert.throws(() => parseWorkspaceBackup(backup), /valid|course|object|identifier|assignments/i);
  });
});

test("rejects malformed nested backup records with exact actionable errors", () => {
  const valid = {
    courses: [{
      id: "cs450",
      code: "CS450",
      coursePlan: {},
      assignments: [{
        id: "paper",
        title: "Research Paper",
        details: {},
        status: {},
        tasks: [{ id: "read", title: "Read the paper", done: false }]
      }]
    }]
  };
  const cases = [
    [
      { courses: [{ ...valid.courses[0], coursePlan: [] }] },
      "Backup course 1 coursePlan must be an object."
    ],
    [
      { courses: [{ ...valid.courses[0], assignments: [null] }] },
      "Backup course 1 assignment 1 must be an object."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{ id: " ", title: "Research Paper" }]
      }] },
      "Backup course 1 assignment 1 must have a non-empty id."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{ id: "paper", title: " " }]
      }] },
      "Backup course 1 assignment 1 must have a non-empty title."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{ id: "paper", title: "Research Paper", details: [] }]
      }] },
      "Backup course 1 assignment 1 details must be an object."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{ id: "paper", title: "Research Paper", status: [] }]
      }] },
      "Backup course 1 assignment 1 status must be an object or string."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{ id: "paper", title: "Research Paper", tasks: {} }]
      }] },
      "Backup course 1 assignment 1 tasks must be a list."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{ id: "paper", title: "Research Paper", tasks: [null] }]
      }] },
      "Backup course 1 assignment 1 task 1 must be an object."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{
          id: "paper",
          title: "Research Paper",
          tasks: [{ id: "", title: "Read" }]
        }]
      }] },
      "Backup course 1 assignment 1 task 1 must have a non-empty id."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{
          id: "paper",
          title: "Research Paper",
          tasks: [{ id: "read", title: "" }]
        }]
      }] },
      "Backup course 1 assignment 1 task 1 must have a non-empty title."
    ],
    [
      { courses: [{
        ...valid.courses[0],
        assignments: [{
          id: "paper",
          title: "Research Paper",
          tasks: [{ id: "read", title: "Read", done: "yes" }]
        }]
      }] },
      "Backup course 1 assignment 1 task 1 done must be true or false."
    ]
  ];

  for (const [backup, message] of cases) {
    assert.throws(
      () => parseWorkspaceBackup(JSON.stringify(backup)),
      (error) => error.message === message
    );
  }
});

test("deep-validates every runtime-consumed backup record with exact paths", () => {
  const valid = {
    schemaVersion: 7,
    courses: [{
      id: "cs450",
      code: "CS450",
      name: "Technology and Society",
      coursePlan: {
        syllabusUploaded: true,
        professor: "Professor Lin",
        deadlines: [{ label: "Final", date: "Dec 10, 2026" }]
      },
      assignments: [{
        id: "paper",
        title: "Research Paper",
        dueDate: "Jul 25, 2026",
        dueAt: "2026-07-25T07:00:00.000Z",
        estimateMinutes: 120,
        category: "To submit",
        details: {
          overview: "Analyze the paper.",
          requirements: ["Use primary evidence."],
          deliverables: ["Submit a report."],
          steps: [
            "Read the paper.",
            { title: "Draft the analysis.", done: false }
          ],
          requiredReading: ["research article"],
          submissionTypes: ["File upload"],
          successCriteria: ["Use original analysis"],
          rubric: [{
            label: "Analysis",
            weight: "50%",
            description: "Evaluate evidence."
          }],
          coreTasks: [{
            label: "Task 1",
            title: "Analyze evidence",
            weight: "50%",
            requirements: ["Cite the paper"]
          }]
        },
        status: {
          value: "active",
          late: false,
          completed: false,
          score: "0/100"
        },
        source: {
          fileName: "paper.txt",
          sourceType: "Assignment brief",
          importedAt: "2026-07-22T16:00:00.000Z",
          confidence: 90,
          warnings: [],
          evidence: [{
            label: "Assignment",
            value: "Research Paper",
            source: "Imported text"
          }]
        },
        links: ["https://example.edu/paper"],
        warnings: [],
        actionPlan: ["Read the paper."],
        evidence: [{
          label: "Due",
          value: "Jul 25, 2026",
          source: "Due line"
        }],
        tasks: [{
          id: "read",
          title: "Read the paper",
          done: false,
          assignmentId: "paper",
          semanticKey: "read-the-paper-3cf47d",
          semanticOccurrence: 1
        }]
      }]
    }],
    preferences: {
      activeView: "courses",
      activeCourseId: "cs450",
      language: "en",
      calendarCourseFilter: "cs450"
    },
    metadata: {
      updatedAt: "2026-07-22T16:00:00.000Z",
      lastBackupAt: ""
    }
  };
  const cases = [
    [
      (backup) => { backup.preferences = null; },
      "Backup preferences must be an object."
    ],
    [
      (backup) => { backup.preferences.activeView = "dashboard"; },
      "Backup preferences.activeView must be one of today, courses, calendar, or data."
    ],
    [
      (backup) => { backup.metadata.lastBackupAt = null; },
      "Backup metadata.lastBackupAt must be a string."
    ],
    [
      (backup) => {
        backup.courses[0].coursePlan.syllabusUploaded = "yes";
      },
      "Backup course 1 coursePlan.syllabusUploaded must be true or false."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].details.requirements = null;
      },
      "Backup course 1 assignment 1 details.requirements must be a list."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].details.deliverables = [null];
      },
      "Backup course 1 assignment 1 details.deliverables[0] must be a non-empty string."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].details.steps = {};
      },
      "Backup course 1 assignment 1 details.steps must be a list."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].details.steps[1].title = "";
      },
      "Backup course 1 assignment 1 details.steps[1].title must be a non-empty string."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].details.steps[1].done = "yes";
      },
      "Backup course 1 assignment 1 details.steps[1].done must be true or false."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].details.coreTasks[0].requirements = null;
      },
      "Backup course 1 assignment 1 details.coreTasks[0].requirements must be a list."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].status.completed = "yes";
      },
      "Backup course 1 assignment 1 status.completed must be true or false."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].status.score = [];
      },
      "Backup course 1 assignment 1 status.score must be a string or finite number."
    ],
    [
      (backup) => { backup.courses[0].assignments[0].source = null; },
      "Backup course 1 assignment 1 source must be an object."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].source.warnings = [null];
      },
      "Backup course 1 assignment 1 source.warnings[0] must be a non-empty string."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].source.evidence[0].label = "";
      },
      "Backup course 1 assignment 1 source.evidence[0].label must be a non-empty string."
    ],
    [
      (backup) => { backup.courses[0].assignments[0].links = null; },
      "Backup course 1 assignment 1 links must be a list."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].evidence[0].value = null;
      },
      "Backup course 1 assignment 1 evidence[0].value must be a non-empty string."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].estimateMinutes = "120";
      },
      "Backup course 1 assignment 1 estimateMinutes must be a finite number."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].tasks[0].semanticKey = null;
      },
      "Backup course 1 assignment 1 task 1 semanticKey must be a string."
    ],
    [
      (backup) => {
        backup.courses[0].assignments[0].tasks[0].semanticOccurrence = 0;
      },
      "Backup course 1 assignment 1 task 1 semanticOccurrence must be a positive integer."
    ]
  ];

  assert.doesNotThrow(() => parseWorkspaceBackup(JSON.stringify(valid)));
  for (const [mutate, message] of cases) {
    const backup = JSON.parse(JSON.stringify(valid));
    mutate(backup);
    assert.throws(
      () => parseWorkspaceBackup(JSON.stringify(backup)),
      (error) => error.message === message
    );
  }
});

test("rejects malformed coursePlan collections with exact paths", () => {
  const course = {
    id: "cs450",
    code: "CS450",
    coursePlan: {}
  };
  const cases = [
    [
      { deadlines: [null] },
      "Backup course 1 coursePlan.deadlines[0] must be an object."
    ],
    [
      { deadlines: [{ label: "", date: "Dec 10, 2026" }] },
      "Backup course 1 coursePlan.deadlines[0].label must be a non-empty string."
    ],
    [
      { deadlines: [{ label: "Final project", date: 42 }] },
      "Backup course 1 coursePlan.deadlines[0].date must be a non-empty string."
    ],
    [
      { exams: [{ label: "Final exam" }] },
      "Backup course 1 coursePlan.exams[0].date must be a non-empty string."
    ],
    [
      { policies: [{ label: "Late work", text: null }] },
      "Backup course 1 coursePlan.policies[0].text must be a non-empty string."
    ],
    [
      { grading: [{ label: null, weight: "20%" }] },
      "Backup course 1 coursePlan.grading[0].label must be a non-empty string."
    ],
    [
      { weeklyGuide: [{ week: "Week 1", topic: "Intro", activities: [null] }] },
      "Backup course 1 coursePlan.weeklyGuide[0].activities[0] must be a non-empty string."
    ],
    [
      { topics: [""] },
      "Backup course 1 coursePlan.topics[0] must be a non-empty string."
    ],
    [
      { courseRequirements: {} },
      "Backup course 1 coursePlan.courseRequirements must be a list."
    ]
  ];

  for (const [coursePlan, message] of cases) {
    assert.throws(
      () => parseWorkspaceBackup(JSON.stringify({
        courses: [{ ...course, coursePlan }]
      })),
      (error) => error.message === message
    );
  }
});

test("rejects empty and duplicate backup IDs at their required scopes", () => {
  const cases = [
    [
      {
        courses: [
          { id: "cs450", code: "CS450" },
          { id: "cs450", code: "AI451" }
        ]
      },
      'Backup contains duplicate course id "cs450".'
    ],
    [
      {
        courses: [{
          id: "cs450",
          code: "CS450",
          assignments: [
            { id: "paper", title: "Paper" },
            { id: "paper", title: "Paper revision" }
          ]
        }]
      },
      'Backup course 1 contains duplicate assignment id "paper".'
    ],
    [
      {
        courses: [{
          id: "cs450",
          code: "CS450",
          assignments: [{
            id: "paper",
            title: "Paper",
            tasks: [
              { id: "read", title: "Read" },
              { id: "read", title: "Read again" }
            ]
          }]
        }]
      },
      'Backup course 1 assignment 1 contains duplicate task id "read".'
    ]
  ];

  for (const [backup, message] of cases) {
    assert.throws(
      () => parseWorkspaceBackup(JSON.stringify(backup)),
      (error) => error.message === message
    );
  }
});

test("accepts valid backups with older optional normalized fields omitted", () => {
  const parsed = parseWorkspaceBackup(JSON.stringify({
    courses: [{
      id: "cs450",
      code: "CS450",
      assignments: [{
        id: "paper",
        title: "Research Paper",
        tasks: [{ id: "read", title: "Read the paper" }]
      }]
    }]
  }));

  assert.equal(parsed.courses[0].assignments[0].tasks[0].title, "Read the paper");
  assert.equal(parsed.preferences.activeView, "today");
  assert.equal(parsed.metadata.lastBackupAt, "");
});
