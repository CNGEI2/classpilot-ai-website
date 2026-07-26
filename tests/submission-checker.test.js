const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeSubmission } = require("../submission-checker.js");

function assignmentFixture() {
  return {
    id: "satoshi-paper",
    title: "Satoshi Paper",
    points: "50 Points Possible",
    details: {
      requirements: [
        "Submit the main report as a 4-5 page PDF.",
        "Interview one professional in finance or technology.",
        "Include citations and a bibliography."
      ],
      deliverables: ["Main Report", "AI Collaboration Appendix"],
      rubric: [
        { label: "Strategic Insight Beyond AI", weight: "35%", description: "Add original strategic judgment." },
        { label: "Primary Research", weight: "25%", description: "Integrate interview evidence." },
        { label: "Critical Evaluation", weight: "40%", description: "Evaluate and challenge AI output." }
      ]
    }
  };
}

function longSubmission() {
  const body = Array.from({ length: 45 }, (_, index) =>
    `The analysis compares Bitcoin strategy with market evidence number ${index}. ` +
    `This paragraph explains original judgment, evaluates AI output, and challenges its assumptions.`
  ).join(" ");
  return [
    "Main Report",
    body,
    "Interview Evidence",
    "A finance professional explained that trust and timing affected adoption.",
    "AI Collaboration Appendix",
    "The AI summary was checked against primary research and revised.",
    "Bibliography",
    "Nakamoto, S. (2008). Bitcoin: A Peer-to-Peer Electronic Cash System."
  ].join("\n\n");
}

test("analyzeSubmission runs objective file and deliverable checks", () => {
  const report = analyzeSubmission(assignmentFixture(), {
    fileName: "satoshi-paper.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 32000,
    text: longSubmission(),
    pageCount: 3,
    slideCount: 0
  }, { now: "2026-07-25T20:00:00.000Z" });

  assert.equal(report.version, 1);
  assert.equal(report.checkedAt, "2026-07-25T20:00:00.000Z");
  assert.equal(report.file.wordCount > 300, true);
  assert.equal(report.checks.find((check) => check.id === "file-type").status, "fail");
  assert.equal(report.checks.find((check) => check.id === "page-range").status, "fail");
  assert.equal(report.checks.find((check) => check.id === "deliverable-1").status, "pass");
  assert.equal(report.checks.find((check) => check.id === "deliverable-2").status, "pass");
  assert.equal(report.checks.find((check) => check.id === "bibliography").status, "pass");
  assert.equal(Object.hasOwn(report, "text"), false);
  assert.equal(JSON.stringify(report).includes(bodySentinel()), false);
});

test("analyzeSubmission maps rubric criteria to evidence and a conservative score range", () => {
  const report = analyzeSubmission(assignmentFixture(), {
    fileName: "satoshi-paper.pdf",
    mimeType: "application/pdf",
    size: 55000,
    text: longSubmission(),
    pageCount: 5,
    slideCount: 0
  });

  assert.equal(report.rubric.length, 3);
  assert.ok(report.rubric.every((criterion) => ["found", "partial", "missing"].includes(criterion.status)));
  assert.ok(report.rubric.some((criterion) => /Interview Evidence/i.test(criterion.evidence)));
  assert.match(report.scoreEstimate.label, /ClassPilot estimate/);
  assert.ok(report.scoreEstimate.min >= 0);
  assert.ok(report.scoreEstimate.max <= 100);
  assert.ok(report.scoreEstimate.min <= report.scoreEstimate.max);
  assert.ok(["low", "medium", "high"].includes(report.scoreEstimate.confidence));
});

test("AI-writing risk is unavailable for short text", () => {
  const report = analyzeSubmission(assignmentFixture(), {
    fileName: "notes.pdf",
    mimeType: "application/pdf",
    size: 1000,
    text: "Main Report\nShort personal notes.",
    pageCount: 1,
    slideCount: 0
  });

  assert.equal(report.aiRisk.status, "unavailable");
  assert.equal(report.aiRisk.score, null);
  assert.equal(report.aiRisk.confidence, "low");
  assert.match(report.aiRisk.message, /not enough long-form prose/i);
});

test("AI-writing risk above 20 creates a non-blocking review reminder", () => {
  const repeated = Array.from({ length: 55 }, () =>
    "Furthermore, this analysis demonstrates a significant and comprehensive strategic perspective."
  ).join(" ");
  const report = analyzeSubmission(assignmentFixture(), {
    fileName: "draft.pdf",
    mimeType: "application/pdf",
    size: 20000,
    text: `Main Report\n${repeated}`,
    pageCount: 4,
    slideCount: 0
  });

  assert.ok(report.aiRisk.score > 20);
  assert.equal(report.aiRisk.status, "review");
  assert.equal(report.aiRisk.blocking, false);
  assert.match(report.aiRisk.message, /not proof of AI use/i);
  assert.ok(report.aiRisk.reasons.length > 0);
});

function bodySentinel() {
  return "market evidence number 44";
}
