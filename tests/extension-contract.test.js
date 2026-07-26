const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "extension");

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

test("extension uses Manifest V3 with temporary page access only", () => {
  const manifest = JSON.parse(read("manifest.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(manifest.host_permissions, [
    "https://classpilot-ai-coach.cngei2-classpilot.workers.dev/*"
  ]);
});

test("popup exposes an accessible preview and explicit consent action", () => {
  const html = read("popup.html");

  assert.match(html, /<main[^>]*aria-labelledby="popupTitle"/);
  assert.match(html, /id="captureStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="previewCourse"/);
  assert.match(html, /id="previewTitle"/);
  assert.match(html, /id="previewDue"/);
  assert.match(html, /id="previewPoints"/);
  assert.match(html, /id="sendCapture"[^>]*type="button"/);
  assert.match(html, /Add to ClassPilot/);
  assert.doesNotMatch(html, /password|personal access token/i);
});

test("service worker captures only after a popup request and sends bounded JSON", () => {
  const source = read("service-worker.js");

  assert.match(source, /capture-active-tab/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /ClassPilotCanvasCapture\.captureCanvasPage/);
  assert.match(source, /createImportHandoff/);
  assert.match(source, /\/api\/import-handoffs/);
  assert.match(source, /cngei2\.github\.io\/classpilot-ai-website\//);
  assert.match(source, /\?import=\$\{encodeURIComponent\(handoff\.code\)\}/);
  assert.doesNotMatch(source, /document\.cookie|localStorage|password|accessToken/);
});

test("extension includes every declared raster icon", () => {
  const manifest = JSON.parse(read("manifest.json"));
  for (const size of [16, 32, 48, 128]) {
    const relative = manifest.icons[String(size)];
    assert.equal(relative, `icons/icon-${size}.png`);
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  }
});
