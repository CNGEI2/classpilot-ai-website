const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const coach = require("../coach.js");
const logic = require("../logic.js");
const planner = require("../planner.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

test("icon-only commands have accessible labels and tooltips", () => {
  const iconButtons = [...html.matchAll(/<button([^>]*)>\s*<i data-lucide=/g)];
  assert.ok(iconButtons.length > 0);
  for (const match of iconButtons) {
    assert.match(match[1], /aria-label=/);
    assert.match(match[1], /title=/);
  }
});

test("page contains skip navigation and live status", () => {
  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="appStatus"[^>]*aria-live="polite"/);
});

test("visual system uses the Task 12 tokens and responsive layout contracts", () => {
  for (const [name, value] of Object.entries({
    ink: "#172026",
    "ink-2": "#2f3b40",
    muted: "#667378",
    canvas: "#f3f5f1",
    surface: "#ffffff",
    "surface-2": "#e9eeea",
    line: "#ccd5cf",
    teal: "#16766f",
    coral: "#c95545",
    gold: "#c79419",
    blue: "#376f92",
    violet: "#705b8f",
    danger: "#ae3f35"
  })) {
    assert.match(css, new RegExp(`--${name}:\\s*${value}`, "i"));
  }
  assert.match(css, /\.calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.focus-rail\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.3fr\)\s+minmax\(280px,\s*0\.7fr\)/s);
  assert.match(css, /@media\s*\(max-width:\s*840px\)[\s\S]*?\.mobile-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("desktop rail remains 248px at every width above the mobile breakpoint", () => {
  const railWidths = [...css.matchAll(/--rail-width:\s*([^;]+);/g)]
    .map((match) => match[1].trim());
  assert.ok(railWidths.length > 0);
  assert.deepEqual([...new Set(railWidths)], ["248px"]);
  assert.match(css, /@media\s*\(max-width:\s*840px\)[\s\S]*?\.app-rail\s*\{[^}]*display:\s*none/);
});

test("calendar edge-cell focus indicator renders inside the clipped grid", () => {
  assert.match(
    css,
    /\.calendar-day:focus-visible\s*\{[^}]*outline-offset:\s*-[1-9][0-9]*px[^}]*box-shadow:\s*inset/s
  );
});

function tagForId(id) {
  const match = html.match(new RegExp(`<([a-z][\\w-]*)[^>]*\\bid="${id}"[^>]*>`, "i"));
  return match?.[1].toLowerCase();
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force === false) this.values.delete(name);
    else if (force === true) this.values.add(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    return this.values.has(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(ownerDocument, id = "") {
    this.ownerDocument = ownerDocument;
    this.id = id;
    this.dataset = {};
    this.attributes = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.isConnected = true;
    this.checked = false;
    this.textContent = "";
    this.value = "";
    this.files = [];
    this.listeners = {};
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.ownerDocument.parseContainerButtons(this);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, handler) {
    this.listeners[type] ||= [];
    this.listeners[type].push(handler);
  }

  dispatch(type, values = {}) {
    const event = {
      currentTarget: this,
      target: this,
      preventDefault() {},
      ...values
    };
    return Promise.all(
      (this.listeners[type] || []).map((handler) => handler(event))
    );
  }

  click() {
    return this.dispatch("click");
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.focusHistory.push(this);
  }

  matches(selector) {
    return selector === "input[type=checkbox]" &&
      this.tagName === "INPUT" && this.getAttribute("type") === "checkbox";
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    void this.dispatch("close");
  }

  querySelectorAll(selector) {
    if (selector === "[data-import-stage]") {
      return this.children.filter(
        (child) => child.dataset.importStage !== undefined
      );
    }
    if (selector === "[data-course-tab]") {
      return this.children.filter(
        (child) => child.dataset.courseTab !== undefined
      );
    }
    if (selector === "[data-assignment-search]") {
      return this.children.filter(
        (child) => child.dataset.assignmentSearch !== undefined
      );
    }
    if (selector === "[data-assignment-status-filter]") {
      return this.children.filter(
        (child) => child.dataset.assignmentStatusFilter !== undefined
      );
    }
    if (selector === "[data-edit-task]") {
      return this.children.filter(
        (child) => child.dataset.editTask !== undefined
      );
    }
    return [];
  }

  closest(selector) {
    if (selector === "[data-view]" && this.dataset.view !== undefined) return this;
    if (selector === "[data-course-tab]" &&
      this.dataset.courseTab !== undefined) return this;
    if (selector === "[data-assignment-id]" &&
      this.dataset.assignmentId !== undefined) return this;
    if (selector === "[data-task-id]" && this.dataset.taskId !== undefined) return this;
    if (selector === "[data-edit-task]" &&
      this.dataset.editTask !== undefined) return this;
    if (selector === "[data-assignment-search]" &&
      this.dataset.assignmentSearch !== undefined) return this;
    if (selector === "[data-assignment-status-filter]" &&
      this.dataset.assignmentStatusFilter !== undefined) return this;
    if (selector === "[data-action]" && this.dataset.action !== undefined) return this;
    if (selector === "[data-calendar-date]" &&
      this.dataset.calendarDate !== undefined) return this;
    if (selector === "[data-calendar-month]" &&
      this.dataset.calendarMonth !== undefined) return this;
    if (selector === "[data-select-course]" &&
      this.dataset.selectCourse !== undefined) return this;
    if (selector === "[data-open-coach]" &&
      this.dataset.openCoach !== undefined) return this;
    if (selector === "[data-coach-action]" &&
      this.dataset.coachAction !== undefined) return this;
    if (selector === "[data-coach-stop]" &&
      this.dataset.coachStop !== undefined) return this;
    if (selector === "[data-coach-clear]" &&
      this.dataset.coachClear !== undefined) return this;
    if (selector === "[data-coach-language]" &&
      this.dataset.coachLanguage !== undefined) return this;
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = {};
    this.activeElement = null;
    this.focusHistory = [];
    this.elements = new Map();
    this.downloads = [];
    const ids = [
      "appNav",
      "appStatus",
      "assignmentDialog",
      "assignmentForm",
      "taskDialog",
      "taskForm",
      "calendarView",
      "calendarGrid",
      "calendarAgenda",
      "calendarCourseFilter",
      "calendarTypeFilter",
      "calendarMonthLabel",
      "undatedItems",
      "exportCalendar",
      "confirmationDialog",
      "courseList",
      "coursePlanDialog",
      "coursePlanForm",
      "courseTabs",
      "courseWorkspace",
      "coursesView",
      "dataView",
      "dataSummary",
      "lastBackup",
      "exportBackup",
      "importBackup",
      "backupPreview",
      "restoreBackup",
      "clearWorkspace",
      "globalImportButton",
      "headerImportButton",
      "importDropZone",
      "importDialog",
      "importDialogTitle",
      "importFile",
      "importForm",
      "importProgress",
      "importProgressDetail",
      "importReview",
      "importText",
      "reviewEvidence",
      "cancelImport",
      "analyzeImport",
      "saveImportReview",
      "courseImportActions",
      "mainWorkspace",
      "todayView",
      "undoToast",
      "viewEyebrow",
      "viewTitle"
    ];
    ids.forEach((id) => this.elements.set(id, new FakeElement(this, id)));
    this.mobileNav = new FakeElement(this, "mobileNav");
    const importStages = [
      ["reading", "Reading file"],
      ["extracting", "Extracting information"],
      ["checking", "Checking required fields"],
      ["saved", "Saved or needs review"]
    ].map(([stage, label]) => {
      const element = new FakeElement(this);
      element.dataset.importStage = stage;
      element.textContent = label;
      return element;
    });
    this.elements.get("importProgress").children = importStages;
    this.elements.get("importReview").hidden = true;
    this.elements.get("saveImportReview").hidden = true;

    const controls = {};
    [
      "courseId",
      "reviewCourseCode",
      "reviewCourseName",
      "reviewMaterialType",
      "reviewAssignment",
      "reviewDueDate",
      "reviewPoints",
      "reviewStatus",
      "reviewLinks",
      "reviewRequirements",
      "reviewDeliverables",
      "reviewTasks",
      "reviewSteps"
    ].forEach((name) => {
      const control = new FakeElement(this, name);
      control.setAttribute("name", name);
      controls[name] = control;
      this.elements.set(name, control);
    });
    controls.importFile = this.elements.get("importFile");
    controls.importText = this.elements.get("importText");
    this.elements.get("importFile").setAttribute("name", "importFile");
    this.elements.get("importText").setAttribute("name", "importText");
    this.elements.get("importForm").elements = {
      ...controls,
      namedItem: (name) => controls[name] || null
    };
    ["today", "courses", "calendar", "data"].forEach((view) => {
      this.elements.get(view + "View").dataset.viewPanel = view;
    });
  }

  querySelector(selector) {
    if (selector === ".mobile-nav") return this.mobileNav;
    if (selector.startsWith("#")) return this.elements.get(selector.slice(1)) || null;
    return null;
  }

  createElement(tagName) {
    const element = new FakeElement(this);
    element.tagName = String(tagName || "").toUpperCase();
    if (element.tagName === "A") {
      element.click = () => {
        this.downloads.push({ href: element.href, download: element.download });
      };
    }
    return element;
  }

  querySelectorAll(selector) {
    if (selector === "[data-view-panel]") {
      return ["todayView", "coursesView", "calendarView", "dataView"]
        .map((id) => this.elements.get(id));
    }
    if (selector === "[data-view]") {
      return [
        ...this.elements.get("appNav").children,
        ...this.mobileNav.children
      ].filter((element) => element.dataset.view !== undefined);
    }
    const dynamicDatasetSelectors = {
      "[data-action]": "action",
      "[data-edit-assignment]": "editAssignment",
      "[data-edit-course-plan]": "editCoursePlan",
      "[data-focus-key]": "focusKey"
    };
    if (dynamicDatasetSelectors[selector]) {
      const datasetName = dynamicDatasetSelectors[selector];
      const containers = selector === "[data-edit-course-plan]"
        ? [
            this.elements.get("courseImportActions"),
            this.elements.get("courseWorkspace")
          ]
        : [...this.elements.values(), this.mobileNav];
      return containers
        .flatMap((element) => element.children)
        .filter((element) => element.dataset[datasetName] !== undefined);
    }
    return [];
  }

  addEventListener(type, handler) {
    this.listeners[type] ||= [];
    this.listeners[type].push(handler);
  }

  dispatchClick(target) {
    (this.listeners.click || []).forEach((handler) => handler({ target }));
  }

  parseContainerButtons(container) {
    container.children.forEach((element) => {
      element.isConnected = false;
    });
    container.children = [];
    const controlPattern = /<(button|input|select)\b([^>]*)>/gi;
    for (const match of container.innerHTML.matchAll(controlPattern)) {
      const element = new FakeElement(this);
      element.tagName = match[1].toUpperCase();
      const attributePattern = /([:\w-]+)(?:="([^"]*)")?/g;
      for (const attribute of match[2].matchAll(attributePattern)) {
        const name = attribute[1];
        const value = decodeHtmlAttribute(attribute[2] || "");
        element.setAttribute(name, value);
        if (name === "class") {
          value.split(/\s+/).filter(Boolean)
            .forEach((className) => element.classList.toggle(className, true));
        }
        if (name === "checked") element.checked = true;
        if (name.startsWith("data-")) {
          const datasetName = name.slice(5).replace(/-([a-z])/g, (_, letter) =>
            letter.toUpperCase());
          element.dataset[datasetName] = value;
        }
      }
      container.children.push(element);
    }
  }
}

class FakeStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.writes = [];
    this.writeAttempts = 0;
    this.failWrites = false;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.writeAttempts += 1;
    if (this.failWrites) {
      const error = new Error("Storage quota exceeded.");
      error.name = "QuotaExceededError";
      throw error;
    }
    const serialized = String(value);
    this.values.set(key, serialized);
    this.writes.push([key, serialized]);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function createWorkspace(courses = [], preferences = {}) {
  return {
    schemaVersion: 7,
    courses,
    preferences: {
      activeView: "today",
      activeCourseId: courses[0]?.id || "",
      language: "en",
      calendarCourseFilter: "all",
      ...preferences
    },
    metadata: {
      updatedAt: "2026-07-22T00:00:00.000Z",
      lastBackupAt: ""
    }
  };
}

function editorForm(values) {
  const controls = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { value }])
  );
  return {
    elements: {
      ...controls,
      namedItem: (name) => controls[name] || null
    }
  };
}

function installFakeEditorControls(app, formId, names) {
  const controls = Object.fromEntries(names.map((name) => [
    name,
    new FakeElement(app.document, name)
  ]));
  app.document.elements.get(formId).elements = {
    ...controls,
    namedItem: (name) => controls[name] || null
  };
}

function editableCourse() {
  return {
    id: "course-1",
    code: "CS101",
    name: "Systems",
    coursePlan: {
      term: "Summer 2026",
      professor: "Professor Diaz",
      meetingLocation: "Room 101",
      officeHours: "Monday 2 PM",
      email: "diaz@example.edu"
    },
    assignments: [{
      id: "assignment-1",
      title: "Final lab",
      dueDate: "2026-08-01 17:00",
      points: "50",
      estimateMinutes: 60,
      status: { late: false },
      details: {
        requirements: ["Build the system"],
        deliverables: ["Submit the report"],
        steps: ["Draft the report"]
      },
      tasks: [{ id: "task-1", title: "Write report", done: false }]
    }]
  };
}

function persistedWorkspace(app) {
  return JSON.parse(app.localStorage.getItem("classpilot-workspace-v7"));
}

const researchText = `
  Research Paper
  Due: Mon Jun 22, 2026 9:00am
  Late
  Ungraded, 50 Possible Points
  50 Points Possible
  Submitted on Jul 5, 2026 12:51pm
  NEXT UP: Review Feedback
  https://www.zouantcha.com/blog/technology-whitepaper

  Assignment Overview
  Read Example Author's original research article and complete a strategic
  analysis using original critical thinking.

  Required Reading
  Nakamoto, S. (2008). Technology: A Peer-to-Peer Electronic Cash System.
  Core Assignment Tasks
  Task 1: Contextualized Problem Analysis (20%)
  Interview one professional in finance/technology.
  Task 2: Competitive Intelligence Integration (25%)
  Use AI to identify Technology's competitors.
  Task 3: Stakeholder Impact Assessment (25%)
  Interview or survey at least 3 real individuals.
  Task 4: Future Scenario Planning (20%)
  Generate 3 scenarios for Technology's evolution.
  Task 5: AI Collaboration Reflection (10%)
  Document and analyze your AI usage.
  Deliverables
  Main Report (4-5 pages)
  AI Collaboration Appendix (1-2 pages)
  Screenshots or transcripts of key AI interactions
  Bibliography of AI tools used
`;

function cs450Course() {
  return {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: [],
    coursePlan: {}
  };
}

function runApp({
  workspaceRaw,
  legacyRaw,
  hash = "",
  search = "",
  now,
  failWrites = false,
  logicApi = logic,
  fileReaderApi = {
    readImportFile: async (file, options = {}) => {
      options.onProgress?.({
        stage: "reading",
        kind: "text",
        fileName: file.name
      });
      return { kind: "text", text: await file.text(), pageCount: 0 };
    }
  },
  tesseract,
  manualAnimationFrames = false
} = {}) {
  const initial = {};
  if (workspaceRaw !== undefined) initial["classpilot-workspace-v7"] = workspaceRaw;
  if (legacyRaw !== undefined) initial["classpilot-user-courses-v6"] = legacyRaw;

  const document = new FakeDocument();
  const localStorage = new FakeStorage(initial);
  localStorage.failWrites = failWrites;
  const location = { hash, search };
  const listeners = {};
  const errors = [];
  const animationFrames = [];
  const animationFrameCallbacks = [];
  const timers = [];
  const blobUrls = [];
  let animationFrameId = 0;
  let timerId = 0;
  const captureAnimationFrame = () => ({
    dialogOpen: document.elements.get("importDialog").open,
    progress: document.elements.get("importProgressDetail").textContent
  });
  const fixedNow = now === undefined ? null : new Date(now).getTime();
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }

    static now() {
      return fixedNow;
    }
  }
  const context = {
    AbortController,
    Blob,
    DOMException,
    ClassPilotFileReaders: fileReaderApi,
    ClassPilotCoach: coach,
    ClassPilotLogic: logicApi,
    ClassPilotPlanner: planner,
    console: {
      error: (...args) => errors.push(args),
      log: () => {},
      warn: () => {}
    },
    document,
    history: {
      pushState: (_state, _title, nextHash) => {
        location.hash = String(nextHash).includes("#")
          ? "#" + String(nextHash).split("#").pop()
          : "";
      },
      replaceState: (_state, _title, nextHash) => {
        location.hash = String(nextHash).includes("#")
          ? "#" + String(nextHash).split("#").pop()
          : "";
      }
    },
    localStorage,
    location,
    lucide: { createIcons: () => {} },
    requestAnimationFrame: (callback) => {
      animationFrameId += 1;
      if (manualAnimationFrames) {
        animationFrameCallbacks.push(callback);
      } else {
        animationFrames.push(captureAnimationFrame());
        callback(animationFrameId);
      }
      return animationFrameId;
    },
    cancelAnimationFrame: () => {},
    Date: fixedNow === null ? Date : FixedDate,
    clearTimeout: (id) => {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    setTimeout: (callback, delay) => {
      timerId += 1;
      timers.push({ id: timerId, callback, delay, cleared: false, fired: false });
      return timerId;
    },
    Tesseract: tesseract,
    URL: {
      createObjectURL: (blob) => {
        const url = "blob:classpilot-" + (blobUrls.length + 1);
        blobUrls.push({ url, blob, revoked: false });
        return url;
      },
      revokeObjectURL: (url) => {
        const entry = blobUrls.find((item) => item.url === url);
        if (entry) entry.revoked = true;
      }
    },
    addEventListener: (type, handler) => {
      listeners[type] ||= [];
      listeners[type].push(handler);
    }
  };
  context.window = context;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: "app.js" });

  return {
    context,
    animationFrames,
    blobUrls,
    document,
    errors,
    listeners,
    localStorage,
    location,
    timers,
    advanceAnimationFrame() {
      const callbacks = animationFrameCallbacks.splice(0);
      animationFrames.push(captureAnimationFrame());
      callbacks.forEach((callback) => callback(animationFrames.length));
      return callbacks.length;
    },
    pendingAnimationFrameCount() {
      return animationFrameCallbacks.length;
    },
    runTimer(id) {
      const timer = timers.find((item) => item.id === id);
      if (!timer || timer.cleared || timer.fired) return false;
      timer.fired = true;
      timer.callback();
      return true;
    },
    dispatchWindow(type) {
      (listeners[type] || []).forEach((handler) => handler());
    }
  };
}

test("contains the four primary product views with Today as the default", () => {
  const views = ["today", "courses", "calendar", "data"];

  for (const view of views) {
    assert.match(html, new RegExp(`id="${view}View"`));
    assert.match(html, new RegExp(`data-view="${view}"`));
  }

  assert.equal((html.match(/data-view="/g) || []).length, views.length);
  assert.match(html, /<section\b[^>]*id="todayView"(?![^>]*\bhidden\b)[^>]*>/i);
});

test("exposes the stable application shell IDs", () => {
  const ids = [
    "appNav",
    "globalImportButton",
    "todayView",
    "coursesView",
    "calendarView",
    "dataView",
    "courseList",
    "courseTabs",
    "courseWorkspace",
    "importDialog",
    "importForm",
    "assignmentDialog",
    "assignmentForm",
    "confirmationDialog",
    "undoToast",
    "appStatus"
  ];

  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("provides semantic navigation, status, and dialog hosts", () => {
  assert.match(html, /<a\b[^>]*class="skip-link"[^>]*href="#mainWorkspace"[^>]*>/i);
  assert.equal(tagForId("appNav"), "nav");
  assert.match(html, /<nav\b[^>]*class="mobile-nav"[^>]*aria-label="Mobile primary"[^>]*>/i);
  assert.match(html, /id="appStatus"[^>]*role="status"[^>]*aria-live="polite"/i);

  for (const id of ["importDialog", "assignmentDialog", "confirmationDialog"]) {
    assert.equal(tagForId(id), "dialog");
  }
  assert.equal(tagForId("importForm"), "form");
  assert.equal(tagForId("assignmentForm"), "form");
  assert.match(html, /id="courseTabs"[^>]*role="tablist"/i);
  assert.match(html, /id="undoToast"[^>]*role="status"/i);
  assert.match(html, /id="globalImportButton"[^>]*aria-label="[^"]+"/i);
});

test("assignment and course-plan dialogs contain editable planning fields", () => {
  for (const name of [
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ]) {
    assert.match(html, new RegExp('name="' + name + '"'));
  }
  for (const name of [
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]) {
    assert.match(html, new RegExp('name="' + name + '"'));
  }
  for (const name of ["courseId", "assignmentId", "taskId", "taskTitle"]) {
    assert.match(
      html,
      new RegExp('<form[^>]*id="taskForm"[\\s\\S]*?name="' + name + '"')
    );
  }
  assert.match(
    html,
    /<select name="assignmentStatus">[\s\S]*?<option value="graded">Graded<\/option>/
  );
});

test("Assignments expose labeled search and status filter controls with handlers", () => {
  assert.match(appSource, /data-assignment-search/);
  assert.match(appSource, /data-assignment-status-filter/);
  assert.match(appSource, /No assignments match this search and status filter/);
  assert.match(css, /\.assignment-toolbar\s*\{[^}]*display:\s*grid/s);
  assert.match(
    css,
    /@media\s*\(max-width:\s*520px\)[\s\S]*?\.assignment-toolbar\s*\{[^}]*grid-template-columns:\s*1fr/s
  );
});

test("calendar and data views expose complete controls", () => {
  for (const id of [
    "calendarGrid",
    "calendarAgenda",
    "calendarCourseFilter",
    "calendarTypeFilter",
    "calendarMonthLabel",
    "undatedItems",
    "exportCalendar",
    "dataSummary",
    "lastBackup",
    "exportBackup",
    "importBackup",
    "backupPreview",
    "restoreBackup",
    "clearWorkspace"
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /id="importBackup"[^>]*accept="application\/json"/i);
  assert.match(html, /id="calendarPreviousMonth"[^>]*aria-label="Previous month"/i);
  assert.match(html, /id="calendarNextMonth"[^>]*aria-label="Next month"/i);
  assert.doesNotMatch(html, /id="calendarGrid"[^>]*role="grid"/i);
});

test("named Calendar containers do not use the implicit generic role", () => {
  const labelledGenericDivs = html.match(
    /<div\b(?=[^>]*\baria-label=)(?![^>]*\brole=)[^>]*>/gi
  ) || [];

  assert.deepEqual(labelledGenericDivs, []);
  assert.match(html, /class="calendar-controls"[^>]*role="group"[^>]*aria-label="Calendar filters"/i);
  assert.match(html, /id="calendarGrid"[^>]*role="group"[^>]*aria-label="Calendar month"/i);
  assert.match(html, /id="calendarPreviousMonth"[^>]*aria-label="Previous month"/i);
});

test("calendar renders a fixed six-week grid and filters agenda items", () => {
  const app = runApp({
    now: "2026-07-22T12:00:00-07:00",
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [
        { id: "dated", title: "Dated lab", dueAt: "2026-07-22T17:00:00.000Z" },
        { id: "undated", title: "Undated notes" }
      ],
      coursePlan: { exams: [{ label: "Midterm", date: "2026-07-22 09:00" }] }
    }]))
  });
  app.document.elements.get("calendarCourseFilter").value = "course-1";
  app.document.elements.get("calendarTypeFilter").value = "assignment";

  app.context.renderCalendar();

  assert.equal(
    (app.document.elements.get("calendarGrid").innerHTML.match(
      /data-calendar-date=/g
    ) || []).length,
    42
  );
  assert.match(app.document.elements.get("calendarAgenda").innerHTML, /Dated lab/);
  assert.doesNotMatch(app.document.elements.get("calendarAgenda").innerHTML, /Midterm/);
  assert.match(app.document.elements.get("undatedItems").innerHTML, /Undated notes/);
});

test("backup restore validates before replacing the saved workspace", async () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw: original });

  await assert.rejects(
    app.context.previewBackup({ size: 10, text: async () => "not json" }),
    /valid JSON/i
  );
  await assert.rejects(
    app.context.previewBackup({ size: 25 * 1024 * 1024 + 1, text: async () => "{}" }),
    /25 MB or smaller/i
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.context.getActiveCourse().id, "course-1");

  await app.context.previewBackup({
    size: 10,
    text: async () => JSON.stringify(createWorkspace([{
      id: "restored",
      code: "REST101",
      name: "Restored course",
      assignments: []
    }]))
  });
  app.localStorage.failWrites = true;

  assert.equal(app.context.restoreBackup(), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.context.getActiveCourse().id, "course-1");
});

test("invalid nested backup preview never mutates current or saved workspace", async () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw: original });
  const invalid = createWorkspace([{
    id: "restored",
    code: "REST101",
    name: "Restored course",
    assignments: [{
      id: "assignment-1",
      title: "Broken task backup",
      tasks: [{ id: "", title: "Missing task id" }]
    }]
  }]);

  await assert.rejects(
    app.context.previewBackup({
      size: 100,
      text: async () => JSON.stringify(invalid)
    }),
    /course 1 assignment 1 task 1 must have a non-empty id/i
  );

  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.context.getActiveCourse().id, "course-1");
  assert.equal(app.document.elements.get("restoreBackup").disabled, true);
  assert.equal(app.context.restoreBackup(), false);
});

test("malformed coursePlan preview never mutates current or saved workspace", async () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw: original });
  const cases = [
    [
      { deadlines: [null] },
      /coursePlan\.deadlines\[0\] must be an object/i
    ],
    [
      { deadlines: [{ label: "", date: "Dec 10, 2026" }] },
      /coursePlan\.deadlines\[0\]\.label must be a non-empty string/i
    ],
    [
      { deadlines: [{ label: "Final project", date: null }] },
      /coursePlan\.deadlines\[0\]\.date must be a non-empty string/i
    ],
    [
      { policies: [{ label: "Late work", text: null }] },
      /coursePlan\.policies\[0\]\.text must be a non-empty string/i
    ]
  ];

  for (const [coursePlan, message] of cases) {
    const invalid = createWorkspace([{
      id: "restored",
      code: "REST101",
      name: "Restored course",
      assignments: [],
      coursePlan
    }]);

    await assert.rejects(
      app.context.previewBackup({
        size: 100,
        text: async () => JSON.stringify(invalid)
      }),
      message
    );

    assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
    assert.equal(app.context.getActiveCourse().id, "course-1");
    assert.equal(app.document.elements.get("restoreBackup").disabled, true);
  }
});

test("future and deeply malformed backup previews disarm restore without mutation", async () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw: original });
  await app.context.previewBackup({
    size: 100,
    text: async () => JSON.stringify(createWorkspace([{
      id: "restored",
      code: "REST101",
      name: "Restored course",
      assignments: []
    }]))
  });
  assert.equal(app.document.elements.get("restoreBackup").disabled, false);

  await assert.rejects(
    app.context.previewBackup({
      size: 100,
      text: async () => JSON.stringify({
        ...createWorkspace([]),
        schemaVersion: 8
      })
    }),
    /newer than supported version 7.*update ClassPilot/i
  );
  assert.equal(app.document.elements.get("restoreBackup").disabled, true);
  assert.equal(app.context.restoreBackup(), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.context.getActiveCourse().id, "course-1");

  const malformed = createWorkspace([{
    id: "restored",
    code: "REST101",
    name: "Restored course",
    assignments: [{
      id: "assignment-1",
      title: "Malformed steps",
      details: {
        requirements: ["Read the prompt"],
        deliverables: ["Submit the report"],
        steps: [{ title: "", done: false }]
      },
      tasks: []
    }]
  }]);
  await assert.rejects(
    app.context.previewBackup({
      size: 100,
      text: async () => JSON.stringify(malformed)
    }),
    /assignment 1 details\.steps\[0\]\.title must be a non-empty string/i
  );
  assert.equal(app.document.elements.get("restoreBackup").disabled, true);
  assert.equal(app.context.restoreBackup(), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.context.getActiveCourse().id, "course-1");
});

test("calendar downloads honor course and type filters in the exported ICS", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([
      {
        id: "course-1",
        code: "CS101",
        name: "Systems",
        assignments: [{
          id: "allowed-assignment",
          title: "Allowed lab",
          dueAt: "2026-07-22T17:00:00.000Z"
        }],
        coursePlan: { exams: [{ label: "Filtered exam", date: "2026-07-23 09:00" }] }
      },
      {
        id: "course-2",
        code: "MATH200",
        name: "Math",
        assignments: [{
          id: "filtered-course",
          title: "Other course lab",
          dueAt: "2026-07-24T17:00:00.000Z"
        }]
      }
    ]))
  });
  app.document.elements.get("calendarCourseFilter").value = "course-1";
  app.document.elements.get("calendarTypeFilter").value = "assignment";

  assert.equal(app.context.downloadCalendar(), true);
  assert.equal(app.document.downloads[0].download, "classpilot-calendar.ics");
  const ics = await app.blobUrls[0].blob.text();
  assert.match(ics, /SUMMARY:CS101 - Allowed lab/);
  assert.doesNotMatch(ics, /Filtered exam|Other course lab/);
  assert.equal(app.blobUrls[0].revoked, false);
  assert.equal(app.timers.at(-1).delay, 0);
  assert.equal(app.runTimer(app.timers.at(-1).id), true);
  assert.equal(app.blobUrls[0].revoked, true);

  assert.equal(app.context.downloadBackup(), true);
  assert.equal(app.document.downloads[1].download, "classpilot-backup.json");
  assert.match(persistedWorkspace(app).metadata.lastBackupAt, /^20/);
});

test("a later invalid backup selection prevents an earlier preview from restoring", async () => {
  let resolveFirstText;
  const firstText = new Promise((resolve) => {
    resolveFirstText = resolve;
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  const validFirst = {
    size: 10,
    text: () => firstText
  };
  const invalidSecond = {
    size: 10,
    text: async () => "not valid JSON"
  };

  const firstPreview = app.context.handleBackupFileChange({
    currentTarget: { files: [validFirst] }
  });
  await Promise.resolve();
  await app.context.handleBackupFileChange({
    currentTarget: { files: [invalidSecond] }
  });
  resolveFirstText(JSON.stringify(createWorkspace([{
    id: "old-preview",
    code: "OLD101",
    name: "Old preview",
    assignments: []
  }])));
  await firstPreview;

  assert.equal(app.document.elements.get("restoreBackup").disabled, true);
  assert.match(app.document.elements.get("backupPreview").textContent, /Choose a backup/i);
  assert.match(app.document.elements.get("appStatus").textContent, /could not be prepared/i);
  assert.equal(app.context.restoreBackup(), false);
});

test("backup export still downloads when its timestamp cannot be persisted", async () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw: original });
  app.localStorage.failWrites = true;

  assert.equal(app.context.downloadBackup(), true);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.context.getActiveCourse().id, "course-1");
  assert.equal(app.document.downloads.length, 1);
  assert.equal(app.document.downloads[0].download, "classpilot-backup.json");
  const exported = JSON.parse(await app.blobUrls[0].blob.text());
  assert.equal(exported.courses[0].id, "course-1");
  assert.match(exported.metadata.lastBackupAt, /^20/);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /download started.*backup time could not be saved/i
  );
});

test("clear workspace requires confirmation and preserves the v6 recovery key", () => {
  const v6Recovery = JSON.stringify([{ code: "LEGACY", name: "Recovery" }]);
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()])),
    legacyRaw: v6Recovery
  });

  assert.equal(app.context.clearWorkspaceAfterConfirmation(), false);
  assert.equal(app.context.requestClearWorkspace(), true);
  assert.equal(app.document.elements.get("confirmationDialog").open, true);
  assert.match(
    app.document.elements.get("confirmationDialog").innerHTML,
    /Export a backup before clearing/i
  );

  assert.equal(app.context.clearWorkspaceAfterConfirmation(), true);
  assert.deepEqual(persistedWorkspace(app).courses, []);
  assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), v6Recovery);
});

test("a failed confirmed clear leaves both current and recovery data untouched", () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const v6Recovery = JSON.stringify([{ code: "LEGACY", name: "Recovery" }]);
  const app = runApp({ workspaceRaw: original, legacyRaw: v6Recovery });
  app.context.requestClearWorkspace();
  app.localStorage.failWrites = true;

  assert.equal(app.context.clearWorkspaceAfterConfirmation(), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);
  assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), v6Recovery);
  assert.equal(app.context.getActiveCourse().id, "course-1");
});

test("closing the clear confirmation disarms its second action", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  app.context.requestClearWorkspace();

  await app.document.elements.get("confirmationDialog").dispatch("close");

  assert.equal(app.context.clearWorkspaceAfterConfirmation(), false);
  assert.equal(app.context.getActiveCourse().id, "course-1");
});

test("deleting an assignment persists removal and undo restores its snapshot", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{ id: "assignment-1", title: "Final lab", tasks: [] }]
    }]))
  });

  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-1"),
    true
  );
  assert.equal(
    JSON.parse(app.localStorage.getItem("classpilot-workspace-v7"))
      .courses[0].assignments.length,
    0
  );

  assert.equal(app.context.restoreUndo(), true);
  assert.equal(
    JSON.parse(app.localStorage.getItem("classpilot-workspace-v7"))
      .courses[0].assignments[0].title,
    "Final lab"
  );
});

test("undo expires after exactly ten seconds and clears its action", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{ id: "assignment-1", title: "Final lab", tasks: [] }]
    }]))
  });

  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-1"),
    true
  );
  assert.equal(app.timers.length, 1);
  assert.equal(app.timers[0].delay, 10000);
  assert.equal(app.runTimer(app.timers[0].id), true);
  assert.equal(app.document.elements.get("undoToast").hidden, true);
  assert.equal(app.context.restoreUndo(), false);
});

test("assignment edits commit all planning fields transactionally", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  const form = editorForm({
    courseId: "course-1",
    assignmentId: "assignment-1",
    assignmentTitle: "Published final lab",
    assignmentDueDate: "2026-08-03 17:00",
    assignmentPoints: "75",
    assignmentStatus: "completed",
    assignmentEstimate: "135",
    assignmentRequirements: "Build the system\nDocument the interface",
    assignmentDeliverables: "Submit the report\nShare the demo",
    assignmentSteps: "Draft the report\nRecord the demo"
  });

  assert.equal(app.context.submitAssignmentEdit(form), true);
  const assignment = persistedWorkspace(app).courses[0].assignments[0];
  assert.equal(assignment.title, "Published final lab");
  assert.equal(assignment.dueDate, "2026-08-03 17:00");
  assert.equal(assignment.points, "75");
  assert.equal(assignment.estimateMinutes, 135);
  assert.equal(assignment.status.completed, true);
  assert.deepEqual(assignment.details.requirements, [
    "Build the system",
    "Document the interface"
  ]);
  assert.deepEqual(assignment.details.deliverables, [
    "Submit the report",
    "Share the demo"
  ]);
  assert.deepEqual(assignment.details.steps, ["Draft the report", "Record the demo"]);
});

test("assignment editor rejects impossible dates and accepts a valid leap date", () => {
  const workspaceRaw = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw });
  installFakeEditorControls(app, "assignmentForm", [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ]);

  assert.equal(
    app.context.openAssignmentEditor("course-1", "assignment-1"),
    true
  );
  const controls = app.document.elements.get("assignmentForm").elements;
  controls.assignmentDueDate.value = "02/31/2026";

  assert.equal(app.context.submitAssignmentEdit(), false);
  assert.equal(app.document.elements.get("assignmentDialog").open, true);
  assert.equal(app.document.activeElement, controls.assignmentDueDate);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /enter a valid due date.+leave it blank/i
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(
    app.context.findAssignment("course-1", "assignment-1").dueDate,
    "2026-08-01 17:00"
  );

  controls.assignmentDueDate.value = "02/29/2024";
  assert.equal(app.context.submitAssignmentEdit(), true);
  assert.equal(app.document.elements.get("assignmentDialog").open, false);
  const saved = persistedWorkspace(app).courses[0].assignments[0];
  assert.equal(saved.dueDate, "02/29/2024");
  assert.equal(saved.dueAt, planner.parseDueAt("02/29/2024"));
});

test("assignment editor strictly rejects impossible English month dates", () => {
  const controlNames = [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ];
  for (const dueDate of [
    "Feb 31, 2026, 11:59 PM",
    "Tuesday, Apr 31, 2026 at 8:30 AM",
    "Feb 29, 2025",
    "Sept 31, 2026",
    "Sep. 31, 2026",
    "31 Feb 2026",
    "Sep 31st, 2026"
  ]) {
    const workspaceRaw = JSON.stringify(createWorkspace([editableCourse()]));
    const app = runApp({ workspaceRaw });
    installFakeEditorControls(app, "assignmentForm", controlNames);
    assert.equal(
      app.context.openAssignmentEditor("course-1", "assignment-1"),
      true
    );
    const controls = app.document.elements.get("assignmentForm").elements;
    controls.assignmentDueDate.value = dueDate;

    assert.equal(app.context.submitAssignmentEdit(), false, dueDate);
    assert.equal(app.document.elements.get("assignmentDialog").open, true);
    assert.equal(app.document.activeElement, controls.assignmentDueDate);
    assert.equal(
      app.localStorage.getItem("classpilot-workspace-v7"),
      workspaceRaw
    );
  }

  for (const [dueDate, expected] of [
    ["Thursday, Feb 29, 2024 at 8:30 AM", "Thu Feb 29, 2024, 8:30 AM"],
    ["Sept 30, 2026", "Sep 30, 2026"],
    ["Sep. 30, 2026", "Sep 30, 2026"],
    ["29 Feb 2024", "Feb 29, 2024"]
  ]) {
    const valid = runApp({
      workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
    });
    installFakeEditorControls(valid, "assignmentForm", controlNames);
    assert.equal(
      valid.context.openAssignmentEditor("course-1", "assignment-1"),
      true
    );
    valid.document.elements.get("assignmentForm")
      .elements.assignmentDueDate.value = dueDate;
    assert.equal(valid.context.submitAssignmentEdit(), true, dueDate);
    const saved = persistedWorkspace(valid).courses[0].assignments[0];
    assert.equal(saved.dueDate, expected, dueDate);
    assert.equal(saved.dueAt, planner.parseDueAt(expected), dueDate);
  }
});

test("assignment editor strictly handles separated English month dates", () => {
  const controlNames = [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ];
  const invalidDates = [
    "31-Feb-2026",
    "31/Feb/2026",
    "31.Feb.2026",
    "Feb-31-2026",
    "Feb/31/2026",
    "Feb.31.2026"
  ];
  for (const dueDate of invalidDates) {
    const workspaceRaw = JSON.stringify(createWorkspace([editableCourse()]));
    const app = runApp({ workspaceRaw });
    installFakeEditorControls(app, "assignmentForm", controlNames);
    assert.equal(
      app.context.openAssignmentEditor("course-1", "assignment-1"),
      true
    );
    const controls = app.document.elements.get("assignmentForm").elements;
    controls.assignmentDueDate.value = dueDate;

    assert.equal(app.context.submitAssignmentEdit(), false, dueDate);
    assert.equal(app.document.elements.get("assignmentDialog").open, true);
    assert.equal(app.document.activeElement, controls.assignmentDueDate);
    assert.equal(
      app.localStorage.getItem("classpilot-workspace-v7"),
      workspaceRaw
    );
  }

  for (const dueDate of [
    "29-Feb-2024",
    "29/Feb/2024",
    "29.Feb.2024",
    "Feb-29-2024",
    "Feb/29/2024",
    "Feb.29.2024"
  ]) {
    const app = runApp({
      workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
    });
    installFakeEditorControls(app, "assignmentForm", controlNames);
    assert.equal(
      app.context.openAssignmentEditor("course-1", "assignment-1"),
      true
    );
    app.document.elements.get("assignmentForm")
      .elements.assignmentDueDate.value = dueDate;

    assert.equal(app.context.submitAssignmentEdit(), true, dueDate);
    const saved = persistedWorkspace(app).courses[0].assignments[0];
    assert.equal(saved.dueDate, "Feb 29, 2024", dueDate);
    assert.equal(saved.dueAt, planner.parseDueAt("Feb 29, 2024"), dueDate);
  }
});

test("assignment editor persists a deterministic year for yearless English dates", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()])),
    now: "2026-07-20T12:00:00-07:00"
  });
  installFakeEditorControls(app, "assignmentForm", [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ]);
  assert.equal(
    app.context.openAssignmentEditor("course-1", "assignment-1"),
    true
  );
  app.document.elements.get("assignmentForm")
    .elements.assignmentDueDate.value = "Jul 25 11:59 PM";

  assert.equal(app.context.submitAssignmentEdit(), true);
  const saved = persistedWorkspace(app).courses[0].assignments[0];
  assert.equal(saved.dueDate, "Jul 25, 2026, 11:59 PM");
  assert.equal(
    saved.dueAt,
    planner.parseDueAt(
      "Jul 25, 2026, 11:59 PM",
      new Date("2026-07-20T12:00:00-07:00")
    )
  );
});

test("failed assignment edits leave the workspace unchanged", () => {
  const workspaceRaw = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw });
  const form = editorForm({
    courseId: "course-1",
    assignmentId: "assignment-1",
    assignmentTitle: "Unsaved title",
    assignmentDueDate: "2026-09-01",
    assignmentPoints: "100",
    assignmentStatus: "submitted",
    assignmentEstimate: "180",
    assignmentRequirements: "Changed requirement",
    assignmentDeliverables: "Changed deliverable",
    assignmentSteps: "Changed step"
  });
  app.localStorage.failWrites = true;

  assert.equal(app.context.submitAssignmentEdit(form), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(
    app.context.findAssignment("course-1", "assignment-1").title,
    "Final lab"
  );
});

test("course-plan edits commit all fields transactionally", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  const form = editorForm({
    courseId: "course-1",
    courseCode: "CS101",
    courseName: "Systems",
    coursePlanTerm: "Fall 2026",
    coursePlanProfessor: "Professor Lin",
    coursePlanMeeting: "Lab 202",
    coursePlanOfficeHours: "Thursday 4 PM",
    coursePlanEmail: "lin@example.edu"
  });

  assert.equal(app.context.submitCoursePlanEdit(form), true);
  const plan = persistedWorkspace(app).courses[0].coursePlan;
  assert.equal(plan.term, "Fall 2026");
  assert.equal(plan.professor, "Professor Lin");
  assert.equal(plan.meetingLocation, "Lab 202");
  assert.equal(plan.officeHours, "Thursday 4 PM");
  assert.equal(plan.email, "lin@example.edu");
});

test("failed course-plan edits leave the workspace unchanged", () => {
  const workspaceRaw = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw });
  const form = editorForm({
    courseId: "course-1",
    courseCode: "CS101",
    courseName: "Systems",
    coursePlanTerm: "Unsaved term",
    coursePlanProfessor: "Unsaved professor",
    coursePlanMeeting: "Unsaved room",
    coursePlanOfficeHours: "Unsaved hours",
    coursePlanEmail: "unsaved@example.edu"
  });
  app.localStorage.failWrites = true;

  assert.equal(app.context.submitCoursePlanEdit(form), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(
    app.context.getActiveCourse().coursePlan.professor,
    "Professor Diaz"
  );
});

test("course deletion persists and Undo restores the course", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });

  assert.equal(app.context.deleteCourseWithUndo("course-1"), true);
  assert.equal(persistedWorkspace(app).courses.length, 0);
  assert.equal(app.context.restoreUndo(), true);
  assert.equal(persistedWorkspace(app).courses[0].name, "Systems");
});

test("task deletion persists and Undo restores the task", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });

  assert.equal(
    app.context.deleteTaskWithUndo("course-1", "assignment-1", "task-1"),
    true
  );
  assert.equal(persistedWorkspace(app).courses[0].assignments[0].tasks.length, 0);
  assert.equal(app.context.restoreUndo(), true);
  assert.equal(
    persistedWorkspace(app).courses[0].assignments[0].tasks[0].title,
    "Write report"
  );
});

test("a failed deletion preserves the existing Undo action and workspace", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-1"),
    true
  );
  const undoMarkup = app.document.elements.get("undoToast").innerHTML;
  const persistedAfterFirstDeletion = app.localStorage.getItem("classpilot-workspace-v7");
  app.localStorage.failWrites = true;

  assert.equal(app.context.deleteCourseWithUndo("course-1"), false);
  assert.equal(
    app.localStorage.getItem("classpilot-workspace-v7"),
    persistedAfterFirstDeletion
  );
  assert.equal(app.document.elements.get("undoToast").hidden, false);
  assert.equal(app.document.elements.get("undoToast").innerHTML, undoMarkup);
  assert.equal(app.context.restoreUndo(), false);
});

test("a failed Undo restore keeps the deletion state and actionable Undo UI", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-1"),
    true
  );
  const undoMarkup = app.document.elements.get("undoToast").innerHTML;
  app.localStorage.failWrites = true;

  assert.equal(app.context.restoreUndo(), false);
  assert.equal(persistedWorkspace(app).courses[0].assignments.length, 0);
  assert.equal(app.document.elements.get("undoToast").hidden, false);
  assert.equal(app.document.elements.get("undoToast").innerHTML, undoMarkup);
  assert.match(undoMarkup, /data-undo/);
});

test("a failed task completion save restores the checkbox state", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{
        id: "assignment-1",
        title: "Final lab",
        tasks: [{ id: "task-1", title: "Write report", done: false }]
      }]
    }]))
  });
  app.context.selectAssignment({
    dataset: { courseId: "course-1", assignmentId: "assignment-1" }
  });
  const checkbox = app.document.elements.get("courseWorkspace").children
    .find((element) => element.dataset.taskId === "task-1");
  app.localStorage.failWrites = true;
  checkbox.checked = true;

  app.document.dispatchClick(checkbox);

  assert.equal(checkbox.checked, false);
  assert.equal(
    JSON.parse(app.localStorage.getItem("classpilot-workspace-v7"))
      .courses[0].assignments[0].tasks[0].done,
    false
  );
});

test("assignment search and status filters persist across session rerenders", async () => {
  const course = editableCourse();
  course.assignments.push(
    {
      id: "late-paper",
      title: "Late paper",
      dueDate: "2026-07-20",
      status: { late: true },
      tasks: []
    },
    {
      id: "submitted-paper",
      title: "Submitted paper",
      dueDate: "2026-07-21",
      status: { submittedAt: "2026-07-21T12:00:00.000Z" },
      tasks: []
    },
    {
      id: "completed-quiz",
      title: "Completed quiz",
      dueDate: "2026-07-19",
      status: { completed: true },
      tasks: []
    }
  );
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  app.context.navigateToView("courses", { persist: false });
  const initial = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(initial, /id="assignmentSearch"/);
  assert.match(initial, /aria-label="Search assignments in CS101"/);
  assert.match(initial, /id="assignmentStatusFilter"/);

  const search = new FakeElement(app.document);
  search.dataset.assignmentSearch = "";
  search.dataset.courseId = "course-1";
  search.value = "paper";
  assert.equal(
    app.context.handleAssignmentFilterChange({ target: search }),
    true
  );
  let markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(markup, /Late paper/);
  assert.match(markup, /Submitted paper/);
  assert.doesNotMatch(markup, /Final lab|Completed quiz/);

  const filter = new FakeElement(app.document);
  filter.dataset.assignmentStatusFilter = "";
  filter.dataset.courseId = "course-1";
  filter.value = "submitted";
  assert.equal(
    app.context.handleAssignmentFilterChange({ target: filter }),
    true
  );
  markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(markup, /Submitted paper/);
  assert.doesNotMatch(markup, /Late paper/);
  assert.match(markup, /value="paper"/);
  assert.match(
    markup,
    /<option value="submitted" selected>Submitted<\/option>/
  );

  app.context.renderAll();
  markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(markup, /value="paper"/);
  assert.match(markup, /Submitted paper/);
  assert.ok(
    app.document.elements.get("courseWorkspace").listeners.input?.length
  );
  assert.ok(
    app.document.elements.get("courseWorkspace").listeners.change?.length
  );
});

test("course selection is explicit and assignment filters preserve focus through click, input, and change", async () => {
  const course = editableCourse();
  course.assignments.push({
    id: "late-paper",
    title: "Late paper",
    status: { late: true },
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  app.context.navigateToView("courses", { persist: false });

  const workspaceElement = app.document.elements.get("courseWorkspace");
  const search = workspaceElement.children.find(
    (element) => element.dataset.assignmentSearch !== undefined
  );
  search.value = "paper";
  search.focus();
  const writesBeforeSearchClick = app.localStorage.writeAttempts;

  app.document.dispatchClick(search);

  assert.equal(app.localStorage.writeAttempts, writesBeforeSearchClick);
  assert.equal(search.isConnected, true);
  assert.equal(app.document.activeElement, search);

  await workspaceElement.dispatch("input", { target: search });
  const replacementSearch = workspaceElement.children.find(
    (element) => element.dataset.assignmentSearch !== undefined
  );
  assert.equal(app.context.assignmentFilterState("course-1").search, "paper");
  assert.notEqual(replacementSearch, search);
  assert.equal(app.document.activeElement, replacementSearch);

  const status = workspaceElement.children.find(
    (element) => element.dataset.assignmentStatusFilter !== undefined
  );
  status.value = "late";
  status.focus();
  const writesBeforeStatusClick = app.localStorage.writeAttempts;

  app.document.dispatchClick(status);

  assert.equal(app.localStorage.writeAttempts, writesBeforeStatusClick);
  assert.equal(status.isConnected, true);
  assert.equal(app.document.activeElement, status);

  await workspaceElement.dispatch("change", { target: status });
  const replacementStatus = workspaceElement.children.find(
    (element) => element.dataset.assignmentStatusFilter !== undefined
  );
  assert.equal(app.context.assignmentFilterState("course-1").status, "late");
  assert.notEqual(replacementStatus, status);
  assert.equal(app.document.activeElement, replacementStatus);
  assert.match(workspaceElement.innerHTML, /Late paper/);
  assert.doesNotMatch(workspaceElement.innerHTML, /Final lab/);

  const courseButton = app.document.elements.get("courseList").children[0];
  assert.equal(courseButton.dataset.selectCourse, "");
});

test("assignment filters render an explicit empty result", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  app.context.navigateToView("courses", { persist: false });
  const search = new FakeElement(app.document);
  search.dataset.assignmentSearch = "";
  search.dataset.courseId = "course-1";
  search.value = "does not exist";

  assert.equal(
    app.context.handleAssignmentFilterChange({ target: search }),
    true
  );
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /No assignments match this search and status filter/
  );
});

test("same-ID restore resets filters only after persistence succeeds", async () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const restoredCourse = editableCourse();
  restoredCourse.assignments[0].title = "Restored final lab";
  const app = runApp({ workspaceRaw: original });
  app.context.navigateToView("courses", { persist: false });
  const search = new FakeElement(app.document);
  search.dataset.assignmentSearch = "";
  search.dataset.courseId = "course-1";
  search.value = "does not exist";
  assert.equal(
    app.context.handleAssignmentFilterChange({ target: search }),
    true
  );
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /No assignments match this search and status filter/
  );
  await app.context.previewBackup({
    size: 100,
    text: async () => JSON.stringify(createWorkspace([restoredCourse]))
  });
  app.localStorage.failWrites = true;

  assert.equal(app.context.restoreBackup(), false);
  assert.equal(
    app.context.assignmentFilterState("course-1").search,
    "does not exist"
  );
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /No assignments match this search and status filter/
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);

  app.localStorage.failWrites = false;
  assert.equal(app.context.restoreBackup(), true);
  const markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.equal(app.context.assignmentFilterState("course-1").search, "");
  assert.equal(app.context.assignmentFilterState("course-1").status, "all");
  assert.match(markup, /Restored final lab/);
  assert.match(markup, /id="assignmentSearch"[^>]*value=""/);
  assert.match(markup, /<option value="all" selected>All statuses<\/option>/);
});

test("restore hydrates normalized preferences only after verified persistence", async () => {
  const firstCourse = editableCourse();
  const secondCourse = {
    id: "course-2",
    code: "MATH200",
    name: "Discrete Math",
    assignments: [{
      id: "proofs",
      title: "Proof set",
      tasks: []
    }],
    coursePlan: {}
  };
  const original = JSON.stringify(createWorkspace(
    [firstCourse, secondCourse],
    {
      activeView: "today",
      activeCourseId: "course-1",
      calendarCourseFilter: "course-1"
    }
  ));
  const app = runApp({ workspaceRaw: original });
  app.context.navigateToView("data", { persist: false });
  app.document.elements.get("calendarCourseFilter").value = "course-1";
  app.context.assignmentFilterState("course-1").search = "stale query";

  await app.context.previewBackup({
    size: 100,
    text: async () => JSON.stringify(createWorkspace(
      [firstCourse, secondCourse],
      {
        activeView: "calendar",
        activeCourseId: "course-2",
        calendarCourseFilter: "course-2"
      }
    ))
  });
  app.localStorage.failWrites = true;

  assert.equal(app.context.restoreBackup(), false);
  assert.equal(app.location.hash, "#data");
  assert.equal(app.context.getActiveCourse().id, "course-1");
  assert.equal(
    app.document.elements.get("calendarCourseFilter").value,
    "course-1"
  );
  assert.equal(
    app.context.assignmentFilterState("course-1").search,
    "stale query"
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);

  app.localStorage.failWrites = false;
  assert.equal(app.context.restoreBackup(), true);

  const persisted = persistedWorkspace(app);
  assert.deepEqual(persisted.preferences, {
    activeView: "calendar",
    activeCourseId: "course-2",
    language: "en",
    calendarCourseFilter: "course-2"
  });
  assert.equal(app.context.getActiveCourse().id, "course-2");
  assert.equal(app.location.hash, "#calendar");
  assert.equal(
    app.document.elements.get("calendarView").hidden,
    false
  );
  assert.equal(
    app.document.elements.get("dataView").hidden,
    true
  );
  assert.equal(
    app.document.elements.get("calendarCourseFilter").value,
    "course-2"
  );
  assert.equal(
    app.context.assignmentFilterState("course-1").search,
    ""
  );
  assert.equal(
    app.document.querySelectorAll("[data-view]").filter((button) =>
      button.dataset.view === "calendar" &&
      button.getAttribute("aria-current") === "page"
    ).length,
    2
  );
  const selectedCourse = app.document.elements.get("courseList").children
    .find((button) => button.dataset.courseId === "course-2");
  assert.equal(selectedCourse.classList.contains("active"), true);
});

test("clear resets filters only after persistence succeeds", () => {
  const original = JSON.stringify(createWorkspace([editableCourse()]));
  const app = runApp({ workspaceRaw: original });
  app.context.navigateToView("courses", { persist: false });
  const search = new FakeElement(app.document);
  search.dataset.assignmentSearch = "";
  search.dataset.courseId = "course-1";
  search.value = "no results";
  const status = new FakeElement(app.document);
  status.dataset.assignmentStatusFilter = "";
  status.dataset.courseId = "course-1";
  status.value = "graded";
  app.context.handleAssignmentFilterChange({ target: search });
  app.context.handleAssignmentFilterChange({ target: status });
  app.context.requestClearWorkspace();
  app.localStorage.failWrites = true;

  assert.equal(app.context.clearWorkspaceAfterConfirmation(), false);
  assert.equal(
    app.context.assignmentFilterState("course-1").search,
    "no results"
  );
  assert.equal(
    app.context.assignmentFilterState("course-1").status,
    "graded"
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), original);

  app.localStorage.failWrites = false;
  assert.equal(app.context.clearWorkspaceAfterConfirmation(), true);
  assert.equal(app.context.assignmentFilterState("course-1").search, "");
  assert.equal(app.context.assignmentFilterState("course-1").status, "all");
});

test("Graded assignment filter excludes active work and remains accessible", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "score-only",
    title: "Scored paper",
    status: { score: "92/100" },
    tasks: []
  }, {
    id: "graded-category",
    title: "Graded project",
    category: "Graded",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  app.context.navigateToView("courses", { persist: false });
  const filter = new FakeElement(app.document);
  filter.dataset.assignmentStatusFilter = "";
  filter.dataset.courseId = "course-1";
  filter.value = "graded";

  assert.equal(
    app.context.handleAssignmentFilterChange({ target: filter }),
    true
  );
  const markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(
    markup,
    /<option value="graded" selected>Graded<\/option>/
  );
  assert.match(markup, /Scored paper/);
  assert.match(markup, /Graded project/);
  assert.doesNotMatch(markup, /Final lab/);
  assert.match(markup, /aria-label="Filter assignments by status"/);
});

test("score placeholders and real scores agree in filters and the editor", () => {
  const scoreCases = [
    ["blank-score", "Placeholder blank", "", false],
    ["null-score", "Placeholder null", null, false],
    ["na-upper", "Placeholder N A upper", "N/A", false],
    ["na-lower", "Placeholder N A lower", "n/a", false],
    ["pending-score", "Placeholder pending", "Pending", false],
    ["ungraded-score", "Placeholder ungraded", "Ungraded", false],
    ["not-graded-score", "Placeholder not graded", "Not graded", false],
    ["zero-number", "Real zero number", 0, true],
    ["zero-fraction", "Real zero fraction", "0/100", true],
    ["percent-score", "Real percent", "85%", true],
    ["letter-score", "Real letter", "A", true],
    ["fraction-score", "Real fraction", "45/50", true]
  ];
  const course = editableCourse();
  course.assignments = scoreCases.map(([id, title, score]) => ({
    id,
    title,
    status: { score },
    tasks: []
  }));
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  app.context.navigateToView("courses", { persist: false });
  const filter = new FakeElement(app.document);
  filter.dataset.assignmentStatusFilter = "";
  filter.dataset.courseId = "course-1";
  filter.value = "graded";

  assert.equal(
    app.context.handleAssignmentFilterChange({ target: filter }),
    true
  );
  const markup = app.document.elements.get("courseWorkspace").innerHTML;
  for (const [, title, , meaningful] of scoreCases) {
    if (meaningful) assert.match(markup, new RegExp(title));
    else assert.doesNotMatch(markup, new RegExp(title));
  }

  const controlNames = [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ];
  installFakeEditorControls(app, "assignmentForm", controlNames);
  assert.equal(
    app.context.openAssignmentEditor("course-1", "zero-number"),
    true
  );
  const controls = app.document.elements.get("assignmentForm").elements;
  assert.equal(controls.assignmentStatus.value, "graded");
  app.document.elements.get("assignmentDialog").close();

  assert.equal(
    app.context.openAssignmentEditor("course-1", "na-lower"),
    true
  );
  assert.equal(controls.assignmentStatus.value, "active");

  for (const [, , score, meaningful] of scoreCases) {
    app.context.renderImportReview({
      status: { score },
      assignmentDetails: {}
    });
    assert.equal(
      app.document.elements.get("reviewStatus").value,
      meaningful ? "graded" : "assigned",
      `import review should classify ${String(score)} consistently`
    );
  }
});

test("assignment editor round-trips and sets Graded without inventing a score", () => {
  const scoredCourse = editableCourse();
  scoredCourse.assignments[0].status = {
    score: "94/100",
    submittedAt: "2026-07-21T12:00:00.000Z"
  };
  const scored = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([scoredCourse]))
  });
  const controlNames = [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ];
  installFakeEditorControls(scored, "assignmentForm", controlNames);

  assert.equal(
    scored.context.openAssignmentEditor("course-1", "assignment-1"),
    true
  );
  const scoredControls = scored.document.elements.get("assignmentForm").elements;
  assert.equal(scoredControls.assignmentStatus.value, "graded");
  assert.equal(scored.context.submitAssignmentEdit(), true);
  const scoredAssignment = persistedWorkspace(scored)
    .courses[0].assignments[0];
  assert.equal(scoredAssignment.status.score, "94/100");
  assert.equal(scoredAssignment.status.grading, "Graded");
  assert.equal(scoredAssignment.category, "Graded");

  const manual = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  installFakeEditorControls(manual, "assignmentForm", controlNames);
  assert.equal(
    manual.context.openAssignmentEditor("course-1", "assignment-1"),
    true
  );
  manual.document.elements.get("assignmentForm")
    .elements.assignmentStatus.value = "graded";
  assert.equal(manual.context.submitAssignmentEdit(), true);
  const manuallyGraded = persistedWorkspace(manual)
    .courses[0].assignments[0];
  assert.equal(manuallyGraded.status.grading, "Graded");
  assert.equal(manuallyGraded.category, "Graded");
  assert.equal(
    Object.prototype.hasOwnProperty.call(manuallyGraded.status, "score"),
    false
  );
});

test("explicit non-Graded status changes clear real scores without contradictory UI", () => {
  const controlNames = [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ];
  const cases = [
    ["active", "To submit", "Active"],
    ["late", "Late", "Late"],
    ["submitted", "Submitted", "Submitted"],
    ["completed", "Completed", "Completed"]
  ];

  for (const [statusValue, category, label] of cases) {
    const course = editableCourse();
    course.assignments[0].category = "Graded";
    course.assignments[0].status = {
      value: "graded",
      grading: "Graded",
      score: "94/100",
      gradedAt: "2026-07-21T12:00:00.000Z"
    };
    const app = runApp({
      workspaceRaw: JSON.stringify(createWorkspace([course])),
      now: "2026-07-24T12:00:00-07:00"
    });
    installFakeEditorControls(app, "assignmentForm", controlNames);
    assert.equal(
      app.context.openAssignmentEditor("course-1", "assignment-1"),
      true
    );
    const controls = app.document.elements.get("assignmentForm").elements;
    assert.equal(controls.assignmentStatus.value, "graded");
    controls.assignmentStatus.value = statusValue;

    assert.equal(app.context.submitAssignmentEdit(), true, statusValue);
    const saved = persistedWorkspace(app).courses[0].assignments[0];
    assert.equal(saved.category, category);
    assert.equal(saved.status.value, statusValue);
    assert.equal(
      Object.prototype.hasOwnProperty.call(saved.status, "score"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(saved.status, "gradedAt"),
      false
    );
    assert.equal(logic.hasMeaningfulScore(saved.status.score), false);
    assert.equal(app.context.assignmentStatusValue(saved), statusValue);
    assert.match(
      app.document.elements.get("courseWorkspace").innerHTML,
      new RegExp(category + " \\| " + label)
    );
    assert.doesNotMatch(
      app.document.elements.get("courseWorkspace").innerHTML,
      /\| Graded/
    );

    assert.equal(
      app.context.openAssignmentEditor("course-1", "assignment-1"),
      true
    );
    assert.equal(controls.assignmentStatus.value, statusValue);
  }

  const reviewApp = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  for (const statusValue of ["assigned", "late", "submitted"]) {
    const status = reviewApp.context.reviewedStatus(statusValue, {
      grading: "Graded",
      score: "85%",
      gradedAt: "2026-07-21T12:00:00.000Z"
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(status, "score"),
      false,
      statusValue
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(status, "gradedAt"),
      false,
      statusValue
    );
    assert.equal(logic.hasMeaningfulScore(status.score), false);
  }
});

test("task title editing is transactional, target-named, and returns focus", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "delete-me",
    title: "Delete me",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  installFakeEditorControls(app, "taskForm", [
    "courseId",
    "assignmentId",
    "taskId",
    "taskTitle"
  ]);
  app.context.selectAssignment({
    dataset: { courseId: "course-1", assignmentId: "assignment-1" }
  });
  const markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(markup, /aria-label="Edit task: Write report"/);
  assert.match(markup, /title="Edit task: Write report"/);
  const opener = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editTask !== undefined
  );
  assert.ok(opener?.dataset.focusKey);
  assert.equal(
    app.context.openTaskEditor(
      "course-1",
      "assignment-1",
      "task-1",
      opener
    ),
    true
  );
  const controls = app.document.elements.get("taskForm").elements;
  controls.taskTitle.value = "Write polished report";
  assert.equal(app.context.submitTaskEdit(), true);

  const assignment = persistedWorkspace(app).courses[0].assignments.find(
    (item) => item.id === "assignment-1"
  );
  assert.equal(assignment.tasks[0].title, "Write polished report");
  assert.equal(assignment.tasks[0].done, false);
  const replacement = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editTask !== undefined
  );
  assert.notEqual(replacement, opener);
  assert.equal(replacement.dataset.focusKey, opener.dataset.focusKey);
  assert.equal(app.document.activeElement, replacement);
  assert.equal(app.document.elements.get("undoToast").hidden, true);
});

test("failed task title editing preserves data and an existing Undo", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "delete-me",
    title: "Delete me",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  installFakeEditorControls(app, "taskForm", [
    "courseId",
    "assignmentId",
    "taskId",
    "taskTitle"
  ]);
  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "delete-me"),
    true
  );
  const undoMarkup = app.document.elements.get("undoToast").innerHTML;
  assert.equal(
    app.context.openTaskEditor(
      "course-1",
      "assignment-1",
      "task-1"
    ),
    true
  );
  app.document.elements.get("taskForm").elements.taskTitle.value =
    "Unsaved task title";
  app.localStorage.failWrites = true;

  assert.equal(app.context.submitTaskEdit(), false);
  assert.equal(
    persistedWorkspace(app).courses[0].assignments[0].tasks[0].title,
    "Write report"
  );
  assert.equal(app.document.elements.get("undoToast").hidden, false);
  assert.equal(app.document.elements.get("undoToast").innerHTML, undoMarkup);

  app.localStorage.failWrites = false;
  assert.equal(app.context.restoreUndo(), true);
});

test("course editor corrects OCR identity without duplicating or losing course data", () => {
  const course = editableCourse();
  course.code = "A145O";
  course.name = "Systerns";
  course.assignments[0].tasks[0].done = true;
  course.assignments[0].status = { completed: true };
  course.coursePlan.deadlines = [{
    label: "Final Exam",
    date: "Dec 12, 2026"
  }];
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  installFakeEditorControls(app, "coursePlanForm", [
    "courseId",
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]);

  assert.equal(app.context.openCoursePlanEditor("course-1"), true);
  const controls = app.document.elements.get("coursePlanForm").elements;
  assert.equal(controls.courseCode.value, "A145O");
  assert.equal(controls.courseName.value, "Systerns");
  controls.courseCode.value = "CS450";
  controls.courseName.value = "Systems";
  assert.equal(app.context.submitCoursePlanEdit(), true);

  const persisted = persistedWorkspace(app);
  assert.equal(persisted.courses.length, 1);
  assert.equal(persisted.courses[0].id, "course-1");
  assert.equal(persisted.courses[0].code, "CS450");
  assert.equal(persisted.courses[0].name, "Systems");
  assert.equal(persisted.preferences.activeCourseId, "course-1");
  assert.equal(persisted.courses[0].coursePlan.deadlines[0].date, "Dec 12, 2026");
  assert.equal(persisted.courses[0].assignments[0].status.completed, true);
  assert.equal(persisted.courses[0].assignments[0].tasks[0].done, true);
});

test("course editor rejects a normalized course code conflict transactionally", () => {
  const current = editableCourse();
  const other = {
    id: "course-2",
    code: "CS 202",
    name: "Data Science",
    assignments: [],
    coursePlan: {}
  };
  const workspaceRaw = JSON.stringify(createWorkspace([current, other]));
  const app = runApp({ workspaceRaw });
  installFakeEditorControls(app, "coursePlanForm", [
    "courseId",
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]);

  assert.equal(app.context.openCoursePlanEditor("course-1"), true);
  const controls = app.document.elements.get("coursePlanForm").elements;
  controls.courseCode.value = "  cs   202  ";
  controls.courseName.value = "Unique systems";

  assert.equal(app.context.submitCoursePlanEdit(), false);
  assert.equal(app.document.elements.get("coursePlanDialog").open, true);
  assert.equal(app.document.activeElement, controls.courseCode);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /course code.+already belongs to.+CS 202/i
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(app.context.getActiveCourse().code, "CS101");
});

test("course editor rejects a normalized course name conflict transactionally", () => {
  const current = editableCourse();
  const other = {
    id: "course-2",
    code: "DS202",
    name: "Data Science",
    assignments: [],
    coursePlan: {}
  };
  const workspaceRaw = JSON.stringify(createWorkspace([current, other]));
  const app = runApp({ workspaceRaw });
  installFakeEditorControls(app, "coursePlanForm", [
    "courseId",
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]);

  assert.equal(app.context.openCoursePlanEditor("course-1"), true);
  const controls = app.document.elements.get("coursePlanForm").elements;
  controls.courseCode.value = "CS303";
  controls.courseName.value = "  DATA   SCIENCE  ";

  assert.equal(app.context.submitCoursePlanEdit(), false);
  assert.equal(app.document.elements.get("coursePlanDialog").open, true);
  assert.equal(app.document.activeElement, controls.courseName);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /course name.+already belongs to.+DS202/i
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(app.context.getActiveCourse().name, "Systems");
});

test("successful task completion invalidates an older deletion Undo", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "assignment-2",
    title: "Delete me",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });

  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
    true
  );
  assert.equal(
    app.context.setTaskCompletion("course-1", "assignment-1", "task-1", true),
    true
  );

  assert.equal(app.document.elements.get("undoToast").hidden, true);
  assert.equal(app.context.restoreUndo(), false);
  const persisted = persistedWorkspace(app).courses[0].assignments;
  assert.equal(persisted.some((item) => item.id === "assignment-2"), false);
  assert.equal(
    persisted.find((item) => item.id === "assignment-1").tasks[0].done,
    true
  );
});

test("successful assignment edit invalidates an older deletion Undo", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "assignment-2",
    title: "Delete me",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
    true
  );

  assert.equal(app.context.submitAssignmentEdit(editorForm({
    courseId: "course-1",
    assignmentId: "assignment-1",
    assignmentTitle: "Edited after delete",
    assignmentDueDate: "2026-08-01 17:00",
    assignmentPoints: "50",
    assignmentStatus: "active",
    assignmentEstimate: "60",
    assignmentRequirements: "Build the system",
    assignmentDeliverables: "Submit the report",
    assignmentSteps: "Draft the report"
  })), true);

  assert.equal(app.document.elements.get("undoToast").hidden, true);
  assert.equal(app.context.restoreUndo(), false);
  const persisted = persistedWorkspace(app).courses[0].assignments;
  assert.equal(persisted.some((item) => item.id === "assignment-2"), false);
  assert.equal(
    persisted.find((item) => item.id === "assignment-1").title,
    "Edited after delete"
  );
});

test("successful import invalidates an older deletion Undo", async () => {
  const course = cs450Course();
  course.assignments = [{
    id: "old-assignment",
    title: "Delete me",
    tasks: []
  }];
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  assert.equal(
    app.context.deleteAssignmentWithUndo("cs450", "old-assignment"),
    true
  );

  assert.equal(await app.context.processImport(researchText, "cs450"), true);

  assert.equal(app.document.elements.get("undoToast").hidden, true);
  assert.equal(app.context.restoreUndo(), false);
  const assignments = persistedWorkspace(app).courses[0].assignments;
  assert.equal(assignments.some((item) => item.id === "old-assignment"), false);
  assert.equal(assignments.some((item) => item.title === "Research Paper"), true);
});

test("successful clear invalidates an older deletion Undo", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "assignment-2",
    title: "Delete me",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
    true
  );

  app.context.requestClearWorkspace();
  assert.equal(app.context.clearWorkspaceAfterConfirmation(), true);

  assert.equal(app.document.elements.get("undoToast").hidden, true);
  assert.equal(app.context.restoreUndo(), false);
  assert.deepEqual(persistedWorkspace(app).courses, []);
});

test("a failed unrelated mutation preserves a valid deletion Undo", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "assignment-2",
    title: "Delete me",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });
  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
    true
  );
  const undoMarkup = app.document.elements.get("undoToast").innerHTML;
  app.localStorage.failWrites = true;

  assert.equal(
    app.context.setTaskCompletion("course-1", "assignment-1", "task-1", true),
    false
  );
  assert.equal(app.document.elements.get("undoToast").hidden, false);
  assert.equal(app.document.elements.get("undoToast").innerHTML, undoMarkup);

  app.localStorage.failWrites = false;
  assert.equal(app.context.restoreUndo(), true);
  const assignments = persistedWorkspace(app).courses[0].assignments;
  assert.equal(assignments.some((item) => item.id === "assignment-2"), true);
  assert.equal(
    assignments.find((item) => item.id === "assignment-1").tasks[0].done,
    false
  );
});

test("successful preference-only saves invalidate deletion Undo", async (t) => {
  const cases = [
    {
      name: "navigation",
      async run(app) {
        assert.equal(app.context.navigateToView("data"), true);
        assert.equal(persistedWorkspace(app).preferences.activeView, "data");
      }
    },
    {
      name: "course selection",
      async run(app) {
        assert.equal(app.context.selectCourse("course-2"), true);
        assert.equal(
          persistedWorkspace(app).preferences.activeCourseId,
          "course-2"
        );
      }
    },
    {
      name: "calendar course filter",
      async run(app) {
        const filter = app.document.elements.get("calendarCourseFilter");
        filter.value = "course-2";
        await filter.dispatch("change");
        assert.equal(
          persistedWorkspace(app).preferences.calendarCourseFilter,
          "course-2"
        );
      }
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const course = editableCourse();
      course.assignments.push({
        id: "assignment-2",
        title: "Delete me",
        tasks: []
      });
      const app = runApp({
        workspaceRaw: JSON.stringify(createWorkspace([course, {
          id: "course-2",
          code: "MATH200",
          name: "Discrete Math",
          assignments: [],
          coursePlan: {}
        }]))
      });
      assert.equal(
        app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
        true
      );

      await item.run(app);

      assert.equal(app.document.elements.get("undoToast").hidden, true);
      assert.equal(app.context.restoreUndo(), false);
      assert.equal(
        persistedWorkspace(app).courses[0].assignments.some(
          (assignment) => assignment.id === "assignment-2"
        ),
        false
      );
    });
  }
});

test("failed preference-only saves retain Undo and all prior state", async (t) => {
  const cases = [
    {
      name: "navigation",
      async run(app) {
        assert.equal(app.context.navigateToView("data"), false);
        assert.equal(app.location.hash, "#today");
        assert.equal(app.document.elements.get("todayView").hidden, false);
        assert.equal(
          app.document.elements.get("dataView").hidden,
          true
        );
      }
    },
    {
      name: "course selection",
      async run(app) {
        assert.equal(app.context.selectCourse("course-2"), false);
        assert.equal(app.context.getActiveCourse().id, "course-1");
        assert.equal(app.location.hash, "#today");
      }
    },
    {
      name: "calendar course filter",
      async run(app) {
        const filter = app.document.elements.get("calendarCourseFilter");
        filter.value = "course-2";
        await filter.dispatch("change");
        assert.equal(filter.value, "all");
        assert.equal(
          app.context.currentCalendarFilter().courseId,
          "all"
        );
      }
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const course = editableCourse();
      course.assignments.push({
        id: "assignment-2",
        title: "Delete me",
        tasks: []
      });
      const app = runApp({
        workspaceRaw: JSON.stringify(createWorkspace([course, {
          id: "course-2",
          code: "MATH200",
          name: "Discrete Math",
          assignments: [],
          coursePlan: {}
        }]))
      });
      assert.equal(
        app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
        true
      );
      const persistedAfterDeletion = app.localStorage.getItem(
        "classpilot-workspace-v7"
      );
      const undoMarkup = app.document.elements.get("undoToast").innerHTML;
      app.localStorage.failWrites = true;

      await item.run(app);

      assert.equal(
        app.localStorage.getItem("classpilot-workspace-v7"),
        persistedAfterDeletion
      );
      assert.equal(app.document.elements.get("undoToast").hidden, false);
      assert.equal(
        app.document.elements.get("undoToast").innerHTML,
        undoMarkup
      );
      app.localStorage.failWrites = false;
      assert.equal(app.context.restoreUndo(), true);
      assert.equal(
        persistedWorkspace(app).courses[0].assignments.some(
          (assignment) => assignment.id === "assignment-2"
        ),
        true
      );
    });
  }
});

test("a new deletion replaces the older Undo without resurrecting older data", () => {
  const course = editableCourse();
  course.assignments.push({
    id: "assignment-2",
    title: "Delete me first",
    tasks: []
  });
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });

  assert.equal(
    app.context.deleteAssignmentWithUndo("course-1", "assignment-2"),
    true
  );
  assert.equal(
    app.context.deleteTaskWithUndo(
      "course-1",
      "assignment-1",
      "task-1"
    ),
    true
  );
  assert.equal(app.context.restoreUndo(), true);

  const assignments = persistedWorkspace(app).courses[0].assignments;
  assert.equal(assignments.some((item) => item.id === "assignment-2"), false);
  assert.equal(
    assignments.find((item) => item.id === "assignment-1").tasks[0].title,
    "Write report"
  );
});

test("provides the complete one-upload import and review controls", () => {
  const ids = [
    "importFile",
    "importText",
    "importProgress",
    "importReview",
    "reviewEvidence",
    "cancelImport",
    "analyzeImport",
    "saveImportReview"
  ];
  const reviewNames = [
    "reviewCourseCode",
    "reviewCourseName",
    "reviewMaterialType",
    "reviewAssignment",
    "reviewDueDate",
    "reviewPoints",
    "reviewStatus",
    "reviewLinks",
    "reviewRequirements",
    "reviewDeliverables",
    "reviewTasks",
    "reviewSteps"
  ];

  ids.forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  reviewNames.forEach((name) =>
    assert.match(html, new RegExp(`name="${name}"`))
  );
  assert.match(
    html,
    /accept="[^"]*\.pdf[^"]*\.png[^"]*\.jpg[^"]*\.jpeg[^"]*\.webp[^"]*\.txt[^"]*\.md[^"]*\.csv/i
  );
  assert.deepEqual(
    [...html.matchAll(/data-import-stage="([^"]+)"/g)]
      .map((match) => match[1]),
    ["reading", "extracting", "checking", "saved"]
  );
});

test("keeps IDs unique and avoids inline event handlers", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("uses one page-level heading", () => {
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
});

test("loads local runtime dependencies before app.js", () => {
  const order = [
    "vendor/tesseract/tesseract.min.js",
    "logic.js",
    "planner.js",
    "file-readers.js",
    "vendor/lucide/lucide.js",
    "app.js"
  ].map((name) => html.indexOf(name));

  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc="https?:\/\//i);
});

test("present invalid v7 values remain byte-for-byte untouched with zero writes", async (t) => {
  const cases = [
    ["empty string", ""],
    ["malformed JSON", '{"schemaVersion":7'],
    ["malformed root", JSON.stringify({ schemaVersion: 7, courses: "invalid" })],
    ["malformed courses", JSON.stringify({
      schemaVersion: 7,
      courses: [{ id: "", code: "", name: "" }]
    })]
  ];

  for (const [name, raw] of cases) {
    await t.test(name, () => {
      const app = runApp({ workspaceRaw: raw });
      assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), raw);
      assert.equal(app.localStorage.writes.length, 0);
      assert.match(
        app.document.elements.get("appStatus").textContent,
        /Browser storage could not load your workspace/
      );
      assert.match(
        app.document.elements.get("appStatus").textContent,
        /stored value was left unchanged/i
      );
    });
  }
});

test("invalid legacy root is retained and does not create v7", () => {
  const legacyRaw = JSON.stringify({ courses: [] });
  const app = runApp({ legacyRaw });

  assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), legacyRaw);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), null);
  assert.equal(app.localStorage.writes.length, 0);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not load your workspace/
  );
});

test("malformed legacy course entries are retained with zero v7 writes", async (t) => {
  const cases = [
    ["missing identity", [{
      id: "",
      code: "",
      name: "",
      assignments: []
    }]],
    ["invalid assignments shape", [{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: { bad: true }
    }]]
  ];

  for (const [name, courses] of cases) {
    await t.test(name, () => {
      const legacyRaw = JSON.stringify(courses);
      const app = runApp({ legacyRaw });

      assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), legacyRaw);
      assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), null);
      assert.equal(app.localStorage.writes.length, 0);
      assert.equal(app.localStorage.writeAttempts, 0);
      assert.equal(app.context.saveWorkspace(), false);
      assert.equal(app.localStorage.writeAttempts, 0);
      assert.match(
        app.document.elements.get("appStatus").textContent,
        /stored value was left unchanged/i
      );
    });
  }
});

test("verified legacy migration writes v7 once and retains exact v6", () => {
  const legacyRaw = JSON.stringify([{
    id: "course-1",
    code: "CS101",
    name: "Systems",
    assignments: [{
      id: "assignment-1",
      title: "Lab",
      dueDate: "2026-07-30"
    }]
  }]);
  const app = runApp({ legacyRaw });
  const migratedRaw = app.localStorage.getItem("classpilot-workspace-v7");
  const migrated = JSON.parse(migratedRaw);

  assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), legacyRaw);
  assert.equal(app.localStorage.writes.length, 1);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.courses[0].assignments[0].estimateMinutes > 0, true);
  assert.doesNotThrow(() => planner.parseWorkspaceBackup(migratedRaw));
});

test("valid v7 initialization does not rewrite stored data", () => {
  const workspaceRaw = JSON.stringify(createWorkspace());
  const app = runApp({ workspaceRaw });

  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(app.localStorage.writes.length, 0);
  assert.equal(
    app.document.elements.get("appStatus").textContent,
    "Workspace ready. Your course data stays in this browser."
  );
});

test("a transient save failure is retried and a later write succeeds", () => {
  const workspaceRaw = JSON.stringify(createWorkspace());
  const app = runApp({ workspaceRaw });
  app.localStorage.failWrites = true;

  assert.equal(app.context.saveWorkspace(), false);
  assert.equal(app.localStorage.writeAttempts, 1);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not save your workspace/
  );
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /free browser storage.*try again/i
  );

  app.localStorage.failWrites = false;
  assert.equal(app.context.saveWorkspace(), true);
  assert.equal(app.localStorage.writeAttempts, 2);
  assert.doesNotThrow(() => planner.parseWorkspaceBackup(
    app.localStorage.getItem("classpilot-workspace-v7")
  ));
});

test("course selection retries after a transient quota failure", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: []
    }]))
  });
  const courseButton = app.document.elements.get("courseList").children[0];
  app.localStorage.failWrites = true;

  app.document.dispatchClick(courseButton);
  assert.equal(app.localStorage.writeAttempts, 1);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not save your workspace/
  );

  app.localStorage.failWrites = false;
  app.document.dispatchClick(courseButton);
  assert.equal(app.localStorage.writeAttempts, 2);
  assert.doesNotMatch(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not save your workspace/
  );
});

test("assignment selection retries after a transient quota failure", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{
        id: "assignment-1",
        title: "Final lab",
        dueAt: new Date(Date.now() + 2 * 86400000).toISOString()
      }]
    }]))
  });
  const assignmentButton = app.document.elements.get("todayView").children
    .find((button) => button.dataset.assignmentId === "assignment-1");
  app.localStorage.failWrites = true;

  app.document.dispatchClick(assignmentButton);
  assert.equal(app.localStorage.writeAttempts, 1);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not save your workspace/
  );

  app.localStorage.failWrites = false;
  app.document.dispatchClick(assignmentButton);
  assert.equal(app.localStorage.writeAttempts, 2);
  assert.doesNotMatch(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not save your workspace/
  );
});

test("a validated backup replaces corrupt v7 storage and restores normal saves", async () => {
  const corrupt = '{"schemaVersion":7';
  const v6Recovery = JSON.stringify([{ code: "LEGACY", name: "Recovery" }]);
  const app = runApp({ workspaceRaw: corrupt, legacyRaw: v6Recovery });
  await app.context.previewBackup({
    size: 100,
    text: async () => JSON.stringify(createWorkspace([editableCourse()]))
  });

  assert.equal(app.context.restoreBackup(), true);
  assert.equal(persistedWorkspace(app).courses[0].id, "course-1");
  assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), v6Recovery);
  assert.equal(app.context.saveWorkspace(), true);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /Backup restored/i
  );
});

test("clear replaces corrupt v7 storage, preserves v6, and restores normal saves", () => {
  const corrupt = JSON.stringify({ schemaVersion: 7, courses: "broken" });
  const v6Recovery = JSON.stringify([{ code: "LEGACY", name: "Recovery" }]);
  const app = runApp({ workspaceRaw: corrupt, legacyRaw: v6Recovery });

  app.context.requestClearWorkspace();
  assert.equal(app.context.clearWorkspaceAfterConfirmation(), true);
  assert.deepEqual(persistedWorkspace(app).courses, []);
  assert.equal(app.localStorage.getItem("classpilot-user-courses-v6"), v6Recovery);
  assert.equal(app.context.saveWorkspace(), true);
});

test("a failed corrupt-storage restore is transactional and remains retryable", async () => {
  const corrupt = '{"schemaVersion":7';
  const app = runApp({ workspaceRaw: corrupt });
  await app.context.previewBackup({
    size: 100,
    text: async () => JSON.stringify(createWorkspace([editableCourse()]))
  });
  app.localStorage.failWrites = true;

  assert.equal(app.context.restoreBackup(), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), corrupt);
  assert.equal(app.document.elements.get("restoreBackup").disabled, false);

  app.localStorage.failWrites = false;
  assert.equal(app.context.restoreBackup(), true);
  assert.equal(persistedWorkspace(app).courses[0].id, "course-1");
});

test("invalid routes fall back to Today and synchronize both navigations", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace()),
    hash: "#not-a-view"
  });
  const panels = app.document.querySelectorAll("[data-view-panel]");
  const navButtons = app.document.querySelectorAll("[data-view]");

  assert.equal(app.location.hash, "#today");
  assert.equal(panels.find((panel) => panel.dataset.viewPanel === "today").hidden, false);
  assert.equal(
    navButtons.filter((button) =>
      button.dataset.view === "today" &&
      button.getAttribute("aria-current") === "page"
    ).length,
    2
  );

  app.context.navigateToView("data");
  assert.equal(app.location.hash, "#data");
  assert.equal(panels.find((panel) => panel.dataset.viewPanel === "data").hidden, false);
  assert.equal(
    navButtons.filter((button) =>
      button.dataset.view === "data" &&
      button.getAttribute("aria-current") === "page"
    ).length,
    2
  );
});

test("dynamic course and assignment attributes remain data, not executable markup", () => {
  const courseId = 'course" onmouseover="alert(1)';
  const assignmentId = 'assignment" onfocus="alert(2)';
  const assignmentTitle = '<img src=x onerror="alert(3)">';
  const dueAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: courseId,
      code: "<b>CS101</b>",
      name: "Systems",
      assignments: [{
        id: assignmentId,
        title: assignmentTitle,
        dueAt,
        estimateMinutes: 60,
        nextAction: "Review <script>alert(4)</script>"
      }]
    }]))
  });
  const courseButton = app.document.elements.get("courseList").children[0];
  const assignmentButton = app.document.elements.get("todayView").children
    .find((button) => button.dataset.assignmentId !== undefined);
  const todayMarkup = app.document.elements.get("todayView").innerHTML;

  assert.equal(courseButton.dataset.courseId, courseId);
  assert.equal(courseButton.getAttribute("onmouseover"), null);
  assert.equal(assignmentButton.dataset.assignmentId, assignmentId);
  assert.equal(assignmentButton.getAttribute("onfocus"), null);
  assert.doesNotMatch(todayMarkup, /<img src=x/);
  assert.doesNotMatch(todayMarkup, /<script>alert/);
  assert.match(todayMarkup, /&lt;img src=x onerror=&quot;alert\(3\)&quot;&gt;/);
});

test("Today assignment activation renders the selected assignment in Courses", () => {
  const dueAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{
        id: "assignment-1",
        title: "<strong>Final lab</strong>",
        dueAt,
        points: "20 Points Possible",
        estimateMinutes: 90,
        nextAction: "Draft <one>",
        links: ['<img src=x onerror="alert(4)">'],
        status: {
          grading: "Graded",
          nextUp: "Review Feedback",
          attempt: "Attempt 1",
          score: "20/20",
          attemptsAllowed: "Unlimited Attempts Allowed",
          submission: "No submission",
          anonymousGrading: "No"
        },
        details: {
          requirements: ["Use <two> sources"],
          steps: [{ title: "Check <three>", done: false }]
        }
      }]
    }]))
  });
  const assignmentButton = app.document.elements.get("todayView").children
    .find((button) => button.dataset.assignmentId === "assignment-1");

  app.document.dispatchClick(assignmentButton);

  const detail = app.document.elements.get("courseWorkspace").innerHTML;
  assert.equal(app.document.elements.get("coursesView").hidden, false);
  assert.match(detail, /&lt;strong&gt;Final lab&lt;\/strong&gt;/);
  assert.ok(detail.includes(app.context.formatAbsoluteDeadline({ dueAt })));
  assert.match(detail, /Estimated 1 hr 30 min/);
  assert.match(detail, /<dt>Points<\/dt><dd>20 Points Possible<\/dd>/);
  assert.match(detail, /<dt>Score<\/dt><dd>20\/20<\/dd>/);
  assert.match(detail, /<dt>Status<\/dt><dd>Graded<\/dd>/);
  assert.match(detail, /<dt>Canvas next up<\/dt><dd>Review Feedback<\/dd>/);
  assert.match(detail, /<dt>Attempt<\/dt><dd>Attempt 1<\/dd>/);
  assert.match(detail, /<dt>Submission<\/dt><dd>No submission<\/dd>/);
  assert.match(detail, /<dt>Anonymous grading<\/dt><dd>No<\/dd>/);
  assert.match(
    detail,
    /<dt>Attempts allowed<\/dt><dd>Unlimited Attempts Allowed<\/dd>/
  );
  assert.match(detail, /<dt>Next action<\/dt><dd>Check &lt;three&gt;<\/dd>/);
  assert.match(detail, /Use &lt;two&gt; sources/);
  assert.match(detail, /Check &lt;three&gt;/);
  assert.doesNotMatch(detail, /<img src=x/);
  assert.match(detail, /&lt;img src=x onerror=&quot;alert\(4\)&quot;&gt;/);
  assert.match(app.document.elements.get("appStatus").textContent, /^Opened /);
});

test("This week excludes overdue work while Today still shows it in Now", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [
        {
          id: "old",
          title: "Months old overdue",
          dueAt: new Date(Date.now() - 60 * 86400000).toISOString()
        },
        {
          id: "soon",
          title: "Upcoming this week",
          dueAt: new Date(Date.now() + 2 * 86400000).toISOString()
        }
      ]
    }]))
  });
  const markup = app.document.elements.get("todayView").innerHTML;
  const thisWeekMarkup = markup.slice(markup.indexOf('id="thisWeekHeading"'));

  assert.match(markup, /Months old overdue/);
  assert.doesNotMatch(thisWeekMarkup, /Months old overdue/);
  assert.match(thisWeekMarkup, /Upcoming this week/);
});

test("Today renders accessible empty and populated Recently completed states", () => {
  const empty = runApp({
    now: "2026-07-22T09:00:00-07:00",
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{
        id: "active",
        title: "Active lab",
        dueDate: "Jul 25, 2026, 5:00 PM"
      }]
    }]))
  });
  const emptyMarkup = empty.document.elements.get("todayView").innerHTML;
  assert.match(
    emptyMarkup,
    /<section[^>]*aria-labelledby="recentlyCompletedHeading"/i
  );
  assert.match(emptyMarkup, /id="recentlyCompletedHeading">Recently completed/);
  assert.match(emptyMarkup, /No recently completed work yet/i);

  const populated = runApp({
    now: "2026-07-22T09:00:00-07:00",
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{
        id: "completed",
        title: "Completed lab",
        status: {
          completed: true,
          completedAt: "2026-07-21T18:00:00.000Z"
        }
      }, {
        id: "submitted",
        title: "Submitted paper",
        status: { submittedAt: "2026-07-22T15:00:00.000Z" }
      }, {
        id: "graded",
        title: "Graded quiz",
        status: { score: "18/20" }
      }]
    }]))
  });
  const populatedMarkup = populated.document.elements.get("todayView").innerHTML;
  assert.match(populatedMarkup, /Completed lab/);
  assert.match(populatedMarkup, /Submitted paper/);
  assert.match(populatedMarkup, /Graded quiz/);
  assert.match(populatedMarkup, />Completed</);
  assert.match(populatedMarkup, />Submitted</);
  assert.match(populatedMarkup, />Graded</);
  assert.match(populatedMarkup, /data-assignment-id="completed"/);
});

test("completing a checklist task advances the rendered Today next action", () => {
  const app = runApp({
    now: "2026-07-22T09:00:00-07:00",
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "CS101",
      name: "Systems",
      assignments: [{
        id: "lab",
        title: "Systems lab",
        dueDate: "Jul 25, 2026, 5:00 PM",
        details: {
          steps: ["Stale imported step"]
        },
        tasks: [
          { id: "outline", title: "Outline the report", done: false },
          { id: "draft", title: "Draft the report", done: false }
        ]
      }]
    }]))
  });

  assert.match(
    app.document.elements.get("todayView").innerHTML,
    /Next action<\/span> Outline the report/
  );
  assert.equal(
    app.context.setTaskCompletion(
      "course-1",
      "lab",
      "outline",
      true
    ),
    true
  );
  assert.match(
    app.document.elements.get("todayView").innerHTML,
    /Next action<\/span> Draft the report/
  );
  assert.equal(
    persistedWorkspace(app).courses[0].assignments[0].nextAction,
    "Draft the report"
  );
});

test("Today shows only approved priority labels and never a raw score", () => {
  const app = runApp({
    now: "2026-07-22T09:00:00-07:00",
    workspaceRaw: JSON.stringify(createWorkspace([{
      id: "course-1",
      code: "BUS501",
      name: "Business Strategy",
      assignments: [{
        id: "major",
        title: "Capstone analysis",
        dueDate: "2026-07-23T21:00:00-07:00",
        estimateMinutes: 600,
        points: "200 Points Possible",
        details: {
          requirements: ["Research", "Interview"],
          steps: ["Research", "Draft"]
        }
      }]
    }]))
  });
  const markup = app.document.elements.get("todayView").innerHTML;

  assert.match(markup, />Do next</);
  assert.doesNotMatch(markup, /priority score|priorityScore/i);
});

test("deadline signals use accurate due-now and just-over-24-hour wording", () => {
  const app = runApp({ workspaceRaw: JSON.stringify(createWorkspace()) });
  const now = new Date("2026-07-22T12:00:00.000Z");
  const exact = app.context.deadlineSignal({ dueAt: now.toISOString() }, now);
  const inTwentyFiveHours = app.context.deadlineSignal({
    dueAt: new Date(now.getTime() + 25 * 3600000).toISOString()
  }, now);

  assert.equal(exact.text, "Due now");
  assert.equal(inTwentyFiveHours.text, "Due in 25 hours");
});

test("fragment routing registers only one hashchange listener", () => {
  const app = runApp({ workspaceRaw: JSON.stringify(createWorkspace()) });
  assert.equal(app.listeners.hashchange?.length, 1);
  assert.equal(app.listeners.popstate?.length || 0, 0);
});

test("global and selected-course import entry points keep distinct course context", async () => {
  const bindCalls = [];
  const logicApi = {
    ...logic,
    bindDraftToCourse(draft, course) {
      bindCalls.push(course.id);
      return logic.bindDraftToCourse(draft, course);
    }
  };
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()])),
    logicApi
  });

  await app.document.elements.get("globalImportButton").click();
  assert.equal(app.document.elements.get("importDialog").open, true);
  assert.equal(app.document.elements.get("courseId").value, "");

  app.context.navigateToView("courses", { persist: false });
  const courseImport = app.document.elements.get("courseImportActions").children
    .find((button) => button.dataset.action === "open-import");
  assert.ok(courseImport);
  app.document.dispatchClick(courseImport);
  assert.equal(app.document.elements.get("courseId").value, "cs450");

  await app.context.processImport(researchText, "cs450");
  assert.deepEqual(bindCalls, ["cs450"]);
});

test("selected-course entry point rejects an unknown course without opening global import", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
  });
  app.context.openImportDialog();
  assert.equal(app.document.elements.get("importDialog").open, true);
  const staleEntry = new FakeElement(app.document);
  staleEntry.dataset.action = "open-import";
  staleEntry.dataset.courseId = "deleted-course";

  app.document.dispatchClick(staleEntry);

  assert.equal(app.document.elements.get("importDialog").open, false);
  assert.equal(app.document.elements.get("courseId").value, "");
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /selected course is no longer available.*choose the course again/i
  );
});

test("global uncertain import opens review without inheriting the active course", async () => {
  const bindCalls = [];
  const logicApi = {
    ...logic,
    bindDraftToCourse(draft, course) {
      bindCalls.push(course.id);
      return logic.bindDraftToCourse(draft, course);
    }
  };
  const workspaceRaw = JSON.stringify(createWorkspace([cs450Course()]));
  const app = runApp({ workspaceRaw, logicApi });

  await app.context.processImport(`
    Watch this vide0
    Due: Sat Jul 11, 2026 9:00am
    10 Points Possible
    NEXT UP: Submit Assignment
  `);

  assert.deepEqual(bindCalls, []);
  assert.equal(app.document.elements.get("importReview").hidden, false);
  assert.equal(app.document.elements.get("reviewCourseCode").value, "");
  assert.equal(app.document.elements.get("reviewCourseName").value, "");
  assert.equal(
    app.document.activeElement,
    app.document.elements.get("reviewCourseCode")
  );
  assert.equal(app.document.elements.get("analyzeImport").hidden, true);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.match(
    app.document.elements.get("importProgressDetail").textContent,
    /needs review/i
  );
});

test("invalid and ambiguous syllabus dates stay review-only without clearing schedules", async (t) => {
  const course = cs450Course();
  course.coursePlan = {
    syllabusUploaded: true,
    deadlines: [{ label: "Final Exam", date: "Dec 10, 2026", type: "exam" }],
    exams: [{ label: "Final Exam", date: "Dec 10, 2026", type: "exam" }]
  };
  const cases = [
    {
      name: "global invalid month",
      courseId: "",
      date: "13/01/2026",
      warning: /13\/01\/2026.*invalid/i
    },
    {
      name: "selected ambiguous no-year date",
      courseId: "cs450",
      date: "03/04",
      warning: /03\/04.*ambiguous/i
    },
    {
      name: "global invalid AM PM time",
      courseId: "",
      date: "Dec 10, 2026 at 13:00 PM",
      warning: /13:00 PM.*invalid/i
    },
    {
      name: "selected invalid 24-hour time",
      courseId: "cs450",
      date: "Dec 10, 2026 at 24:00",
      warning: /24:00.*invalid/i
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const workspaceRaw = JSON.stringify(createWorkspace([course]));
      const app = runApp({ workspaceRaw });
      const text = `
        CS450 Technology and Society Syllabus
        Semester and Year: Fall 2026
        Professor: Mina Patel
        COURSE GRADING POLICY
        Final Exam 100%
        WEEKLY COURSE GUIDE
        Week 15 Final
        Assignments:
        Final Exam due ${item.date}
      `;

      assert.equal(await app.context.processImport(text, item.courseId), false);
      assert.equal(
        app.localStorage.getItem("classpilot-workspace-v7"),
        workspaceRaw
      );
      assert.equal(
        app.document.elements.get("importReview").hidden,
        false
      );
      assert.match(
        app.document.elements.get("reviewEvidence").innerHTML,
        item.warning
      );

      assert.equal(await app.context.saveReviewedImport(), false);
      assert.equal(
        app.localStorage.getItem("classpilot-workspace-v7"),
        workspaceRaw
      );
      assert.match(
        app.document.elements.get("appStatus").textContent,
        /correct the syllabus date|re-import/i
      );
    });
  }
});

test("auto-save gate enforces confidence, warnings, and every required field", async (t) => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace())
  });
  const valid = {
    code: "CS450",
    name: "Technology and Society",
    sourceType: "Course material",
    assignment: "Research Paper",
    dueDate: "Mon Jun 22, 2026, 9:00 AM",
    confidence: 86,
    warnings: []
  };

  assert.equal(app.context.shouldAutoSaveDraft({
    ...valid,
    confidence: 85
  }), false);
  assert.equal(app.context.shouldAutoSaveDraft(valid), true);
  assert.equal(app.context.shouldAutoSaveDraft({
    ...valid,
    confidence: 100,
    warnings: ["Review the due date."]
  }), false);
  assert.equal(app.context.shouldAutoSaveDraft({
    ...valid,
    dueDate: "02/31/2026",
    confidence: 100
  }), false);

  for (const field of [
    "code",
    "name",
    "sourceType",
    "assignment",
    "dueDate"
  ]) {
    await t.test("missing " + field, () => {
      assert.equal(app.context.shouldAutoSaveDraft({
        ...valid,
        [field]: ""
      }), false);
    });
  }
});

test("invalid reviewed assignment dates stay in review and are not persisted", () => {
  const workspaceRaw = JSON.stringify(createWorkspace([cs450Course()]));
  const app = runApp({ workspaceRaw });
  app.context.renderImportReview({
    code: "CS450",
    name: "Technology and Society",
    sourceType: "Course material",
    assignment: "Impossible deadline",
    dueDate: "02/31/2026",
    confidence: 100,
    warnings: []
  });
  app.document.elements.get("courseId").value = "cs450";

  assert.equal(app.context.saveReviewedImport(), false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(
    app.document.activeElement,
    app.document.elements.get("reviewDueDate")
  );
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /valid due date/i
  );
});

test("course-bound research prompt saves every extracted assignment field in one submission", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
  });

  const saved = await app.context.processImport(researchText, "cs450");
  const persisted = JSON.parse(
    app.localStorage.getItem("classpilot-workspace-v7")
  );
  const course = persisted.courses[0];
  const assignment = course.assignments[0];

  assert.equal(saved, true);
  assert.equal(persisted.courses.length, 1);
  assert.equal(course.assignments.length, 1);
  assert.equal(course.id, "cs450");
  assert.equal(assignment.title, "Research Paper");
  assert.equal(assignment.dueDate, "Mon Jun 22, 2026, 9:00 AM");
  assert.equal(assignment.points, "50 Points Possible");
  assert.deepEqual(assignment.status, {
    late: true,
    grading: "Ungraded",
    submittedAt: "Jul 5, 2026, 12:51 PM",
    nextUp: "Review Feedback"
  });
  assert.deepEqual(assignment.links, [
    "https://www.zouantcha.com/blog/technology-whitepaper"
  ]);
  assert.ok(assignment.details.requirements.some(
    (item) => item === "Interview one finance or technology professional."
  ));
  assert.ok(assignment.details.deliverables.includes("Main Report (4-5 pages)"));
  assert.ok(assignment.details.steps.some(
    (item) => item.includes("required interviews or surveys")
  ));
  assert.ok(assignment.tasks.length > 0);
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /https:\/\/www\.zouantcha\.com\/blog\/technology-whitepaper/
  );
  assert.equal(app.location.hash, "#courses");
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /^Saved Research Paper in CS450 > Assignments\.$/
  );
});

test("course-bound syllabus and assignment remain in one selected course", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
  });

  assert.equal(await app.context.processImport(`
    CS450 Technology Strategy
    Syllabus
    Topics: AI collaboration, market analysis, stakeholder interviews
    Midterm exam due Jul 30.
    Office hours: Wednesday 2pm
  `, "cs450"), true);
  assert.equal(await app.context.processImport(researchText, "cs450"), true);

  const persisted = JSON.parse(
    app.localStorage.getItem("classpilot-workspace-v7")
  );
  assert.equal(persisted.courses.length, 1);
  assert.equal(persisted.courses[0].id, "cs450");
  assert.equal(persisted.courses[0].coursePlan.syllabusUploaded, true);
  assert.deepEqual(
    persisted.courses[0].assignments.map((assignment) => assignment.title),
    ["Research Paper"]
  );
});

test("a stale course-bound import never falls back to global course creation", async () => {
  const workspaceRaw = JSON.stringify(createWorkspace([cs450Course()]));
  const app = runApp({ workspaceRaw });

  const saved = await app.context.processImport(`
    BUS501 Business Strategy > Assignments > Case Study
    Due: Aug 10, 2026 11:59pm
    100 Points Possible
    Submit the case analysis
  `, "deleted-course");

  assert.equal(saved, false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(app.context.getActiveCourse().assignments.length, 0);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /selected course is no longer available/i
  );
});

test("OCR creates a worker with only literal same-origin local assets", async () => {
  const createWorkerCalls = [];
  let recognizeShortcutCalls = 0;
  let terminateCalls = 0;
  const progress = [];
  const worker = {
    async recognize() {
      return { data: { text: "Attend a seminar" } };
    },
    async terminate() {
      terminateCalls += 1;
    }
  };
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace()),
    tesseract: {
      OEM: { LSTM_ONLY: 1 },
      createWorker(...args) {
        createWorkerCalls.push(args);
        args[2].logger({ status: "recognizing text", progress: 0.5 });
        return Promise.resolve(worker);
      },
      recognize() {
        recognizeShortcutCalls += 1;
      }
    }
  });

  const operation = app.context.recognizeImage(
    { name: "seminar.png" },
    (value) => progress.push(value)
  );
  const text = await operation;

  assert.equal(text, "Attend a seminar");
  assert.equal(typeof operation.cancel, "function");
  assert.equal(typeof operation.terminate, "function");
  assert.equal(recognizeShortcutCalls, 0);
  assert.equal(terminateCalls, 1);
  assert.deepEqual(progress, [0.5]);
  assert.equal(createWorkerCalls.length, 1);
  assert.equal(createWorkerCalls[0][0], "eng");
  assert.equal(createWorkerCalls[0][1], 1);
  assert.deepEqual(
    {
      workerPath: createWorkerCalls[0][2].workerPath,
      corePath: createWorkerCalls[0][2].corePath,
      langPath: createWorkerCalls[0][2].langPath
    },
    {
      workerPath: "./vendor/tesseract/worker.min.js",
      corePath: "./vendor/tesseract/tesseract-core.wasm.js",
      langPath: "./vendor/tesseract"
    }
  );
});

test("OCR cancellation during worker creation terminates the eventual worker", async () => {
  let resolveWorker;
  let recognizeCalls = 0;
  let terminateCalls = 0;
  const worker = {
    async recognize() {
      recognizeCalls += 1;
      return { data: { text: "unexpected" } };
    },
    async terminate() {
      terminateCalls += 1;
    }
  };
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace()),
    tesseract: {
      OEM: { LSTM_ONLY: 1 },
      createWorker() {
        return new Promise((resolve) => {
          resolveWorker = resolve;
        });
      },
      recognize() {
        throw new Error("shortcut must not run");
      }
    }
  });

  const operation = app.context.recognizeImage({ name: "blocked.png" });
  const cleanup = operation.cancel();
  await assert.rejects(operation, { name: "AbortError" });
  resolveWorker(worker);
  await cleanup;

  assert.equal(recognizeCalls, 0);
  assert.equal(terminateCalls, 1);
});

test("OCR cancellation during recognition rejects immediately and terminates once", async () => {
  let recognitionStarted;
  let terminateCalls = 0;
  const started = new Promise((resolve) => {
    recognitionStarted = resolve;
  });
  const worker = {
    recognize() {
      recognitionStarted();
      return new Promise(() => {});
    },
    async terminate() {
      terminateCalls += 1;
    }
  };
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace()),
    tesseract: {
      OEM: { LSTM_ONLY: 1 },
      createWorker: async () => worker,
      recognize() {
        throw new Error("shortcut must not run");
      }
    }
  });

  const operation = app.context.recognizeImage({ name: "recognizing.png" });
  await started;
  const cleanup = operation.terminate();
  await assert.rejects(operation, { name: "AbortError" });
  await cleanup;

  assert.equal(terminateCalls, 1);
});

test("file import reports progress and cancellation aborts the active reader", async () => {
  let capturedSignal;
  let rejectRead;
  const fileReaderApi = {
    readImportFile(_file, options) {
      capturedSignal = options.signal;
      options.onProgress({
        stage: "reading",
        kind: "pdf",
        fileName: "course.pdf"
      });
      return new Promise((_resolve, reject) => {
        rejectRead = reject;
        options.signal.addEventListener("abort", () => {
          const error = new Error("Import cancelled.");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  };
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace()),
    fileReaderApi
  });

  app.context.openImportDialog();
  const importPromise = app.context.processImport({
    name: "course.pdf",
    type: "application/pdf",
    size: 128
  });
  assert.equal(capturedSignal.aborted, false);
  assert.equal(
    app.document.elements.get("analyzeImport").disabled,
    true
  );
  assert.match(
    app.document.elements.get("importProgressDetail").textContent,
    /course\.pdf/
  );

  await app.document.elements.get("cancelImport").click();
  await importPromise;
  assert.equal(capturedSignal.aborted, true);
  assert.equal(
    app.document.elements.get("analyzeImport").disabled,
    false
  );
  assert.equal(app.document.elements.get("importDialog").open, false);
  assert.equal(typeof rejectRead, "function");
});

test("every import stage remains visible across two browser frames", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()])),
    manualAnimationFrames: true
  });
  app.context.openImportDialog("cs450");

  let settled = false;
  const importPromise = app.context.processImport(researchText, "cs450")
    .then((saved) => {
      settled = true;
      return saved;
    });
  const stages = [
    "Reading pasted text (text).",
    "Extracting course and assignment details.",
    "Checking confidence, warnings, and required fields.",
    "Saved to CS450 > Assignments."
  ];

  for (const stage of stages) {
    assert.equal(
      app.document.elements.get("importProgressDetail").textContent,
      stage
    );
    assert.equal(app.pendingAnimationFrameCount(), 1);
    assert.equal(app.advanceAnimationFrame(), 1);
    assert.equal(
      app.document.elements.get("importProgressDetail").textContent,
      stage
    );
    assert.equal(app.document.elements.get("importDialog").open, true);
    assert.equal(settled, false);
    assert.equal(app.pendingAnimationFrameCount(), 1);
    assert.equal(app.advanceAnimationFrame(), 1);
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(await importPromise, true);
  assert.equal(app.document.elements.get("importDialog").open, false);
  assert.deepEqual(
    app.animationFrames.map((frame) => frame.progress),
    stages.flatMap((stage) => [stage, stage])
  );
  assert.deepEqual(
    app.animationFrames.slice(-2).map((frame) => frame.dialogOpen),
    [true, true]
  );
});

test("an older aborted import cannot clear or overwrite a newer import", async () => {
  const pendingReads = new Map();
  const fileReaderApi = {
    readImportFile(file, options) {
      options.onProgress({
        stage: "reading",
        kind: "text",
        fileName: file.name
      });
      return new Promise((resolve) => {
        pendingReads.set(file.name, { options, resolve });
      });
    }
  };
  const workspaceRaw = JSON.stringify(createWorkspace([cs450Course()]));
  const app = runApp({ workspaceRaw, fileReaderApi });
  const first = app.context.processImport({
    name: "first.txt",
    type: "text/plain",
    size: 10
  }, "cs450");
  const second = app.context.processImport({
    name: "second.txt",
    type: "text/plain",
    size: 10
  });

  pendingReads.get("first.txt").resolve({ kind: "text", text: researchText });
  assert.equal(await first, false);
  assert.equal(app.document.elements.get("analyzeImport").disabled, true);
  assert.match(
    app.document.elements.get("importProgressDetail").textContent,
    /second\.txt/
  );
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);

  pendingReads.get("second.txt").resolve({
    kind: "text",
    text: `
      Watch this vide0
      Due: Sat Jul 11, 2026 9:00am
      10 Points Possible
      NEXT UP: Submit Assignment
    `
  });
  assert.equal(await second, false);
  assert.equal(app.document.elements.get("analyzeImport").disabled, false);
  assert.equal(app.document.elements.get("importReview").hidden, false);
  assert.equal(app.document.elements.get("reviewAssignment").value, "Watch this video");
});

test("pasted text, selected files, and dropped files use the same import controller", async (t) => {
  await t.test("pasted text", async () => {
    const app = runApp({
      workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
    });
    app.context.openImportDialog("cs450");
    app.document.elements.get("importText").value = researchText;

    await app.document.elements.get("importForm").dispatch("submit");

    const persisted = JSON.parse(
      app.localStorage.getItem("classpilot-workspace-v7")
    );
    assert.equal(persisted.courses[0].assignments[0].title, "Research Paper");
  });

  await t.test("selected text file", async () => {
    const app = runApp({
      workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
    });
    app.context.openImportDialog("cs450");
    app.document.elements.get("importFile").files = [{
      name: "research.txt",
      type: "text/plain",
      size: researchText.length,
      text: async () => researchText
    }];

    await app.document.elements.get("importForm").dispatch("submit");

    const persisted = JSON.parse(
      app.localStorage.getItem("classpilot-workspace-v7")
    );
    assert.equal(persisted.courses[0].assignments[0].title, "Research Paper");
    assert.equal(
      persisted.courses[0].assignments[0].source.fileName,
      "research.txt"
    );
  });

  await t.test("dropped text file", async () => {
    const app = runApp({
      workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
    });
    app.context.openImportDialog("cs450");
    const file = {
      name: "drop.txt",
      type: "text/plain",
      size: researchText.length,
      text: async () => researchText
    };

    await app.document.elements.get("importDropZone").dispatch("drop", {
      dataTransfer: { files: [file] }
    });

    const persisted = JSON.parse(
      app.localStorage.getItem("classpilot-workspace-v7")
    );
    assert.equal(persisted.courses[0].assignments[0].title, "Research Paper");
    assert.equal(
      persisted.courses[0].assignments[0].source.fileName,
      "drop.txt"
    );
  });
});

test("global import groups by inferred identity instead of the active course", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([
      {
        id: "bus501",
        code: "BUS501",
        name: "Business",
        assignments: [],
        coursePlan: {}
      },
      cs450Course()
    ], {
      activeCourseId: "bus501"
    }))
  });

  const saved = await app.context.processImport(`
    CS450 Technology and Society > Assignments > Research Paper
    Due: Mon Jun 22, 2026 9:00am
    50 Points Possible
    Read the white paper
  `);
  const persisted = JSON.parse(
    app.localStorage.getItem("classpilot-workspace-v7")
  );
  const cs450 = persisted.courses.find((course) => course.id === "cs450");
  const business = persisted.courses.find((course) => course.id === "bus501");

  assert.equal(saved, true);
  assert.equal(persisted.courses.length, 2);
  assert.equal(cs450.assignments[0].title, "Research Paper");
  assert.equal(business.assignments.length, 0);
});

test("course tabs provide semantic panels and roving keyboard navigation", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
  });
  app.context.navigateToView("courses", { persist: false });
  const tablist = app.document.elements.get("courseTabs");

  assert.deepEqual(
    tablist.children.map(
      (button) => button.dataset.courseTab
    ),
    ["assignments", "syllabus", "coach"]
  );
  assert.equal(tablist.getAttribute("role"), "tablist");
  assert.deepEqual(
    tablist.children.map((button) => button.getAttribute("role")),
    ["tab", "tab", "tab"]
  );
  assert.deepEqual(
    tablist.children.map((button) => button.getAttribute("tabindex")),
    ["0", "-1", "-1"]
  );
  assert.deepEqual(
    tablist.children.map((button) => button.getAttribute("aria-controls")),
    [
      "course-panel-assignments",
      "course-panel-syllabus",
      "course-panel-coach"
    ]
  );
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /role="tabpanel"[^>]*id="course-panel-assignments"[^>]*aria-labelledby="course-tab-assignments"/
  );
  assert.equal(
    (
      app.document.elements.get("courseWorkspace").innerHTML
        .match(/role="tabpanel"/g) || []
    ).length,
    3
  );
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /id="course-panel-syllabus"[^>]*hidden/
  );
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /id="course-panel-coach"[^>]*hidden/
  );

  async function pressTabKey(key) {
    const current = tablist.children.find(
      (button) => button.getAttribute("aria-selected") === "true"
    );
    await tablist.dispatch("keydown", { key, target: current });
    return tablist.children.find(
      (button) => button.getAttribute("aria-selected") === "true"
    );
  }

  let selected = await pressTabKey("ArrowRight");
  assert.equal(selected.dataset.courseTab, "syllabus");
  assert.equal(selected.getAttribute("tabindex"), "0");
  assert.equal(app.document.activeElement, selected);
  assert.match(
    app.document.elements.get("courseWorkspace").innerHTML,
    /id="course-panel-syllabus"/
  );

  selected = await pressTabKey("End");
  assert.equal(selected.dataset.courseTab, "coach");
  selected = await pressTabKey("Home");
  assert.equal(selected.dataset.courseTab, "assignments");
  selected = await pressTabKey("ArrowLeft");
  assert.equal(selected.dataset.courseTab, "coach");
});

test("the Coach runtime loads before app.js and exposes the complete conversation controls", () => {
  const coachScript = html.indexOf('src="coach.js?v=16"');
  const appScript = html.indexOf('src="app.js?v=16"');
  assert.ok(coachScript > 0);
  assert.ok(appScript > coachScript);
  assert.match(html, /name="classpilot-coach-endpoint"/);
  assert.match(appSource, /buildCoachContext/);
  assert.match(appSource, /createThreadStore/);
  assert.match(appSource, /coachQuickActionButton\("explain"/);
  assert.match(appSource, /coachQuickActionButton\("check"/);
  assert.match(appSource, /coachQuickActionButton\("plan"/);
  assert.match(appSource, /data-coach-form/);
  assert.match(appSource, /data-coach-stop/);
  assert.match(appSource, /data-coach-clear/);
  assert.match(appSource, /data-coach-language/);
  assert.match(appSource, /Selected course context is sent only when you ask/);
});

test("opening Coach from an assignment preserves that exact assignment context", () => {
  const course = editableCourse();
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });

  app.context.openAssignmentCoach(course.id, course.assignments[0].id);
  const markup = app.document.elements.get("courseWorkspace").innerHTML;
  assert.match(markup, /Final lab/);
  assert.match(markup, /2026-08-01 17:00/);
  assert.match(markup, /Ask about Final lab/);
  assert.match(markup, /Build the system/);
  assert.match(markup, /Live AI not connected/);
});

test("mock Coach conversations are clearly labeled and separated by assignment", async () => {
  const course = editableCourse();
  course.assignments.push({
    ...course.assignments[0],
    id: "assignment-2",
    title: "Second lab"
  });
  const app = runApp({
    search: "?coach=mock",
    workspaceRaw: JSON.stringify(createWorkspace([course]))
  });

  await app.context.submitCoachQuestion(
    course,
    course.assignments[0],
    "What should I do first?",
    "plan"
  );
  await app.context.submitCoachQuestion(
    course,
    course.assignments[1],
    "Check the second lab.",
    "check"
  );

  const first = JSON.parse(app.localStorage.getItem(
    "classpilot.coach.v1:course-1:assignment-1"
  ));
  const second = JSON.parse(app.localStorage.getItem(
    "classpilot.coach.v1:course-1:assignment-2"
  ));
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.match(first[1].text, /Mock mode/);
  assert.equal(first[1].mode, "mock");
  assert.doesNotMatch(JSON.stringify(first), /Second lab/);
});

test("click, Enter, and Space focus the replacement active course tab", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
  });
  app.context.navigateToView("courses", { persist: false });
  const tablist = app.document.elements.get("courseTabs");

  function selectedTab() {
    return tablist.children.find(
      (button) => button.getAttribute("aria-selected") === "true"
    );
  }

  const clicked = tablist.children.find(
    (button) => button.dataset.courseTab === "syllabus"
  );
  clicked.focus();
  app.document.dispatchClick(clicked);
  let replacement = selectedTab();
  assert.notEqual(replacement, clicked);
  assert.equal(replacement.dataset.courseTab, "syllabus");
  assert.equal(app.document.activeElement, replacement);

  const entered = replacement;
  await tablist.dispatch("keydown", { key: "Enter", target: entered });
  replacement = selectedTab();
  assert.notEqual(replacement, entered);
  assert.equal(replacement.dataset.courseTab, "syllabus");
  assert.equal(app.document.activeElement, replacement);

  const spaced = tablist.children.find(
    (button) => button.dataset.courseTab === "coach"
  );
  spaced.focus();
  await tablist.dispatch("keydown", { key: " ", target: spaced });
  replacement = selectedTab();
  assert.notEqual(replacement, spaced);
  assert.equal(replacement.dataset.courseTab, "coach");
  assert.equal(app.document.activeElement, replacement);
});

test("review associates escaped field-relevant evidence and warnings", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace())
  });

  app.context.renderImportReview({
    code: "<img src=x onerror=alert(1)>",
    name: "AI",
    sourceType: "Canvas assignment page",
    assignment: "Paper",
    dueDate: "",
    warnings: ["Due date is missing. <script>alert(2)</script>"],
    evidence: [
      {
        label: "Course",
        value: "AI <em>Strategy</em>",
        source: "Uploaded material"
      },
      {
        label: "Due date",
        value: "Not found <b>here</b>",
        source: "Uploaded material"
      }
    ],
    assignmentDetails: {}
  });

  const describedBy = app.document.elements.get("reviewDueDate")
    .getAttribute("aria-describedby");
  const courseDescribedBy = app.document.elements.get("reviewCourseName")
    .getAttribute("aria-describedby");
  const evidenceMarkup = app.document.elements.get("reviewEvidence").innerHTML;
  assert.match(describedBy, /review-due-date-details/);
  assert.match(courseDescribedBy, /review-course-name-details/);
  assert.equal(
    app.document.activeElement,
    app.document.elements.get("reviewDueDate")
  );
  assert.doesNotMatch(evidenceMarkup, /<script>|<b>here<\/b>|<img/i);
  assert.match(evidenceMarkup, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(evidenceMarkup, /Not found &lt;b&gt;here&lt;\/b&gt;/);
});

test("low-confidence review moves focus before hiding Analyze", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace())
  });
  app.context.openImportDialog();
  app.document.elements.get("analyzeImport").focus();

  app.context.renderImportReview({
    code: "CS450",
    name: "Technology and Society",
    sourceType: "Course material",
    assignment: "Research Paper",
    dueDate: "Mon Jun 22, 2026, 9:00 AM",
    confidence: 50,
    warnings: [],
    evidence: [],
    assignmentDetails: {}
  });

  assert.equal(app.document.elements.get("analyzeImport").hidden, true);
  assert.equal(
    app.document.activeElement,
    app.document.elements.get("reviewCourseCode")
  );
});

test("dialogs return focus to the command that opened them", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  const opener = app.document.elements.get("headerImportButton");
  installFakeEditorControls(app, "assignmentForm", [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ]);
  installFakeEditorControls(app, "coursePlanForm", [
    "courseId",
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]);

  app.context.openImportDialog("", opener);
  app.context.cancelImport();
  assert.equal(app.document.activeElement, opener);

  app.context.openAssignmentEditor("course-1", "assignment-1", opener);
  app.document.elements.get("assignmentDialog").close();
  assert.equal(app.document.activeElement, opener);

  app.context.openCoursePlanEditor("course-1", opener);
  app.document.elements.get("coursePlanDialog").close();
  assert.equal(app.document.activeElement, opener);

  app.context.requestClearWorkspace(opener);
  app.document.elements.get("confirmationDialog").close();
  assert.equal(app.document.activeElement, opener);
});

test("successful assignment save restores focus to the replacement edit command", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  installFakeEditorControls(app, "assignmentForm", [
    "courseId",
    "assignmentId",
    "assignmentTitle",
    "assignmentDueDate",
    "assignmentPoints",
    "assignmentStatus",
    "assignmentEstimate",
    "assignmentRequirements",
    "assignmentDeliverables",
    "assignmentSteps"
  ]);
  const assignmentTarget = new FakeElement(app.document);
  assignmentTarget.dataset.courseId = "course-1";
  assignmentTarget.dataset.assignmentId = "assignment-1";
  assert.equal(app.context.selectAssignment(assignmentTarget), true);
  const opener = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editAssignment !== undefined
  );

  assert.ok(opener);
  assert.equal(
    app.context.openAssignmentEditor(
      "course-1",
      "assignment-1",
      opener
    ),
    true
  );
  assert.equal(app.context.submitAssignmentEdit(), true);
  const replacement = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editAssignment !== undefined
  );
  assert.ok(replacement);
  assert.notEqual(replacement, opener);
  assert.equal(opener.isConnected, false);
  assert.equal(replacement.isConnected, true);
  assert.equal(app.document.activeElement, replacement);
  assert.equal(app.document.focusHistory.includes(opener), false);
});

test("successful course-plan save restores focus to the top action replacement", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  installFakeEditorControls(app, "coursePlanForm", [
    "courseId",
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]);
  app.context.navigateToView("courses", { persist: false });
  app.context.activateCourseTab("syllabus");
  const opener = app.document.elements.get("courseImportActions").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );
  const sibling = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );

  assert.ok(opener);
  assert.ok(sibling);
  assert.ok(opener.dataset.focusKey);
  assert.notEqual(opener.dataset.focusKey, sibling.dataset.focusKey);
  assert.equal(app.context.openCoursePlanEditor("course-1", opener), true);
  assert.equal(app.context.submitCoursePlanEdit(), true);
  const replacement = app.document.elements.get("courseImportActions").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );
  const siblingReplacement = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );
  assert.ok(replacement);
  assert.ok(siblingReplacement);
  assert.notEqual(replacement, opener);
  assert.equal(replacement.dataset.focusKey, opener.dataset.focusKey);
  assert.equal(opener.isConnected, false);
  assert.equal(replacement.isConnected, true);
  assert.equal(app.document.activeElement, replacement);
  assert.notEqual(app.document.activeElement, siblingReplacement);
  assert.equal(app.document.focusHistory.includes(opener), false);
});

test("successful course-plan save restores focus to the Syllabus panel replacement", () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([editableCourse()]))
  });
  installFakeEditorControls(app, "coursePlanForm", [
    "courseId",
    "courseCode",
    "courseName",
    "coursePlanTerm",
    "coursePlanProfessor",
    "coursePlanMeeting",
    "coursePlanOfficeHours",
    "coursePlanEmail"
  ]);
  app.context.navigateToView("courses", { persist: false });
  app.context.activateCourseTab("syllabus");
  const sibling = app.document.elements.get("courseImportActions").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );
  const opener = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );

  assert.ok(sibling);
  assert.ok(opener);
  assert.ok(opener.dataset.focusKey);
  assert.notEqual(opener.dataset.focusKey, sibling.dataset.focusKey);
  assert.equal(app.context.openCoursePlanEditor("course-1", opener), true);
  assert.equal(app.context.submitCoursePlanEdit(), true);
  const siblingReplacement = app.document.elements.get("courseImportActions").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );
  const replacement = app.document.elements.get("courseWorkspace").children.find(
    (button) => button.dataset.editCoursePlan !== undefined
  );
  assert.ok(siblingReplacement);
  assert.ok(replacement);
  assert.notEqual(replacement, opener);
  assert.equal(replacement.dataset.focusKey, opener.dataset.focusKey);
  assert.equal(opener.isConnected, false);
  assert.equal(replacement.isConnected, true);
  assert.equal(app.document.activeElement, replacement);
  assert.notEqual(app.document.activeElement, siblingReplacement);
  assert.equal(app.document.focusHistory.includes(opener), false);
});

test("successful course-bound import skips detached opener and focuses its result", async () => {
  const app = runApp({
    workspaceRaw: JSON.stringify(createWorkspace([cs450Course()]))
  });
  app.context.navigateToView("courses", { persist: false });
  const opener = app.document.elements.get("courseImportActions").children.find(
    (button) => button.dataset.action === "open-import"
  );

  assert.ok(opener);
  assert.equal(app.context.openImportDialog("cs450", opener), true);
  assert.equal(await app.context.processImport(researchText, "cs450"), true);
  const replacement = app.document.elements.get("courseImportActions").children.find(
    (button) => button.dataset.action === "open-import"
  );
  assert.ok(replacement);
  assert.notEqual(replacement, opener);
  assert.equal(opener.isConnected, false);
  assert.equal(replacement.isConnected, true);
  assert.equal(
    app.document.activeElement,
    app.document.elements.get("mainWorkspace")
  );
  assert.equal(app.document.focusHistory.includes(opener), false);
});

test("dynamic Lucide icons are hidden from assistive technology", () => {
  assert.match(
    appSource,
    /createIcons\(\s*\{\s*attrs:\s*\{[^}]*"aria-hidden":\s*"true"[^}]*focusable:\s*"false"/s
  );
});

test("compact course tools use labeled Lucide icon commands", () => {
  assert.match(
    appSource,
    /data-edit-course-plan[^>]*aria-label="Edit course details"[^>]*title="Edit course details"[^>]*>\s*'?\s*\+?\s*'<i data-lucide="pencil"/s
  );
});

test("failed import persistence restores workspace and keeps review open", async () => {
  const workspaceRaw = JSON.stringify(createWorkspace([cs450Course()]));
  const app = runApp({ workspaceRaw });
  app.localStorage.failWrites = true;
  app.context.openImportDialog("cs450");

  const saved = await app.context.processImport(researchText, "cs450");

  assert.equal(saved, false);
  assert.equal(app.localStorage.getItem("classpilot-workspace-v7"), workspaceRaw);
  assert.equal(app.context.getActiveCourse().assignments.length, 0);
  assert.equal(app.document.elements.get("importReview").hidden, false);
  assert.equal(app.document.elements.get("importDialog").open, true);
  assert.match(
    app.document.elements.get("appStatus").textContent,
    /Browser storage could not save your workspace/
  );
  assert.doesNotMatch(
    app.document.elements.get("appStatus").textContent,
    /^Saved /
  );
});
