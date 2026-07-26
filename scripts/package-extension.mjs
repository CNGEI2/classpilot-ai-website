import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(root, "extension");
const outputPath = path.join(root, "dist", "ClassPilot-Canvas-Companion.zip");
const files = [
  "manifest.json",
  "service-worker.js",
  "capture.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "README.md",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
];
const archiveDate = new Date("2026-07-25T00:00:00.000Z");

const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || JSON.stringify(manifest).includes("<all_urls>")) {
  throw new Error("Extension manifest does not satisfy the release permission contract.");
}

const zip = new JSZip();
for (const relative of files) {
  const contents = await fs.readFile(path.join(extensionRoot, relative));
  zip.file(relative, contents, { date: archiveDate });
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX"
}));

console.log(path.relative(root, outputPath));
