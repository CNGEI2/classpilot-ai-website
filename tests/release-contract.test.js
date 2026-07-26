const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "pages.yml"),
  "utf8"
);
const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const workerReadmePath = path.join(__dirname, "..", "worker", "README.md");
const frontendRuntime = [
  "index.html",
  "app.js",
  "logic.js",
  "planner.js",
  "study-scheduler.js",
  "file-readers.js",
  "source-evidence.js",
  "submission-checker.js",
  "canvas-connector.js",
  "coach.js"
]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n");

function jobSection(name, nextName) {
  const start = workflow.indexOf("  " + name + ":");
  const end = nextName ? workflow.indexOf("  " + nextName + ":", start) : workflow.length;
  assert.ok(start >= 0, "missing " + name + " job");
  assert.ok(end > start, "missing end of " + name + " job");
  return workflow.slice(start, end);
}

test("Pages workflow uses least privilege and packages the verified runtime", () => {
  const globalPermissions = workflow.slice(
    workflow.indexOf("permissions:"),
    workflow.indexOf("concurrency:")
  );
  const testJob = jobSection("test", "deploy");
  const deployJob = jobSection("deploy");

  assert.match(globalPermissions, /^permissions:\n  contents: read\n$/m);
  assert.doesNotMatch(globalPermissions, /(?:pages|id-token): write/);
  assert.doesNotMatch(testJob, /(?:pages|id-token): write/);
  assert.match(
    deployJob,
    /permissions:\n      contents: read\n      pages: write\n      id-token: write/
  );
  assert.match(testJob, /run: npm ci/);
  assert.match(testJob, /run: npm run verify/);
  assert.match(deployJob, /rm -rf site-dist/);
  assert.match(
    deployJob,
    /cp index\.html app\.js logic\.js planner\.js study-scheduler\.js file-readers\.js source-evidence\.js submission-checker\.js canvas-connector\.js coach\.js styles\.css \.nojekyll site-dist\//
  );
  assert.match(deployJob, /cp -R vendor site-dist\/vendor/);
});

test("release documentation explains the secure Coach boundary", () => {
  assert.equal(fs.existsSync(workerReadmePath), true);
  const workerReadme = fs.readFileSync(workerReadmePath, "utf8");
  assert.match(readme, /conversational AI Coach/i);
  assert.match(readme, /selected course and assignment context/i);
  assert.match(readme, /Cloudflare Worker/i);
  assert.match(workerReadme, /wrangler secret put OPENAI_API_KEY/);
  assert.match(workerReadme, /COACH_MODE.*mock/s);
  assert.match(workerReadme, /COACH_MODE.*live/s);
  assert.match(workerReadme, /COACH_MODE.*workers_ai/s);
  assert.match(workerReadme, /WORKERS_AI_MODEL/);
  assert.match(workerReadme, /\[ai\][\s\S]*binding\s*=\s*"AI"/);
  assert.match(workerReadme, /ALLOWED_ORIGIN/);
  assert.match(readme, /Cloudflare Workers AI/);
  assert.match(readme, /Today.*focus.*automatic.*study/s);
  assert.match(readme, /Final check.*Canvas/s);
  assert.doesNotMatch(frontendRuntime, /OPENAI_API_KEY/);
});
