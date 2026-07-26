const test = require("node:test");
const assert = require("node:assert/strict");

const WORKER_URL = new URL("../worker/worker.mjs", require("node:url").pathToFileURL(__filename));

class FakeKV {
  constructor() {
    this.values = new Map();
    this.putOptions = new Map();
  }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value, options) {
    this.values.set(key, String(value));
    this.putOptions.set(key, options || {});
  }
  async delete(key) { this.values.delete(key); }
}

async function workerModule() {
  return import(WORKER_URL.href);
}

function capture(overrides = {}) {
  return {
    version: 1,
    capturedAt: "2026-07-25T12:00:00.000Z",
    sourceUrl: "https://sfbu.instructure.com/courses/1742/assignments/30251",
    sourceType: "Canvas assignment page",
    canvasHost: "sfbu.instructure.com",
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
      instructionsText: "Read the Bitcoin white paper and complete a strategic analysis.",
      links: [{ text: "White paper", href: "https://bitcoin.org/bitcoin.pdf" }],
      submissionTypes: ["File Upload"],
      allowedExtensions: ["pdf"],
      rubric: [{ label: "Strategic Insight", description: "Original thinking", points: "35%" }]
    },
    rawText: "Satoshi Paper\nDue: Mon Jun 22, 2026 9:00am",
    ...overrides
  };
}

function env(kv = new FakeKV()) {
  return {
    ALLOWED_ORIGIN: "https://cngei2.github.io",
    IMPORT_HANDOFFS: kv
  };
}

function createRequest(value = capture(), options = {}) {
  return new Request("https://coach.example.workers.dev/api/import-handoffs", {
    method: options.method || "POST",
    headers: {
      Origin: options.origin || "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      "Content-Type": "application/json",
      "X-ClassPilot-Extension-Version": "1.0.0",
      "CF-Connecting-IP": options.ip || "203.0.113.70"
    },
    body: JSON.stringify({ capture: value })
  });
}

function redeemRequest(code, options = {}) {
  return new Request("https://coach.example.workers.dev/api/import-handoffs/redeem", {
    method: "POST",
    headers: {
      Origin: options.origin || "https://cngei2.github.io",
      "Content-Type": "application/json",
      "CF-Connecting-IP": options.ip || "203.0.113.71"
    },
    body: JSON.stringify({ code })
  });
}

test("creates a ten-minute handoff and redeems it exactly once", async () => {
  const { handleImportHandoffRequest } = await workerModule();
  const kv = new FakeKV();
  const created = await handleImportHandoffRequest(createRequest(), env(kv), {
    randomUUID: () => "handoff-12345678",
    now: () => 1000
  });
  const createdValue = await created.json();

  assert.equal(created.status, 201);
  assert.equal(createdValue.code, "handoff-12345678");
  assert.equal(createdValue.expiresAt, new Date(601000).toISOString());
  assert.equal(kv.putOptions.get("import-handoff:handoff-12345678").expirationTtl, 600);
  assert.equal(created.headers.get("Cache-Control"), "no-store");

  const redeemed = await handleImportHandoffRequest(
    redeemRequest("handoff-12345678"),
    env(kv),
    { now: () => 2000 }
  );
  const redeemedValue = await redeemed.json();
  assert.equal(redeemed.status, 200);
  assert.equal(redeemedValue.capture.assignment.title, "Satoshi Paper");
  assert.equal(redeemedValue.capture.assignment.links[0].href, "https://bitcoin.org/bitcoin.pdf");
  assert.equal(await kv.get("import-handoff:handoff-12345678"), null);

  const second = await handleImportHandoffRequest(
    redeemRequest("handoff-12345678"),
    env(kv),
    { now: () => 3000 }
  );
  assert.equal(second.status, 404);
});

test("rejects invalid and oversized captures before writing KV", async () => {
  const { handleImportHandoffRequest } = await workerModule();
  const kv = new FakeKV();
  const invalid = await handleImportHandoffRequest(
    createRequest({ version: 1, canvasHost: "sfbu.instructure.com" }),
    env(kv),
    { randomUUID: () => "invalid-12345678", now: () => 1000 }
  );
  assert.equal(invalid.status, 400);
  assert.equal(kv.values.size, 0);

  const oversized = await handleImportHandoffRequest(
    createRequest(capture({ rawText: "x".repeat(100001) }), { ip: "203.0.113.72" }),
    env(kv),
    { randomUUID: () => "large-12345678", now: () => 1000 }
  );
  assert.equal(oversized.status, 413);
  assert.equal(kv.values.size, 0);
});

test("reports missing storage and deletes expired captures", async () => {
  const { handleImportHandoffRequest } = await workerModule();
  const unavailable = await handleImportHandoffRequest(
    createRequest(capture(), { ip: "203.0.113.73" }),
    { ALLOWED_ORIGIN: "https://cngei2.github.io" },
    { randomUUID: () => "missing-12345678", now: () => 1000 }
  );
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "import_not_configured");

  const kv = new FakeKV();
  await kv.put("import-handoff:expired-12345678", JSON.stringify({
    capture: capture(),
    createdAt: 1000
  }));
  const expired = await handleImportHandoffRequest(
    redeemRequest("expired-12345678", { ip: "203.0.113.74" }),
    env(kv),
    { now: () => 602001 }
  );
  assert.equal(expired.status, 410);
  assert.equal(await kv.get("import-handoff:expired-12345678"), null);
});

test("allows extension creation and only the ClassPilot site to redeem", async () => {
  const { handleImportHandoffRequest } = await workerModule();
  const kv = new FakeKV();
  const created = await handleImportHandoffRequest(
    createRequest(capture(), { ip: "203.0.113.75" }),
    env(kv),
    { randomUUID: () => "origin-12345678", now: () => 1000 }
  );
  assert.equal(created.status, 201);
  assert.match(created.headers.get("Access-Control-Allow-Origin"), /^chrome-extension:\/\//);

  const forbidden = await handleImportHandoffRequest(
    redeemRequest("origin-12345678", {
      origin: "https://malicious.example",
      ip: "203.0.113.76"
    }),
    env(kv),
    { now: () => 2000 }
  );
  assert.equal(forbidden.status, 403);
  assert.ok(await kv.get("import-handoff:origin-12345678"));
});
