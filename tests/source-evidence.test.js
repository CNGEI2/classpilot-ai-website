const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSourceCatalog,
  findSourceRecord,
  validateSourceCitation
} = require("../source-evidence.js");

test("buildSourceCatalog creates stable records for the selected assignment", () => {
  const course = {
    id: "course-1",
    code: "AI450",
    name: "AI in Modern Society",
    coursePlan: {
      topics: ["AI ethics"],
      policies: [{ label: "Late work", description: "10% per day" }]
    }
  };
  const assignment = {
    id: "assignment-1",
    title: "Satoshi Paper",
    dueDate: "2026-06-22T09:00:00-07:00",
    points: "50 Points Possible",
    details: {
      overview: "Analyze Bitcoin's strategic context.",
      requirements: ["Interview one professional"],
      deliverables: ["Main report", "AI collaboration appendix"],
      rubric: [{
        label: "Strategic insight",
        weight: "35%",
        description: "Go beyond AI output"
      }],
      steps: ["Read the white paper"]
    }
  };

  const catalog = buildSourceCatalog(course, assignment);

  assert.ok(catalog.some((item) => item.id === "assignment:assignment-1:requirement:1"));
  assert.ok(catalog.some((item) => item.id === "assignment:assignment-1:rubric:1"));
  assert.equal(
    findSourceRecord(catalog, "assignment:assignment-1:requirement:1").text,
    "Interview one professional"
  );
  assert.equal(
    findSourceRecord(catalog, "assignment:assignment-1:rubric:1").text,
    "35%: Go beyond AI output"
  );
});

test("buildSourceCatalog limits duplicate and oversized evidence", () => {
  const assignment = {
    id: "assignment-1",
    title: "Bounded assignment",
    details: {
      requirements: ["Use two sources", " use   two sources ", "x".repeat(2400)]
    }
  };

  const catalog = buildSourceCatalog({ id: "course-1" }, assignment);
  const requirements = catalog.filter((item) => item.kind === "requirement");

  assert.equal(requirements.length, 2);
  assert.equal(requirements[0].text, "Use two sources");
  assert.equal(requirements[1].text.length, 1600);
});

test("buildSourceCatalog excludes unrelated assignments", () => {
  const course = {
    id: "course-1",
    assignments: [{
      id: "other-assignment",
      title: "Private other assignment",
      details: { requirements: ["Do not leak this requirement"] }
    }]
  };
  const selected = {
    id: "selected-assignment",
    title: "Selected work",
    details: { requirements: ["Use the selected requirement"] }
  };

  const serialized = JSON.stringify(buildSourceCatalog(course, selected));

  assert.match(serialized, /Use the selected requirement/);
  assert.doesNotMatch(serialized, /Do not leak|Private other assignment/);
});

test("validateSourceCitation rejects invented source IDs", () => {
  const catalog = [{
    id: "source-1",
    kind: "requirement",
    title: "Requirement",
    location: "Requirement 1",
    text: "Use two sources"
  }];

  assert.equal(
    validateSourceCitation({ sourceId: "invented", excerpt: "Use two sources" }, catalog),
    null
  );
  assert.deepEqual(
    validateSourceCitation({ sourceId: "source-1", excerpt: "Use two sources" }, catalog),
    {
      sourceId: "source-1",
      label: "Requirement",
      excerpt: "Use two sources",
      location: "Requirement 1"
    }
  );
});

test("validateSourceCitation bounds text and falls back to trusted source metadata", () => {
  const catalog = [{
    id: "source-1",
    kind: "policy",
    title: "Late work",
    location: "Course policy 1",
    text: "10% per day"
  }];

  assert.deepEqual(validateSourceCitation({
    sourceId: "source-1",
    label: "x".repeat(500),
    excerpt: "x".repeat(2000),
    location: "x".repeat(500)
  }, catalog), {
    sourceId: "source-1",
    label: "x".repeat(160),
    excerpt: "x".repeat(1000),
    location: "x".repeat(240)
  });

  assert.deepEqual(validateSourceCitation({ sourceId: "source-1" }, catalog), {
    sourceId: "source-1",
    label: "Late work",
    excerpt: "10% per day",
    location: "Course policy 1"
  });
});
