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
      sources: [
        {
          id: "assignment:future-care:requirement:1",
          kind: "requirement",
          title: "Requirement",
          location: "Requirement 1",
          text: "Include one ethical dilemma"
        },
        {
          id: "assignment:future-care:requirement:2",
          kind: "requirement",
          title: "Requirement",
          location: "Requirement 2",
          text: "Include one possible solution"
        },
        {
          id: "assignment:future-care:rubric:1",
          kind: "rubric",
          title: "Originality",
          location: "Rubric criterion 1",
          text: "35%: Show original judgment."
        }
      ],
      language: "en",
      action: "explain"
    },
    messages: [{ role: "user", text: "What do I need to do?" }],
    coachState: {
      phase: "understand",
      currentStepId: "identify-requirement",
      waitingForStudent: true,
      secret: "remove"
    },
    ...overrides
  };
}

function coachResponse(overrides = {}) {
  return {
    answer: "Choose the requirement that is least clear.",
    phase: "understand",
    currentStep: {
      id: "identify-requirement",
      title: "Identify one unclear requirement",
      instruction: "Choose the requirement you understand least.",
      doneWhen: "You can name it and explain what is unclear.",
      estimatedMinutes: 5
    },
    checkpointQuestion: "Which requirement is least clear?",
    waitingForStudent: true,
    evidence: [],
    missingInformation: [],
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
  assert.ok(value.evidence.some((item) => /ethical dilemma/i.test(item.excerpt)));
  assert.equal(value.phase, "understand");
  assert.match(value.currentStep.instruction, /Draft the play/i);
  assert.equal(value.waitingForStudent, true);
  assert.equal("nextSteps" in value, false);
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

test("Workers AI mode sends a bounded multi-turn chat and normalizes its response", async () => {
  const { handleCoachRequest } = await workerModule();
  let invocation;
  const response = await handleCoachRequest(
    request(),
    {
      ...baseEnv,
      COACH_MODE: "workers_ai",
      WORKERS_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
      AI: {
        async run(model, options) {
          invocation = { model, options };
          return {
            choices: [{
              message: {
                content: JSON.stringify(coachResponse({
                  answer: "Start by outlining one scene for each requirement.",
                  evidence: [{
                    sourceId: "assignment:future-care:requirement:1",
                    label: "Requirement",
                    excerpt: "Include one ethical dilemma",
                    location: "Requirement 1"
                  }],
                  phase: "outline",
                  currentStep: {
                    id: "outline-dilemma",
                    title: "Outline the dilemma scene",
                    instruction: "Write one sentence describing the scene's ethical conflict.",
                    doneWhen: "The sentence names the conflict and who faces it.",
                    estimatedMinutes: 10
                  },
                  checkpointQuestion: "Who faces the conflict in your scene?"
                }))
              }
            }],
            usage: { prompt_tokens: 245, completion_tokens: 76 }
          };
        }
      }
    }
  );
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.equal(value.mode, "live");
  assert.deepEqual(value.usage, { inputTokens: 245, outputTokens: 76 });
  assert.equal(invocation.model, "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.equal(invocation.options.response_format.type, "json_object");
  assert.equal(invocation.options.messages.at(-1).role, "user");
  assert.match(invocation.options.messages.at(-1).content, /What do I need to do/);
  assert.match(invocation.options.messages[1].content, /"phase":"understand"/);
  assert.doesNotMatch(invocation.options.messages[1].content, /secret/);
  assert.match(invocation.options.messages[0].content, /exactly one/i);
  assert.match(invocation.options.messages[0].content, /wait for the student/i);
  assert.match(invocation.options.messages[0].content, /stuck/i);
  assert.match(invocation.options.messages[0].content, /complete assessed submission/i);
  assert.match(invocation.options.messages[0].content, /untrusted reference data/i);
  assert.doesNotMatch(JSON.stringify(invocation.options), /Private other course|secretInternalNote/);
});

test("Workers AI mode reports a stable configuration error without its binding", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(request(), {
    ...baseEnv,
    COACH_MODE: "workers_ai",
    WORKERS_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast"
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "not_configured",
    message: "The conversational AI Coach is not configured yet."
  });
});

test("Workers AI mode falls back to trusted assignment evidence when the model omits citations", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(request(), {
    ...baseEnv,
    COACH_MODE: "workers_ai",
    AI: {
      async run(model, options) {
        assert.equal(model, "@cf/meta/llama-3.1-8b-instruct-fast");
        assert.equal(options.chat_template_kwargs, undefined);
        return {
          choices: [{ message: { content: JSON.stringify(coachResponse({
            answer: "Start by mapping the dilemma requirement to a scene.",
            evidence: [],
            currentStep: {
              id: "outline-dilemma",
              title: "Outline the dilemma scene",
              instruction: "Write one sentence describing the ethical conflict.",
              doneWhen: "The conflict and stakeholder are named.",
              estimatedMinutes: 10
            }
          })) } }],
          usage: { prompt_tokens: 90, completion_tokens: 30 }
        };
      }
    }
  });
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    value.evidence.map((item) => item.sourceId),
    [
      "assignment:future-care:requirement:1",
      "assignment:future-care:requirement:2"
    ]
  );
  assert.doesNotMatch(value.missingInformation.join(" "), /citation/i);
});

test("Workers AI mode safely accepts a plain conversational answer when JSON formatting drifts", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(request(), {
    ...baseEnv,
    COACH_MODE: "workers_ai",
    AI: {
      async run() {
        return {
          choices: [{ message: { content: "Start with the ethical dilemma, then connect it to a possible solution." } }],
          usage: { prompt_tokens: 70, completion_tokens: 22 }
        };
      }
    }
  });
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.equal(value.mode, "live");
  assert.match(value.answer, /ethical dilemma/i);
  assert.equal(value.evidence[0].sourceId, "assignment:future-care:requirement:1");
  assert.equal(value.phase, "diagnose");
  assert.equal(value.currentStep, null);
  assert.equal(value.waitingForStudent, true);
});

test("Workers AI mode keeps exactly one sanitized current step", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(request(), {
    ...baseEnv,
    COACH_MODE: "workers_ai",
    AI: {
      async run() {
        return {
          choices: [{ message: { content: JSON.stringify(coachResponse({
            answer: "Start with one interview preparation action.",
            phase: "research",
            evidence: [],
            currentStep: {
              id: "prepare-questions",
              title: "Prepare interview questions",
              instruction: "Write three questions for one stakeholder interview.",
              doneWhen: "You have three open-ended questions.",
              estimatedMinutes: 15,
              extraSteps: ["Schedule interviews", "Collect notes"]
            },
            checkpointQuestion: "Which stakeholder will you interview?",
            missingInformation: [{ label: "Interview availability", text: "Confirm participant times" }]
          })) } }],
          usage: { prompt_tokens: 80, completion_tokens: 32 }
        };
      }
    }
  });
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(value.currentStep, {
    id: "prepare-questions",
    title: "Prepare interview questions",
    instruction: "Write three questions for one stakeholder interview.",
    doneWhen: "You have three open-ended questions.",
    estimatedMinutes: 15
  });
  assert.equal("extraSteps" in value.currentStep, false);
  assert.equal("nextSteps" in value, false);
  assert.deepEqual(value.missingInformation, [
    "Interview availability: Confirm participant times"
  ]);
  assert.doesNotMatch(JSON.stringify(value), /\[object Object\]/);
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
              text: JSON.stringify(coachResponse({
                answer: "Map each requirement to one scene before drafting.",
                evidence: [{
                  sourceId: "assignment:future-care:requirement:1",
                  label: "Requirement",
                  excerpt: "Include one ethical dilemma",
                  location: "Requirement 1"
                }],
                phase: "outline",
                currentStep: {
                  id: "draft-conflict",
                  title: "Draft the conflict scene",
                  instruction: "Write the opening exchange that reveals the ethical conflict.",
                  doneWhen: "The exchange makes the conflict understandable.",
                  estimatedMinutes: 15
                },
                checkpointQuestion: "What decision must the character make?"
              }))
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
  assert.equal(sent.text.format.schema.properties.currentStep.type[0], "object");
  assert.equal(sent.text.format.schema.properties.currentStep.type[1], "null");
  assert.equal(sent.text.format.schema.properties.nextSteps, undefined);
  assert.match(sent.instructions, /exactly one/i);
  assert.doesNotMatch(upstream.options.body, /secretInternalNote|Private other course/);
});

test("worker strips invented citations and preserves valid source references", async () => {
  const { handleCoachRequest } = await workerModule();
  const response = await handleCoachRequest(
    request(),
    {
      ...baseEnv,
      COACH_MODE: "live",
      OPENAI_API_KEY: "test-key-not-real"
    },
    {
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify(coachResponse({
              answer: "The ethical dilemma is required.",
              phase: "understand",
              currentStep: null,
              checkpointQuestion: "How will your scene show this dilemma?",
              evidence: [
                {
                  sourceId: "invented",
                  label: "Wrong",
                  excerpt: "Made up",
                  location: "Unknown"
                },
                {
                  sourceId: "assignment:future-care:requirement:1",
                  label: "Requirement",
                  excerpt: "Include one ethical dilemma",
                  location: "Requirement 1"
                }
              ]
            }))
          }]
        }],
        usage: { input_tokens: 100, output_tokens: 40 }
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    }
  );
  const value = await response.json();

  assert.deepEqual(
    value.evidence.map((item) => item.sourceId),
    ["assignment:future-care:requirement:1"]
  );
  assert.equal(value.evidence[0].excerpt, "Include one ethical dilemma");
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
