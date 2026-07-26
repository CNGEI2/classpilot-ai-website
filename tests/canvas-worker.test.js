const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const WORKER_URL = pathToFileURL(path.join(__dirname, "..", "worker", "worker.mjs"));

class FakeKV {
  constructor() {
    this.values = new Map();
  }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
}

async function workerModule() {
  return import(WORKER_URL.href);
}

function env(kv = new FakeKV()) {
  return {
    ALLOWED_ORIGIN: "https://cngei2.github.io",
    CANVAS_ALLOWED_DOMAINS: "sfbu.instructure.com",
    CANVAS_CLIENT_ID: "client-123",
    CANVAS_CLIENT_SECRET: "secret-not-real",
    CANVAS_SESSIONS: kv
  };
}

function canvasRequest(pathname, options = {}) {
  return new Request("https://coach.example.workers.dev" + pathname, {
    method: options.method || "GET",
    headers: {
      Origin: "https://cngei2.github.io",
      ...(options.session ? { Authorization: "Bearer " + options.session } : {})
    }
  });
}

test("Canvas connect creates a bounded OAuth authorization request", async () => {
  const { handleCanvasRequest } = await workerModule();
  const kv = new FakeKV();
  const response = await handleCanvasRequest(
    canvasRequest("/api/canvas/connect?domain=sfbu.instructure.com"),
    env(kv),
    { randomUUID: () => "state-123" }
  );
  const value = await response.json();
  const authorize = new URL(value.authorizeUrl);

  assert.equal(response.status, 200);
  assert.equal(authorize.origin, "https://sfbu.instructure.com");
  assert.equal(authorize.pathname, "/login/oauth2/auth");
  assert.equal(authorize.searchParams.get("client_id"), "client-123");
  assert.equal(authorize.searchParams.get("state"), "state-123");
  assert.ok(await kv.get("canvas-state:state-123"));

  const blocked = await handleCanvasRequest(
    canvasRequest("/api/canvas/connect?domain=evil.example"),
    env(kv)
  );
  assert.equal(blocked.status, 400);
});

test("Canvas callback exchanges the code and returns the session only by postMessage", async () => {
  const { handleCanvasRequest } = await workerModule();
  const kv = new FakeKV();
  await kv.put("canvas-state:state-123", JSON.stringify({
    domain: "sfbu.instructure.com",
    origin: "https://cngei2.github.io",
    createdAt: Date.now()
  }));
  let tokenRequest;
  const response = await handleCanvasRequest(
    new Request("https://coach.example.workers.dev/api/canvas/callback?state=state-123&code=code-456"),
    env(kv),
    {
      randomUUID: () => "session-789",
      fetchImpl: async (url, options) => {
        tokenRequest = { url, options };
        return new Response(JSON.stringify({
          access_token: "canvas-access-token",
          refresh_token: "canvas-refresh-token",
          expires_in: 3600
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(tokenRequest.url, "https://sfbu.instructure.com/login/oauth2/token");
  assert.equal(tokenRequest.options.method, "POST");
  assert.match(html, /canvas-session/);
  assert.match(html, /session-789/);
  assert.doesNotMatch(html, /canvas-access-token|canvas-refresh-token/);
  assert.ok(await kv.get("canvas-session:session-789"));
  assert.equal(await kv.get("canvas-state:state-123"), null);
});

test("Canvas snapshot proxies only fixed read endpoints", async () => {
  const { handleCanvasRequest } = await workerModule();
  const kv = new FakeKV();
  await kv.put("canvas-session:session-789", JSON.stringify({
    domain: "sfbu.instructure.com",
    accessToken: "canvas-access-token",
    refreshToken: "canvas-refresh-token",
    expiresAt: Date.now() + 3600000
  }));
  const calls = [];
  const response = await handleCanvasRequest(
    canvasRequest("/api/canvas/snapshot", { session: "session-789" }),
    env(kv),
    {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        const pathname = new URL(url).pathname;
        if (pathname === "/api/v1/courses") {
          return Response.json([{ id: 1742, course_code: "AI450-A", name: "AI in Society" }]);
        }
        if (pathname === "/api/v1/courses/1742") {
          return Response.json({ id: 1742, syllabus_body: "<p>Course syllabus</p>", term: { name: "Summer 2026" } });
        }
        return Response.json([{ id: 30244, name: "Satoshi Paper", due_at: "2026-07-14T22:00:00Z" }]);
      }
    }
  );
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.equal(value.domain, "sfbu.instructure.com");
  assert.equal(value.courses[0].assignments[0].name, "Satoshi Paper");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.options.method === "GET"));
  assert.ok(calls.every((call) => call.options.headers.Authorization === "Bearer canvas-access-token"));
});
