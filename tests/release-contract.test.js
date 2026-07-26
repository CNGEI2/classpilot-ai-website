const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("jszip");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "pages.yml"),
  "utf8"
);
const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const workerReadmePath = path.join(__dirname, "..", "worker", "README.md");
const wrangler = fs.readFileSync(
  path.join(__dirname, "..", "worker", "wrangler.toml"),
  "utf8"
);
const wranglerExample = fs.readFileSync(
  path.join(__dirname, "..", "worker", "wrangler.toml.example"),
  "utf8"
);
const workerSource = fs.readFileSync(
  path.join(__dirname, "..", "worker", "worker.mjs"),
  "utf8"
);
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
  "canvas-calendar.js",
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
    /cp index\.html app\.js logic\.js planner\.js study-scheduler\.js file-readers\.js source-evidence\.js submission-checker\.js canvas-connector\.js canvas-calendar\.js coach\.js styles\.css \.nojekyll site-dist\//
  );
  assert.match(deployJob, /cp -R vendor site-dist\/vendor/);
});

test("Pages publishes the Canvas calendar parser with the app", () => {
  assert.match(workflow, /canvas-calendar\.js/);
  assert.match(readme, /Canvas calendar feed/i);
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

test("release config and documentation describe adaptive one-step coaching", () => {
  const workerReadme = fs.readFileSync(workerReadmePath, "utf8");
  const model = /WORKERS_AI_MODEL\s*=\s*"@cf\/qwen\/qwen3-30b-a3b-fp8"/;

  assert.match(wrangler, model);
  assert.match(wranglerExample, model);
  assert.match(workerSource, /@cf\/qwen\/qwen3-30b-a3b-fp8/);
  assert.match(wranglerExample, /\[ai\][\s\S]*binding\s*=\s*"AI"/);
  assert.match(readme, /one small step/i);
  assert.match(readme, /Done, continue/);
  assert.match(readme, /I'm stuck/);
  assert.match(readme, /Check my idea/);
  assert.match(workerReadme, /currentStep/);
  assert.match(workerReadme, /checkpointQuestion/);
  assert.match(workerReadme, /waits for the student/i);
  assert.doesNotMatch(readme, /guaranteed grade|completes? the assignment for you/i);
});

test("release includes a documented and downloadable Canvas Companion", async () => {
  const root = path.join(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const extensionReadme = fs.readFileSync(path.join(root, "extension", "README.md"), "utf8");
  const workerReadme = fs.readFileSync(workerReadmePath, "utf8");

  assert.equal(packageJson.scripts["package:extension"], "node scripts/package-extension.mjs");
  assert.match(extensionReadme, /Load unpacked/);
  assert.match(extensionReadme, /activeTab/);
  assert.match(extensionReadme, /does not read.*password/is);
  assert.match(readme, /Canvas Companion/);
  assert.match(readme, /ClassPilot-Canvas-Companion\.zip/);
  assert.match(workerReadme, /IMPORT_HANDOFFS/);
  assert.match(workerReadme, /ten minutes/i);
  assert.match(workflow, /npm run package:extension/);
  assert.match(workflow, /ClassPilot-Canvas-Companion\.zip/);

  execFileSync(process.execPath, ["scripts/package-extension.mjs"], { cwd: root });
  const archivePath = path.join(root, "dist", "ClassPilot-Canvas-Companion.zip");
  const archive = await JSZip.loadAsync(fs.readFileSync(archivePath));
  for (const required of [
    "manifest.json",
    "service-worker.js",
    "capture.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "README.md",
    "icons/icon-128.png"
  ]) {
    assert.ok(archive.file(required), `extension package is missing ${required}`);
  }
});
