const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCoachContext,
  coachThreadKey,
  createThreadStore,
  createCoachClient,
  validateCoachResponse
} = require("../coach.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

const selectedCourse = {
  id: "course-a",
  code: "BIO210",
  name: "Health Futures",
  secretInternalNote: "do not send this",
  coursePlan: {
    term: "Fall 2026",
    professor: "Alex Morgan",
    topics: ["health systems", "AI ethics"],
    grading: [{ label: "Projects", weight: "40%" }],
    policies: [{ label: "AI policy", text: "Cite AI-assisted work." }],
    exams: [{ label: "Final exam", date: "Dec 12, 2026" }],
    weeklyGuide: [{ week: "Week 4", topic: "AI health", assignments: ["Future care play"] }]
  },
  assignments: [
    {
      id: "assignment-a",
      title: "Future care play",
      dueDate: "Sep 18, 2026 3:00pm",
      points: "20 Points Possible",
      status: { state: "active", nextUp: "Submit Assignment" },
      details: {
        overview: "Create a short play set in 2041.",
        requirements: ["Include one ethical dilemma", "Include one possible solution"],
        deliverables: ["Mini play"],
        steps: ["Assign group roles", "Draft the play"],
        rubric: [{ label: "Originality", weight: "35%", description: "Show original judgment." }]
      },
      tasks: [{ id: "task-1", title: "Assign group roles", done: true }]
    }
  ]
};

test("buildCoachContext sends only the selected course and assignment", () => {
  const otherCourse = { id: "course-b", code: "HIST100", name: "Private other course" };
  const context = buildCoachContext(
    { ...selectedCourse, accidentalOtherCourse: otherCourse },
    selectedCourse.assignments[0],
    "bilingual",
    "check"
  );

  assert.equal(context.course.id, "course-a");
  assert.equal(context.assignment.id, "assignment-a");
  assert.equal(context.language, "bilingual");
  assert.equal(context.action, "check");
  assert.deepEqual(context.assignment.completedSteps, ["Assign group roles"]);
  assert.doesNotMatch(JSON.stringify(context), /Private other course|secretInternalNote/);
});

test("buildCoachContext bounds every collection and text field", () => {
  const long = "x".repeat(9000);
  const context = buildCoachContext(
    {
      ...selectedCourse,
      name: long,
      coursePlan: { topics: Array.from({ length: 30 }, (_, index) => `Topic ${index}`) }
    },
    {
      ...selectedCourse.assignments[0],
      details: { requirements: Array.from({ length: 40 }, () => long) }
    },
    "en",
    "chat"
  );

  assert.ok(context.course.name.length <= 500);
  assert.ok(context.course.syllabus.topics.length <= 12);
  assert.ok(context.assignment.requirements.length <= 16);
  assert.ok(context.assignment.requirements.every((item) => item.length <= 1200));
});

test("buildCoachContext includes only bounded sources for the selected assignment", () => {
  const sources = Array.from({ length: 42 }, (_, index) => ({
    id: `assignment:assignment-a:requirement:${index + 1}`,
    kind: "requirement",
    title: `Requirement ${index + 1}`,
    location: `Requirement ${index + 1}`,
    text: index === 0 ? "Include one ethical dilemma" : "x".repeat(2000)
  }));

  const context = buildCoachContext(
    selectedCourse,
    selectedCourse.assignments[0],
    "en",
    "check",
    sources
  );

  assert.equal(context.sources.length, 40);
  assert.deepEqual(context.sources[0], {
    id: "assignment:assignment-a:requirement:1",
    kind: "requirement",
    title: "Requirement 1",
    location: "Requirement 1",
    text: "Include one ethical dilemma"
  });
  assert.ok(context.sources.every((item) => item.text.length <= 1600));
  assert.doesNotMatch(JSON.stringify(context.sources), /Private other course|secretInternalNote/);
});

test("coachThreadKey separates course-level and assignment conversations", () => {
  assert.equal(coachThreadKey("course-a", "assignment-a"), "classpilot.coach.v1:course-a:assignment-a");
  assert.equal(coachThreadKey("course-a", ""), "classpilot.coach.v1:course-a:course");
  assert.notEqual(coachThreadKey("course-a", "assignment-a"), coachThreadKey("course-b", "assignment-a"));
});

test("thread storage stays assignment-scoped and enforces message and character limits", () => {
  const storage = memoryStorage();
  const store = createThreadStore(storage, { maxMessages: 4, maxCharacters: 80 });

  for (let index = 0; index < 6; index += 1) {
    store.append("course-a", "assignment-a", {
      role: index % 2 ? "assistant" : "user",
      text: `message-${index}-${"x".repeat(20)}`
    });
  }
  store.append("course-a", "assignment-b", { role: "user", text: "separate" });

  const first = store.get("course-a", "assignment-a");
  const second = store.get("course-a", "assignment-b");
  assert.ok(first.length <= 4);
  assert.ok(first.reduce((sum, item) => sum + item.text.length, 0) <= 80);
  assert.deepEqual(second.map((item) => item.text), ["separate"]);
  store.clear("course-a", "assignment-a");
  assert.deepEqual(store.get("course-a", "assignment-a"), []);
  assert.equal(store.get("course-a", "assignment-b").length, 1);
});

test("validateCoachResponse accepts the public contract and strips extra data", () => {
  const value = validateCoachResponse({
    answer: "Start by mapping each requirement to one scene.",
    evidence: [{ label: "Requirement", text: "Include one ethical dilemma", secret: "remove" }],
    nextSteps: ["Draft the conflict"],
    missingInformation: [],
    usage: { inputTokens: 120, outputTokens: 40, private: "remove" },
    mode: "live",
    rawOpenAIResponse: { secret: true }
  });

  assert.deepEqual(value, {
    answer: "Start by mapping each requirement to one scene.",
    evidence: [{
      sourceId: "",
      label: "Requirement",
      excerpt: "Include one ethical dilemma",
      location: ""
    }],
    nextSteps: ["Draft the conflict"],
    missingInformation: [],
    usage: { inputTokens: 120, outputTokens: 40 },
    mode: "live"
  });
  assert.throws(() => validateCoachResponse({ answer: "" }), /answer/i);
});

test("validateCoachResponse keeps rich citations and strips extra fields", () => {
  const value = validateCoachResponse({
    answer: "Use the interview evidence.",
    evidence: [{
      sourceId: "assignment:assignment-a:requirement:1",
      label: "Requirement",
      excerpt: "Interview one professional",
      location: "Requirement 1",
      secret: "remove"
    }]
  });

  assert.deepEqual(value.evidence[0], {
    sourceId: "assignment:assignment-a:requirement:1",
    label: "Requirement",
    excerpt: "Interview one professional",
    location: "Requirement 1"
  });
});

test("coach client refuses to fake a request when no endpoint is configured", async () => {
  let called = false;
  const client = createCoachClient({
    endpoint: "",
    fetchImpl: async () => {
      called = true;
    }
  });

  await assert.rejects(
    client.send({ context: buildCoachContext(selectedCourse, selectedCourse.assignments[0]) }),
    (error) => error && error.code === "not_configured"
  );
  assert.equal(called, false);
});

test("coach client posts bounded history and returns a validated response", async () => {
  let request;
  const client = createCoachClient({
    endpoint: "https://coach.example.test/api/coach",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          answer: "Use the rubric as a checklist.",
          evidence: [{ label: "Rubric", text: "Originality 35%" }],
          nextSteps: ["Mark each rubric item"],
          missingInformation: [],
          usage: { inputTokens: 200, outputTokens: 60 },
          mode: "live"
        })
      };
    }
  });

  const response = await client.send({
    context: buildCoachContext(selectedCourse, selectedCourse.assignments[0]),
    messages: Array.from({ length: 20 }, (_, index) => ({ role: "user", text: `Question ${index}` }))
  });

  assert.equal(request.url, "https://coach.example.test/api/coach");
  assert.equal(request.options.method, "POST");
  const body = JSON.parse(request.options.body);
  assert.equal(body.messages.length, 8);
  assert.equal(response.answer, "Use the rubric as a checklist.");
});
