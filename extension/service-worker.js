"use strict";

const HANDOFF_ENDPOINT = "https://classpilot-ai-coach.cngei2-classpilot.workers.dev/api/import-handoffs";
const CLASSPILOT_URL = "https://cngei2.github.io/classpilot-ai-website/";

function publicMessage(error, fallback) {
  return String(error?.message || fallback || "ClassPilot could not complete this request.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function activeCanvasTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/[^/]+\/courses\/\d+/i.test(tab.url || "")) {
    throw new Error("Open a Canvas assignment, rubric, or syllabus page and try again.");
  }
  return tab;
}

async function captureActiveTab() {
  const tab = await activeCanvasTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["capture.js"]
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const capture = globalThis.ClassPilotCanvasCapture.captureCanvasPage(document, location);
      const validation = globalThis.ClassPilotCanvasCapture.validateCapture(capture);
      if (!validation.valid) throw new Error(validation.message);
      return capture;
    }
  });
  if (!result?.result) throw new Error("Canvas page details could not be read.");
  return result.result;
}

async function createImportHandoff(capture) {
  const response = await fetch(HANDOFF_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ClassPilot-Extension-Version": chrome.runtime.getManifest().version
    },
    body: JSON.stringify({ capture })
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || !value.code) {
    throw new Error(value.message || "ClassPilot could not prepare this import.");
  }
  return {
    code: String(value.code).slice(0, 180),
    expiresAt: String(value.expiresAt || "").slice(0, 80)
  };
}

async function sendCapture(capture) {
  const handoff = await createImportHandoff(capture);
  const url = `${CLASSPILOT_URL}?import=${encodeURIComponent(handoff.code)}`;
  await chrome.tabs.create({ url });
  return handoff;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = message?.type === "capture-active-tab"
    ? captureActiveTab()
    : message?.type === "send-capture"
      ? sendCapture(message.capture)
      : null;
  if (!action) return false;
  action.then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({
      ok: false,
      message: publicMessage(error)
    }));
  return true;
});
