const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "pages.yml"),
  "utf8"
);

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
    /cp index\.html app\.js logic\.js planner\.js file-readers\.js styles\.css \.nojekyll site-dist\//
  );
  assert.match(deployJob, /cp -R vendor site-dist\/vendor/);
});
