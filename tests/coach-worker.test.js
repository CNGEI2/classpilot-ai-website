const test = require("node:test");
const assert = require("node:assert/strict");

const WORKER_URL = new URL("../worker/worker.mjs", require("node:url").pathToFileURL(__filename));

async function workerModule() {
  return import(WORKER_URL.href);
}

function validBody(overrides = {}) {
  return {
    context: {
      course: {
        id: "bio210",
        code: "BIO210",
        name: "Health Futures",
        syllabus: { topics: ["AI ethics"] }
      },
      assignment: {
        id: "future-care",
        title: "Future care play",
        dueDate: "Sep 18, 2026 3:00pm",
        points: "20 Points Possible",
        requirements: ["Include one ethical dilemma", "Include one possible solution"],
        deliverables: ["Mini play"],
        rubric: [{ label: "Originality", weight: "35%", description: "Show original judgment." }],
        steps: ["Assign group roles", "Draft the play"],
        completedSteps: ["Assign group roles"],
        remainingSteps: ["Draft the play"]
      },
      language: "en",
      action: "explain"
    },
    messages: [{ role: "user", text: "What do I need to do?" }],
    ...overrides
  };
}

function request(body = validBody(), options = {}) {
  return new Request("https://coach.example.workers.dev/api/coach", {
    method: options.method || "POST",
    headers: {
      Origin: options.origin || "https://cngei2.github.io",
      "Content-Type": "application/json",
      "CF-Connecting-IP": options.ip || "203.0.113.10",
      ...(options.headers || {})
    },
    body: options.method === "GET" || options.method === "OPTIONS"
      ? undefined
      : typeof body === "string" ? body : JSON.stringify(body)
  });
}

const baseEnv = {
  ALLOWED_ORIGIN: "https://cngei2.github.io",
  COACH_MODE: "mock",
  OPENAI_MODEL: "gpt-5-mini"
};

test("worker exposes only the Coach route and exact allowed origin", async () => {
  const { handleCoachRequest } = await workerModule();
  const wrongPath = await handleCoachRequest(
    new Request("https://coach.example.workers.dev/other", {
      method: "POST",
      headers: { Origin: "https://cngei2.github.io" }
    }),
    baseEnv
  );
  assert.equal(wrongPath.status, 404);

  const forbidden = await handleCoachRequest(
    request(validBody(), { origin: "https://malicious.example" }),
    baseEnv
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("Access-Control-Allow-Origin"), null);
});

test("worker handles a valid CORS preflight without running the model", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(
    request(null, { method: "OPTIONS" }),
    baseEnv
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://cngei2.github.io");
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("worker rejects unsupported methods and oversized requests", async () => {
  const { handleCoachRequest } = await workerModule();
  const getResponse = await handleCoachRequest(request(null, { method: "GET" }), baseEnv);
  assert.equal(getResponse.status, 405);

  const oversized = await handleCoachRequest(
    request(JSON.stringify({ value: "x".repeat(66000) })),
    baseEnv
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "payload_too_large");
});

test("mock mode returns labeled assignment-aware guidance and evidence", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(request(), baseEnv);
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.equal(value.mode, "mock");
  assert.match(value.answer, /Future care play/);
  assert.ok(value.evidence.some((item) => /ethical dilemma/i.test(item.text)));
  assert.ok(value.nextSteps.some((item) => /Draft the play/i.test(item)));
  assert.deepEqual(value.usage, { inputTokens: 0, outputTokens: 0 });
});

test("live mode without a key returns a stable configuration error", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(request(), {
    ...baseEnv,
    COACH_MODE: "live",
    OPENAI_API_KEY: ""
  });
  const value = await response.json();
  assert.equal(response.status, 503);
  assert.deepEqual(value, {
    code: "not_configured",
    message: "The live AI Coach is not configured yet."
  });
});

test("live mode sends a hardened structured request and normalizes usage", async () => {
  const { handleCoachRequest } = await workerModule();
  let upstream;
  const response = await handleCoachRequest(
    request(),
    {
      ...baseEnv,
      COACH_MODE: "live",
      OPENAI_API_KEY: "test-key-not-real"
    },
    {
      fetchImpl: async (url, options) => {
        upstream = { url, options };
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify({
                answer: "Map each requirement to one scene before drafting.",
                evidence: [{ label: "Requirement", text: "Include one ethical dilemma" }],
                nextSteps: ["Draft the conflict scene"],
                missingInformation: []
              })
            }]
          }],
          usage: { input_tokens: 321, output_tokens: 87 }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
  );
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.equal(value.mode, "live");
  assert.deepEqual(value.usage, { inputTokens: 321, outputTokens: 87 });
  assert.equal(upstream.url, "https://api.openai.com/v1/responses");
  assert.equal(upstream.options.headers.Authorization, "Bearer test-key-not-real");
  const sent = JSON.parse(upstream.options.body);
  assert.equal(sent.store, false);
  assert.equal(sent.model, "gpt-5-mini");
  assert.equal(sent.reasoning.effort, "low");
  assert.equal(sent.text.format.type, "json_schema");
  assert.doesNotMatch(upstream.options.body, /secretInternalNote|Private other course/);
});

test("upstream failures never disclose keys, bodies, or stack traces", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(
    request(),
    {
      ...baseEnv,
      COACH_MODE: "live",
      OPENAI_API_KEY: "sensitive-test-key"
    },
    {
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: "Upstream mentions sensitive-test-key" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    }
  );
  const text = await response.text();
  assert.equal(response.status, 502);
  assert.match(text, /upstream_error/);
  assert.doesNotMatch(text, /sensitive-test-key|Upstream mentions|stack/i);
});
