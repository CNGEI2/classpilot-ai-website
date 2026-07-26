const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const WORKER_URL = pathToFileURL(path.join(__dirname, "..", "worker", "worker.mjs"));

async function workerModule() {
  return import(WORKER_URL.href);
}

function request(feedUrl, options = {}) {
  return new Request("https://coach.example.workers.dev/api/calendar-feed", {
    method: options.method || "POST",
    headers: {
      Origin: options.origin || "https://cngei2.github.io",
      "Content-Type": "application/json",
      "CF-Connecting-IP": options.ip || "203.0.113.80"
    },
    body: options.method === "OPTIONS" ? undefined : JSON.stringify({ feedUrl })
  });
}

function env() {
  return {
    ALLOWED_ORIGIN: "https://cngei2.github.io",
    CANVAS_ALLOWED_DOMAINS: "sfbu.instructure.com"
  };
}

test("fetches an allowed Canvas calendar without forwarding credentials", async () => {
  const { handleCalendarFeedRequest } = await workerModule();
  const calls = [];
  const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
  const response = await handleCalendarFeedRequest(
    request("https://sfbu.instructure.com/feeds/calendars/user_secret.ics"),
    env(),
    {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(ics, {
          status: 200,
          headers: { "Content-Type": "text/calendar", "Content-Length": String(ics.length) }
        });
      }
    }
  );
  const value = await response.json();

  assert.equal(response.status, 200);
  assert.equal(value.ics, ics);
  assert.equal(value.domain, "sfbu.instructure.com");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.Accept, "text/calendar, text/plain;q=0.9");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("rejects non-Canvas URLs, redirects, and oversized feeds", async () => {
  const { handleCalendarFeedRequest } = await workerModule();
  let fetches = 0;
  const runtime = {
    fetchImpl: async () => {
      fetches += 1;
      return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1" } });
    }
  };
  const blocked = await handleCalendarFeedRequest(
    request("https://evil.example/feeds/calendars/user_secret.ics"),
    env(),
    runtime
  );
  assert.equal(blocked.status, 400);
  assert.equal(fetches, 0);

  const redirected = await handleCalendarFeedRequest(
    request("https://sfbu.instructure.com/feeds/calendars/user_secret.ics", { ip: "203.0.113.81" }),
    env(),
    runtime
  );
  assert.equal(redirected.status, 502);

  const oversized = await handleCalendarFeedRequest(
    request("https://sfbu.instructure.com/feeds/calendars/user_secret.ics", { ip: "203.0.113.82" }),
    env(),
    {
      fetchImpl: async () => new Response("BEGIN:VCALENDAR", {
        headers: { "Content-Length": "1100000" }
      })
    }
  );
  assert.equal(oversized.status, 413);
});

test("requires the ClassPilot origin and POST", async () => {
  const { handleCalendarFeedRequest } = await workerModule();
  const forbidden = await handleCalendarFeedRequest(
    request("https://sfbu.instructure.com/feeds/calendars/user_secret.ics", {
      origin: "https://malicious.example"
    }),
    env()
  );
  assert.equal(forbidden.status, 403);

  const preflight = await handleCalendarFeedRequest(
    request("", { method: "OPTIONS" }),
    env()
  );
  assert.equal(preflight.status, 204);
});
