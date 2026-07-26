"use strict";

const elements = {
  preview: document.querySelector("#capturePreview"),
  status: document.querySelector("#captureStatus"),
  send: document.querySelector("#sendCapture"),
  course: document.querySelector("#previewCourse"),
  type: document.querySelector("#previewType"),
  title: document.querySelector("#previewTitle"),
  due: document.querySelector("#previewDue"),
  points: document.querySelector("#previewPoints")
};

let currentCapture = null;

function text(value, fallback = "Not shown") {
  return String(value || "").trim() || fallback;
}

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.message || "ClassPilot could not complete this request."));
        return;
      }
      resolve(response.value);
    });
  });
}

function renderCapture(capture) {
  currentCapture = capture;
  const assignment = capture.assignment || {};
  elements.course.textContent = text(capture.course?.code || capture.course?.name);
  elements.type.textContent = text(capture.sourceType);
  elements.title.textContent = text(assignment.title || capture.course?.name, "Syllabus");
  elements.due.textContent = text(assignment.dueDate);
  elements.points.textContent = text(assignment.points);
  elements.preview.hidden = false;
  elements.send.disabled = false;
  setStatus("Ready to add.", "success");
}

async function readPage() {
  elements.send.disabled = true;
  setStatus("Reading this Canvas page...");
  try {
    renderCapture(await sendMessage({ type: "capture-active-tab" }));
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function submitCapture() {
  if (!currentCapture) return;
  elements.send.disabled = true;
  setStatus("Sending to ClassPilot...");
  try {
    await sendMessage({ type: "send-capture", capture: currentCapture });
    setStatus("Opened in ClassPilot.", "success");
  } catch (error) {
    elements.send.disabled = false;
    setStatus(error.message, "error");
  }
}

elements.send.addEventListener("click", submitCapture);
void readPage();
