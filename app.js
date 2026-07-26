"use strict";

const {
  buildCalendarItems,
  buildTodayQueue,
  createIcsCalendar,
  createEmptyWorkspace,
  createWorkspaceSnapshot,
  enrichWorkspacePlanningFields,
  migrateLegacyCourses,
  parseDueAt,
  parseWorkspaceBackup,
  removeAssignment,
  removeWorkspaceCourse,
  restoreWorkspaceSnapshot,
  serializeWorkspaceBackup,
  normalizeWorkspace,
  updateCourse,
  updateAssignment
} = window.ClassPilotPlanner;
const {
  bindDraftToCourse,
  buildAssignmentCoach,
  buildCourseCoach,
  createCourseDraftFromMaterial,
  hasMeaningfulScore,
  parseStructuredEnglishDate,
  upsertCourseFromDraft
} = window.ClassPilotLogic;
const { readImportFile } = window.ClassPilotFileReaders;
const {
  buildSourceCatalog,
  findSourceRecord
} = window.ClassPilotSourceEvidence;
const {
  buildCoachContext,
  coachThreadKey,
  createThreadStore,
  createCoachClient
} = window.ClassPilotCoach;

const WORKSPACE_KEY = "classpilot-workspace-v7";
const LEGACY_KEY = "classpilot-user-courses-v6";
const VALID_VIEWS = ["today", "courses", "calendar", "data"];
const NAV_ITEMS = [
  ["today", "circle-dot", "Today"],
  ["courses", "book-open", "Courses"],
  ["calendar", "calendar-days", "Calendar"],
  ["data", "database", "Data"]
];
const COURSE_COLORS = ["#376f92", "#16766f", "#c95545", "#705b8f", "#c79419"];
const COACH_QUICK_ACTIONS = {
  explain: "Explain this assignment and show me the exact requirements.",
  chat: "What should I do next?",
  check: "Check which requirements I still need to complete.",
  plan: "Make a practical plan for completing this work."
};
const coachEndpoint = document
  .querySelector('meta[name="classpilot-coach-endpoint"]')
  ?.getAttribute("content")
  ?.trim() || "";
const coachMockMode = /(?:^|[?&])coach=mock(?:&|$)/i.test(
  String(window.location.search || "")
);

const elements = {
  appNav: document.querySelector("#appNav"),
  appStatus: document.querySelector("#appStatus"),
  assignmentDialog: document.querySelector("#assignmentDialog"),
  assignmentForm: document.querySelector("#assignmentForm"),
  backupPreview: document.querySelector("#backupPreview"),
  calendarView: document.querySelector("#calendarView"),
  calendarAgenda: document.querySelector("#calendarAgenda"),
  calendarCourseFilter: document.querySelector("#calendarCourseFilter"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarTypeFilter: document.querySelector("#calendarTypeFilter"),
  clearWorkspace: document.querySelector("#clearWorkspace"),
  confirmationDialog: document.querySelector("#confirmationDialog"),
  courseImportActions: document.querySelector("#courseImportActions"),
  courseList: document.querySelector("#courseList"),
  coursePlanDialog: document.querySelector("#coursePlanDialog"),
  coursePlanForm: document.querySelector("#coursePlanForm"),
  courseTabs: document.querySelector("#courseTabs"),
  courseWorkspace: document.querySelector("#courseWorkspace"),
  coursesView: document.querySelector("#coursesView"),
  dataView: document.querySelector("#dataView"),
  dataSummary: document.querySelector("#dataSummary"),
  exportBackup: document.querySelector("#exportBackup"),
  exportCalendar: document.querySelector("#exportCalendar"),
  globalImportButton: document.querySelector("#globalImportButton"),
  headerImportButton: document.querySelector("#headerImportButton"),
  importDropZone: document.querySelector("#importDropZone"),
  importDialog: document.querySelector("#importDialog"),
  importDialogTitle: document.querySelector("#importDialogTitle"),
  importFile: document.querySelector("#importFile"),
  importForm: document.querySelector("#importForm"),
  importBackup: document.querySelector("#importBackup"),
  importProgress: document.querySelector("#importProgress"),
  importProgressDetail: document.querySelector("#importProgressDetail"),
  importReview: document.querySelector("#importReview"),
  importText: document.querySelector("#importText"),
  mainWorkspace: document.querySelector("#mainWorkspace"),
  mobileNav: document.querySelector(".mobile-nav"),
  reviewEvidence: document.querySelector("#reviewEvidence"),
  saveImportReview: document.querySelector("#saveImportReview"),
  restoreBackup: document.querySelector("#restoreBackup"),
  analyzeImport: document.querySelector("#analyzeImport"),
  cancelImport: document.querySelector("#cancelImport"),
  todayView: document.querySelector("#todayView"),
  taskDialog: document.querySelector("#taskDialog"),
  taskForm: document.querySelector("#taskForm"),
  undoToast: document.querySelector("#undoToast"),
  undatedItems: document.querySelector("#undatedItems"),
  lastBackup: document.querySelector("#lastBackup"),
  viewEyebrow: document.querySelector("#viewEyebrow"),
  viewTitle: document.querySelector("#viewTitle")
};

const state = {
  activeCourseTab: "assignments",
  activeView: "today",
  calendarCursor: new Date(),
  calendarTypeFilter: "all",
  assignmentFilters: new Map(),
  selectedCalendarDate: "",
  selectedAssignmentId: "",
  storageAvailable: true,
  storageRecoveryRequired: false
};

let workspace;
let importController;
let activeOcrOperation;
let pendingImportDraft;
let importCourseId = "";
let undoState;
let undoTimer;
let pendingBackup;
let backupPreviewOperation = 0;
let clearWorkspaceConfirmationPending = false;
let coachThreadStore;
let activeCoachRequest;
const coachViewStates = new Map();
const dialogOpeners = new WeakMap();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitReviewLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitEditableLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function editorControl(form, name) {
  return form.elements?.namedItem?.(name) || form.elements?.[name] || null;
}

function editorValue(form, name) {
  return editorControl(form, name)?.value || "";
}

function findAssignment(courseId, assignmentId) {
  return workspace.courses.find((course) => course.id === courseId)
    ?.assignments?.find((assignment) => assignment.id === assignmentId) || null;
}

function commitWorkspace(nextWorkspace, options = {}) {
  const previousWorkspace = workspace;
  workspace = nextWorkspace;
  if (!saveWorkspace({
    allowStorageRecovery: options.allowStorageRecovery === true
  })) {
    workspace = previousWorkspace;
    return false;
  }
  if (options.invalidateUndo !== false) invalidateUndo();
  if (options.render !== false) renderAll();
  return true;
}

function persistWorkspacePreferences(patch) {
  const previousWorkspace = workspace;
  const nextWorkspace = normalizeWorkspace(workspace);
  nextWorkspace.preferences = {
    ...nextWorkspace.preferences,
    ...clone(patch)
  };
  workspace = nextWorkspace;
  if (!saveWorkspace()) {
    workspace = previousWorkspace;
    return false;
  }
  invalidateUndo();
  return true;
}

function showStatus(message, tone = "info") {
  if (!elements.appStatus) return;
  elements.appStatus.textContent = message;
  elements.appStatus.classList.toggle("is-success", tone === "success");
  elements.appStatus.classList.toggle("is-warn", tone === "warn");
}

function reportStorageFailure(action, error) {
  console.error("ClassPilot browser storage " + action + " failed.", error);
  const guidance = action === "load" || state.storageRecoveryRequired
    ? " The stored value was left unchanged. Restore a backup or clear the workspace before editing."
    : " Keep this tab open, free browser storage, then try again. You can still export a backup.";
  showStatus("Browser storage could not " + action + " your workspace." + guidance, "warn");
}

function parseCurrentWorkspace(raw, now) {
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== 7
  ) {
    throw new Error("Stored workspace is not a valid version 7 workspace.");
  }
  return enrichWorkspacePlanningFields(parseWorkspaceBackup(raw), now);
}

function parseLegacyCourses(raw) {
  if (raw === null) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Legacy course storage must contain a course list.");
  }
  return parsed;
}

function loadWorkspace() {
  const now = new Date();
  try {
    const current = localStorage.getItem(WORKSPACE_KEY);
    if (current !== null) {
      const loaded = parseCurrentWorkspace(current, now);
      state.storageAvailable = true;
      state.storageRecoveryRequired = false;
      return loaded;
    }

    const legacyValue = localStorage.getItem(LEGACY_KEY);
    const legacyCourses = parseLegacyCourses(legacyValue);
    const migrated = enrichWorkspacePlanningFields(
      migrateLegacyCourses(legacyCourses, now),
      now
    );
    const serializedMigrated = JSON.stringify(migrated);

    parseCurrentWorkspace(serializedMigrated, now);
    localStorage.setItem(WORKSPACE_KEY, serializedMigrated);
    const verifiedValue = localStorage.getItem(WORKSPACE_KEY);
    if (verifiedValue === null) {
      throw new Error("The migrated workspace could not be read back.");
    }
    const loaded = parseCurrentWorkspace(verifiedValue, now);
    state.storageAvailable = true;
    state.storageRecoveryRequired = false;
    return loaded;
  } catch (error) {
    state.storageAvailable = false;
    state.storageRecoveryRequired = true;
    reportStorageFailure("load", error);
    return createEmptyWorkspace(now);
  }
}

function saveWorkspace(options = {}) {
  if (
    state.storageRecoveryRequired &&
    options.allowStorageRecovery !== true
  ) {
    reportStorageFailure(
      "save",
      new Error("Stored version 7 data must be restored or cleared first.")
    );
    return false;
  }
  try {
    const now = new Date();
    const nextWorkspace = enrichWorkspacePlanningFields(workspace, now);
    nextWorkspace.metadata.updatedAt = now.toISOString();
    const serialized = JSON.stringify(nextWorkspace);
    localStorage.setItem(WORKSPACE_KEY, serialized);
    const verifiedValue = localStorage.getItem(WORKSPACE_KEY);
    if (verifiedValue === null) {
      throw new Error("The saved workspace could not be read back.");
    }
    workspace = parseCurrentWorkspace(verifiedValue, now);
    state.storageAvailable = true;
    state.storageRecoveryRequired = false;
    return true;
  } catch (error) {
    state.storageAvailable = false;
    reportStorageFailure("save", error);
    return false;
  }
}

function refreshIcons() {
  window.lucide?.createIcons({
    attrs: {
      "aria-hidden": "true",
      focusable: "false"
    }
  });
}

function focusIdentityFor(element) {
  if (!element) return null;
  if (element.dataset?.focusKey) {
    return {
      selector: "[data-focus-key]",
      values: { focusKey: element.dataset.focusKey }
    };
  }
  if (element.id) return { id: element.id };
  const identities = [
    ["editAssignment", "[data-edit-assignment]", ["courseId", "assignmentId"]],
    ["editCoursePlan", "[data-edit-course-plan]", ["courseId"]],
    ["action", "[data-action]", ["action", "courseId"]]
  ];
  for (const [marker, selector, keys] of identities) {
    if (element.dataset?.[marker] === undefined) continue;
    return {
      selector,
      values: Object.fromEntries(keys.map((key) => [
        key,
        element.dataset[key] || ""
      ]))
    };
  }
  return null;
}

function resolveFocusIdentity(identity) {
  if (!identity) return null;
  if (identity.id) return document.querySelector("#" + identity.id);
  return Array.from(document.querySelectorAll(identity.selector)).find(
    (element) => Object.entries(identity.values).every(
      ([key, value]) => (element.dataset[key] || "") === value
    )
  ) || null;
}

function showDialog(dialog, opener) {
  const focusTarget = opener || document.activeElement;
  if (focusTarget?.focus) {
    dialogOpeners.set(dialog, {
      identity: focusIdentityFor(focusTarget),
      node: focusTarget
    });
  }
  if (typeof dialog.showModal === "function" && !dialog.open) {
    dialog.showModal();
  }
}

function restoreDialogFocus(dialog) {
  const opener = dialogOpeners.get(dialog);
  dialogOpeners.delete(dialog);
  if (!opener) return;
  const replacement = resolveFocusIdentity(opener.identity);
  const focusTarget = replacement?.isConnected
    ? replacement
    : opener.node?.isConnected
      ? opener.node
      : null;
  focusTarget?.focus?.();
}

function suppressDialogFocusReturn(dialog) {
  dialogOpeners.delete(dialog);
}

function normalizedView(value) {
  const view = String(value || "").replace(/^#/, "").toLowerCase();
  return VALID_VIEWS.includes(view) ? view : "today";
}

function routeFromHash() {
  const hashView = String(window.location.hash || "").replace(/^#/, "");
  if (hashView) return normalizedView(hashView);
  return normalizedView(workspace?.preferences?.activeView);
}

function renderNavigation() {
  const markup = NAV_ITEMS.map(([view, icon, label]) => (
    '<button type="button" data-view="' + view + '" aria-label="Open ' +
      label + '" title="Open ' + label + '">' +
      '<i data-lucide="' + icon + '" aria-hidden="true"></i>' +
      "<span>" + label + "</span>" +
    "</button>"
  )).join("");

  elements.appNav.innerHTML = markup;
  elements.mobileNav.innerHTML = markup;
  refreshIcons();
}

function courseColor(index) {
  return COURSE_COLORS[index % COURSE_COLORS.length];
}

function renderCourseRail() {
  if (workspace.courses.length === 0) {
    elements.courseList.innerHTML =
      '<p class="empty-state">No courses yet. Open Courses to begin setting up your workspace.</p>';
    return;
  }

  elements.courseList.innerHTML = workspace.courses.map((course, index) => {
    const selected = course.id === workspace.preferences.activeCourseId;
    const assignmentCount = Array.isArray(course.assignments)
      ? course.assignments.length
      : 0;
    const code = course.code || "Course";
    const name = course.name || "Untitled course";
    return (
      '<button class="course-button' + (selected ? " active" : "") + '"' +
        ' type="button" data-select-course data-course-id="' +
        escapeHtml(course.id) + '"' +
        ' style="--course-color: ' + courseColor(index) + '"' +
        ' aria-current="' + (selected ? "true" : "false") + '">' +
        '<span class="course-code">' + escapeHtml(code) + "</span>" +
        "<span>" + escapeHtml(name) + "</span>" +
        '<span class="course-meta">' + assignmentCount +
          " assignment" + (assignmentCount === 1 ? "" : "s") + "</span>" +
      "</button>"
    );
  }).join("");
}

function getActiveCourse() {
  return workspace.courses.find(
    (course) => course.id === workspace.preferences.activeCourseId
  ) || workspace.courses[0] || null;
}

function formatEstimate(estimateMinutes) {
  const minutes = Math.max(0, Number(estimateMinutes) || 0);
  if (minutes < 60) return "Estimated " + minutes + " min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return "Estimated " + hours + " hr" +
    (remainder ? " " + remainder + " min" : "");
}

function formatAbsoluteDeadline(item) {
  if (!item.dueAt) return item.dueDate || "No due date";
  const due = new Date(item.dueAt);
  if (!Number.isFinite(due.getTime())) return item.dueDate || "No due date";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(due);
}

function deadlineSignal(item, now = new Date()) {
  if (!item.dueAt) {
    return { className: "is-undated", text: "Needs a due date" };
  }

  const due = new Date(item.dueAt).getTime();
  if (!Number.isFinite(due)) {
    return { className: "is-undated", text: "Needs a due date" };
  }

  const deltaMs = due - now.getTime();
  const absoluteHours = Math.max(1, Math.ceil(Math.abs(deltaMs) / 3600000));
  if (deltaMs === 0) {
    return { className: "is-due-soon", text: "Due now" };
  }
  if (deltaMs < 0) {
    return {
      className: "is-overdue",
      text: "Overdue by " + formatRelativeHours(absoluteHours)
    };
  }
  if (deltaMs <= 24 * 3600000) {
    return {
      className: "is-due-soon",
      text: "Due soon - " + formatRelativeHours(absoluteHours) + " left"
    };
  }
  return {
    className: "is-planned",
    text: "Due in " + formatRelativeHours(absoluteHours)
  };
}

function formatRelativeHours(hours) {
  if (hours <= 48) return hours + " hour" + (hours === 1 ? "" : "s");
  const days = Math.ceil(hours / 24);
  return days + " day" + (days === 1 ? "" : "s");
}

function priorityBandLabel(value) {
  return {
    "do-now": "Do now",
    "do-next": "Do next",
    planned: "Planned"
  }[value] || "Planned";
}

function renderFocusItem(item, position) {
  const signal = deadlineSignal(item);
  const remainingMinutes = item.estimatedRemainingMinutes ??
    item.estimateMinutes;
  return (
    '<button class="focus-item ' + signal.className + '" type="button"' +
      ' data-course-id="' + escapeHtml(item.courseId) + '"' +
      ' data-assignment-id="' + escapeHtml(item.id) + '">' +
      '<span class="focus-position">' + escapeHtml(position) + "</span>" +
      '<span class="focus-content">' +
        '<span class="assignment-kicker">' +
          escapeHtml(item.courseCode || "Course") + "</span>" +
        "<strong>" + escapeHtml(item.title) + "</strong>" +
        '<span class="priority-band priority-' +
          escapeHtml(item.priorityBand || "planned") + '">' +
          escapeHtml(priorityBandLabel(item.priorityBand)) + "</span>" +
        '<span class="focus-deadline">' + escapeHtml(signal.text) +
          " | " + escapeHtml(formatAbsoluteDeadline(item)) + "</span>" +
        '<span class="focus-estimate">' +
          escapeHtml(formatEstimate(remainingMinutes)) + " remaining</span>" +
        '<span class="focus-next"><span>Next action</span> ' +
          escapeHtml(item.nextAction || "Review the assignment requirements") +
        "</span>" +
      "</span>" +
      '<i data-lucide="chevron-right" aria-hidden="true"></i>' +
    "</button>"
  );
}

function renderQueueGroup(items, emptyMessage, positionPrefix) {
  if (items.length === 0) {
    return '<p class="empty-state light">' + emptyMessage + "</p>";
  }
  return items.map((item, index) =>
    renderFocusItem(item, positionPrefix + (index + 1))
  ).join("");
}

function renderRecentlyCompleted(items) {
  const assignments = Array.isArray(items) ? items : [];
  const content = assignments.length === 0
    ? '<p class="empty-state light">No recently completed work yet.</p>'
    : '<ul class="recent-completed-list">' + assignments.map((item) => (
      "<li>" +
        '<button type="button" class="recent-completed-item"' +
          ' data-course-id="' + escapeHtml(item.courseId) + '"' +
          ' data-assignment-id="' + escapeHtml(item.id) + '">' +
          "<span><strong>" + escapeHtml(item.title || "Untitled assignment") +
          "</strong><small>" +
          escapeHtml(item.courseCode || item.courseName || "Course") +
          "</small></span>" +
          '<span class="completion-status">' +
          escapeHtml(item.completionLabel || "Completed") + "</span>" +
        "</button>" +
      "</li>"
    )).join("") + "</ul>";
  return (
    '<section class="focus-group recently-completed"' +
      ' aria-labelledby="recentlyCompletedHeading">' +
      '<h2 id="recentlyCompletedHeading">Recently completed</h2>' +
      content +
    "</section>"
  );
}

function renderFocusRail(queue) {
  return (
    '<div class="focus-rail">' +
      '<section class="focus-group focus-now" aria-labelledby="nowHeading">' +
        '<h2 id="nowHeading">Now</h2>' +
        renderFocusItem(queue.now, "1") +
      "</section>" +
      '<section class="focus-group" aria-labelledby="upNextHeading">' +
        '<h2 id="upNextHeading">Up next</h2>' +
        renderQueueGroup(queue.upNext, "Nothing else is waiting.", "") +
      "</section>" +
      '<section class="focus-group" aria-labelledby="thisWeekHeading">' +
        '<h2 id="thisWeekHeading">This week</h2>' +
        renderQueueGroup(
          queue.thisWeek,
          "No dated assignments are due in the next seven days.",
          ""
        ) +
      "</section>" +
      renderRecentlyCompleted(queue.recentlyCompleted) +
    "</div>"
  );
}

function renderEmptyToday() {
  const hasCourses = workspace.courses.length > 0;
  return (
    '<section class="empty-state light today-empty">' +
      "<h2>" + (hasCourses ? "No active assignments" : "Start with your courses") +
      "</h2>" +
      "<p>" + (hasCourses
        ? "Your saved courses have no active work. Open Courses to review them."
        : "Set up a course first, then Today will organize its assignments by urgency.") +
      "</p>" +
      '<button type="button" class="primary-action" data-action="open-courses">' +
        '<i data-lucide="book-open" aria-hidden="true"></i>' +
        "<span>Open Courses</span>" +
      "</button>" +
    "</section>"
  );
}

function upcomingThisWeek(items, now) {
  const start = now.getTime();
  const end = start + 7 * 86400000;
  return items.filter((item) => {
    const due = new Date(item.dueAt).getTime();
    return Number.isFinite(due) && due >= start && due <= end;
  });
}

function renderToday() {
  const now = new Date();
  const queue = buildTodayQueue(workspace, now);
  queue.thisWeek = upcomingThisWeek(queue.thisWeek, now);
  elements.todayView.innerHTML = queue.now
    ? renderFocusRail(queue)
    : renderEmptyToday() + renderRecentlyCompleted(queue.recentlyCompleted);
  refreshIcons();
}

function assignmentDetailItemText(item) {
  if (typeof item === "string") return item;
  return item?.title || item?.label || item?.text || "";
}

function renderAssignmentDetailList(items, emptyMessage) {
  const values = (Array.isArray(items) ? items : [])
    .map(assignmentDetailItemText)
    .filter(Boolean);
  if (values.length === 0) {
    return '<p class="empty-state light">' + emptyMessage + "</p>";
  }
  return "<ul>" + values.map((value) =>
    "<li>" + escapeHtml(value) + "</li>"
  ).join("") + "</ul>";
}

function renderAssignmentTasks(course, assignment) {
  const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : [];
  if (tasks.length === 0) {
    return '<p class="empty-state light">No checklist tasks are recorded for this assignment.</p>';
  }
  return "<ul>" + tasks.map((task) => {
    const title = assignmentDetailItemText(task) || "Untitled task";
    const target = "task: " + title;
    return (
      "<li>" +
        '<label><input type="checkbox" data-task-id="' +
          escapeHtml(task.id) + '" data-course-id="' +
          escapeHtml(course.id) + '" data-assignment-id="' +
          escapeHtml(assignment.id) + '" aria-label="Mark ' +
          escapeHtml(target) + ' complete"' +
          (task.done ? " checked" : "") + ">" +
          escapeHtml(title) + "</label>" +
        '<button type="button" data-edit-task data-task-id="' +
          escapeHtml(task.id) + '" data-course-id="' +
          escapeHtml(course.id) + '" data-assignment-id="' +
          escapeHtml(assignment.id) + '" data-focus-key="task-edit-' +
          escapeHtml(course.id) + "-" + escapeHtml(assignment.id) + "-" +
          escapeHtml(task.id) + '" aria-label="Edit ' +
          escapeHtml(target) + '" title="Edit ' + escapeHtml(target) + '">' +
          '<i data-lucide="pencil" aria-hidden="true"></i></button>' +
        '<button type="button" data-delete-task data-task-id="' +
          escapeHtml(task.id) + '" data-course-id="' +
          escapeHtml(course.id) + '" data-assignment-id="' +
          escapeHtml(assignment.id) + '" aria-label="Delete ' +
          escapeHtml(target) + '" title="Delete ' + escapeHtml(target) + '">' +
          '<i data-lucide="trash-2" aria-hidden="true"></i></button>' +
      "</li>"
    );
  }).join("") + "</ul>";
}

function renderAssignmentMetadata(assignment) {
  const status = assignment.status && typeof assignment.status === "object"
    ? assignment.status
    : {};
  const rows = [
    ["Due", formatAbsoluteDeadline(assignment)],
    ["Points", assignment.points],
    ["Score", hasMeaningfulScore(status.score) ? status.score : ""],
    ["Status", assignmentStatusLabel(assignment)],
    ["Canvas next up", status.nextUp],
    ["Attempt", status.attempt],
    ["Submission", status.submission],
    ["Anonymous grading", status.anonymousGrading],
    ["Attempts allowed", status.attemptsAllowed],
    ["Estimate", formatEstimate(assignment.estimateMinutes)],
    [
      "Next action",
      assignment.nextAction || "Review the assignment requirements"
    ]
  ].filter(([, value]) => String(value || "").trim());

  return "<dl>" + rows.map(([label, value]) =>
    "<div><dt>" + escapeHtml(label) + "</dt><dd>" +
      escapeHtml(value) + "</dd></div>"
  ).join("") + "</dl>";
}

function renderSelectedAssignmentDetail(course, assignment) {
  const requirements = assignment.details?.requirements || [];
  const deliverables = assignment.details?.deliverables || [];
  const steps = assignment.details?.steps || assignment.tasks || [];
  return (
    '<article class="selected-assignment-detail" data-selected-assignment="true">' +
      '<p class="assignment-kicker">' +
        escapeHtml(course.code || course.name || "Course") + "</p>" +
      "<h2>" + escapeHtml(assignment.title || "Untitled assignment") + "</h2>" +
      renderAssignmentMetadata(assignment) +
      '<section aria-labelledby="selectedLinksHeading">' +
        '<h3 id="selectedLinksHeading">Source links</h3>' +
        renderAssignmentDetailList(
          assignment.links,
          "No source links are recorded for this assignment."
        ) +
      "</section>" +
      '<section aria-labelledby="selectedRequirementsHeading">' +
        '<h3 id="selectedRequirementsHeading">Requirements</h3>' +
        renderAssignmentDetailList(
          requirements,
          "No requirements are recorded for this assignment."
        ) +
      "</section>" +
      '<section aria-labelledby="selectedStepsHeading">' +
        '<h3>Deliverables</h3>' +
        renderAssignmentDetailList(
          deliverables,
          "No deliverables are recorded for this assignment."
        ) +
        '<h3 id="selectedStepsHeading">Steps</h3>' +
        renderAssignmentDetailList(
          steps,
          "No completion steps are recorded for this assignment."
        ) +
      "</section>" +
      '<section aria-labelledby="selectedTasksHeading">' +
        '<h3 id="selectedTasksHeading">Checklist</h3>' +
        renderAssignmentTasks(course, assignment) +
      "</section>" +
      '<div class="dialog-actions">' +
        '<button type="button" class="primary-action" data-open-coach' +
          ' data-course-id="' + escapeHtml(course.id) + '" data-assignment-id="' +
          escapeHtml(assignment.id) + '">' +
          '<i data-lucide="message-circle" aria-hidden="true"></i>' +
          "<span>Ask Coach</span></button>" +
        '<button type="button" data-edit-assignment data-course-id="' +
          escapeHtml(course.id) + '" data-assignment-id="' +
          escapeHtml(assignment.id) + '">Edit assignment</button>' +
        '<button type="button" data-delete-assignment data-course-id="' +
          escapeHtml(course.id) + '" data-assignment-id="' +
          escapeHtml(assignment.id) + '" aria-label="Delete assignment: ' +
          escapeHtml(assignment.title || "Untitled assignment") + '" title="Delete assignment: ' +
          escapeHtml(assignment.title || "Untitled assignment") + '">' +
          '<i data-lucide="trash-2" aria-hidden="true"></i></button>' +
      "</div>" +
    "</article>"
  );
}

function renderCourseTabs() {
  const tabs = [
    ["assignments", "Assignments"],
    ["syllabus", "Syllabus"],
    ["coach", "Coach"]
  ];
  elements.courseTabs.setAttribute("role", "tablist");
  elements.courseTabs.innerHTML = tabs.map(([value, label]) => (
    '<button id="course-tab-' + value + '" type="button" role="tab"' +
      ' data-course-tab="' + value + '"' +
      ' aria-controls="course-panel-' + value + '"' +
      ' aria-selected="' + (state.activeCourseTab === value ? "true" : "false") +
      '" tabindex="' + (state.activeCourseTab === value ? "0" : "-1") +
      '">' + label + "</button>"
  )).join("");
}

function renderCoursePanel(content) {
  elements.courseWorkspace.innerHTML = [
    "assignments",
    "syllabus",
    "coach"
  ].map((tab) => (
    '<section role="tabpanel" id="course-panel-' + tab + '"' +
      ' aria-labelledby="course-tab-' + tab + '"' +
      (tab === state.activeCourseTab ? "" : " hidden") + ">" +
      (tab === state.activeCourseTab ? content : "") +
    "</section>"
  )).join("");
}

function assignmentFilterState(courseId) {
  if (!state.assignmentFilters.has(courseId)) {
    state.assignmentFilters.set(courseId, {
      search: "",
      status: "all"
    });
  }
  return state.assignmentFilters.get(courseId);
}

function assignmentMatchesSearch(assignment, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [
    assignment.title,
    assignment.category,
    assignment.dueDate,
    assignment.points
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

function assignmentStatusLabel(assignment) {
  return {
    active: "Active",
    late: "Late",
    submitted: "Submitted",
    completed: "Completed",
    graded: "Graded"
  }[assignmentStatusValue(assignment)] || "Active";
}

function renderAssignmentList(course) {
  const assignments = Array.isArray(course.assignments)
    ? course.assignments
    : [];
  const filters = assignmentFilterState(course.id);
  const filtered = assignments.filter((assignment) =>
    assignmentMatchesSearch(assignment, filters.search) &&
    (
      filters.status === "all" ||
      assignmentStatusValue(assignment) === filters.status
    )
  );
  const statusOptions = [
    ["all", "All statuses"],
    ["active", "Active"],
    ["late", "Late"],
    ["submitted", "Submitted"],
    ["completed", "Completed"],
    ["graded", "Graded"]
  ];
  const emptyMessage = assignments.length === 0
    ? "No assignments have been imported for this course."
    : "No assignments match this search and status filter.";
  const results = filtered.length === 0
    ? '<p class="empty-state light assignment-results-empty">' +
      emptyMessage + "</p>"
    : '<div class="assignment-list">' + filtered.map((assignment) => (
      '<button type="button" class="assignment-row"' +
        ' data-course-id="' + escapeHtml(course.id) + '"' +
        ' data-assignment-id="' + escapeHtml(assignment.id) + '">' +
        "<span><strong>" + escapeHtml(assignment.title) + "</strong>" +
          "<span>" + escapeHtml(
            (assignment.category || "Assignment") + " | " +
            assignmentStatusLabel(assignment)
          ) + "</span></span>" +
        "<span>" + escapeHtml(assignment.dueDate || "No date") + "</span>" +
      "</button>"
    )).join("") + "</div>";
  return (
    '<section aria-labelledby="courseAssignmentsHeading">' +
      '<p class="assignment-kicker">' +
        escapeHtml(course.code || "Course") + "</p>" +
      '<h2 id="courseAssignmentsHeading">' +
        escapeHtml(course.name || course.code || "Course") + "</h2>" +
      '<div class="assignment-toolbar" role="search"' +
        ' aria-label="Filter assignments in ' +
        escapeHtml(course.code || course.name || "selected course") + '">' +
        '<label for="assignmentSearch">Search assignments' +
          '<input id="assignmentSearch" type="search"' +
            ' data-assignment-search data-course-id="' +
            escapeHtml(course.id) + '" value="' +
            escapeHtml(filters.search) + '" aria-label="Search assignments in ' +
            escapeHtml(course.code || course.name || "selected course") + '">' +
        "</label>" +
        '<label for="assignmentStatusFilter">Status' +
          '<select id="assignmentStatusFilter"' +
            ' data-assignment-status-filter data-course-id="' +
            escapeHtml(course.id) + '" aria-label="Filter assignments by status">' +
            statusOptions.map(([value, label]) => (
              '<option value="' + value + '"' +
                (filters.status === value ? " selected" : "") + ">" +
                label + "</option>"
            )).join("") +
          "</select>" +
        "</label>" +
      "</div>" +
      '<div class="assignment-results" aria-live="polite">' + results + "</div>" +
    "</section>"
  );
}

function handleAssignmentFilterChange(event) {
  const search = event.target.closest("[data-assignment-search]");
  const status = event.target.closest("[data-assignment-status-filter]");
  const control = search || status;
  if (!control) return false;
  const course = workspace.courses.find(
    (item) => item.id === control.dataset.courseId
  );
  if (!course) return false;
  const filters = assignmentFilterState(course.id);
  if (search) filters.search = String(search.value || "");
  if (status) {
    const nextStatus = String(status.value || "all");
    filters.status = [
      "all",
      "active",
      "late",
      "submitted",
      "completed",
      "graded"
    ].includes(nextStatus) ? nextStatus : "all";
  }
  const selectionStart = search?.selectionStart;
  renderCoursesView();
  refreshIcons();
  const selector = search
    ? "[data-assignment-search]"
    : "[data-assignment-status-filter]";
  const replacement = Array.from(
    elements.courseWorkspace.querySelectorAll(selector)
  ).find((item) => item.dataset.courseId === course.id);
  replacement?.focus();
  if (
    search &&
    Number.isInteger(selectionStart) &&
    typeof replacement?.setSelectionRange === "function"
  ) {
    replacement.setSelectionRange(selectionStart, selectionStart);
  }
  return true;
}

function renderCoursePlanList(items, emptyMessage) {
  const values = Array.isArray(items) ? items : [];
  if (values.length === 0) {
    return '<p class="empty-state light">' + escapeHtml(emptyMessage) + "</p>";
  }
  return "<ul>" + values.map((item) => {
    const text = typeof item === "string"
      ? item
      : [item.label || item.week, item.date || item.topic || item.text]
          .filter(Boolean)
          .join(": ");
    return "<li>" + escapeHtml(text) + "</li>";
  }).join("") + "</ul>";
}

function renderSyllabus(course) {
  const plan = course.coursePlan || {};
  return (
    '<section aria-labelledby="courseSyllabusHeading">' +
      '<p class="assignment-kicker">' + escapeHtml(course.code || "Course") +
      "</p>" +
      '<h2 id="courseSyllabusHeading">Syllabus</h2>' +
      "<h3>Course profile</h3>" +
      "<p>" + escapeHtml([
        plan.term,
        plan.professor,
        plan.section,
        plan.modality
      ].filter(Boolean).join(" | ") || "No course profile has been imported.") +
      "</p>" +
      "<h3>Deadlines</h3>" +
      renderCoursePlanList(plan.deadlines, "No syllabus deadlines are recorded.") +
      "<h3>Exams</h3>" +
      renderCoursePlanList(plan.exams, "No exams are recorded.") +
      "<h3>Policies</h3>" +
      renderCoursePlanList(plan.policies, "No policies are recorded.") +
      '<div class="dialog-actions">' +
        '<button type="button" data-edit-course-plan data-course-id="' +
          escapeHtml(course.id) + '" data-focus-key="course-plan-syllabus-' +
          escapeHtml(course.id) + '">Edit course details</button>' +
      "</div>" +
    "</section>"
  );
}

function renderCoach(course) {
  const assignment = (course.assignments || []).find(
    (item) => item.id === state.selectedAssignmentId
  );
  const localGuidance = assignment
    ? buildAssignmentCoach(course, assignment, workspace.preferences.language)
    : buildCourseCoach(course, workspace.preferences.language);
  const priorities = [
    ...(localGuidance.mustDo || []),
    ...(localGuidance.nextSteps || localGuidance.priorities ||
      localGuidance.studyFocus || [])
  ].slice(0, 8);
  const assignmentId = assignment?.id || "";
  const threadKey = coachThreadKey(course.id, assignmentId);
  const messages = coachThreadStore?.get(course.id, assignmentId) || [];
  const viewState = coachViewStates.get(threadKey) || {};
  const language = ["en", "zh", "bilingual"].includes(workspace.preferences.language)
    ? workspace.preferences.language
    : "en";
  const contextLabel = assignment
    ? assignment.title || "Current assignment"
    : course.name || course.code || "Course guidance";
  const connectionLabel = coachMockMode
    ? "Mock mode"
    : coachEndpoint ? "Live AI connected" : "Live AI not connected";
  const connectionClass = coachMockMode
    ? "is-mock"
    : coachEndpoint ? "is-live" : "is-offline";
  const transcript = messages.length
    ? messages.map((message) => renderCoachMessage(message, course.id, assignmentId)).join("")
    : '<div class="coach-empty">' +
        '<p class="coach-empty-label">Start with the work in front of you</p>' +
        "<p>" + escapeHtml(localGuidance.summary || localGuidance.title || "") + "</p>" +
        renderAssignmentDetailList(
          priorities,
          "Import course material to receive local planning guidance."
        ) +
      "</div>";
  return (
    '<section class="coach-workspace" aria-labelledby="courseCoachHeading">' +
      '<header class="coach-header">' +
        "<div>" +
          '<p class="assignment-kicker">' + escapeHtml(course.code || "Course") + "</p>" +
          '<h2 id="courseCoachHeading">Coach</h2>' +
          '<p class="coach-context-label">Ask about ' + escapeHtml(contextLabel) + "</p>" +
        "</div>" +
        '<span class="coach-connection ' + connectionClass + '">' +
          escapeHtml(connectionLabel) + "</span>" +
      "</header>" +
      (assignment
        ? '<dl class="coach-context-strip">' +
            "<div><dt>Assignment</dt><dd>" + escapeHtml(assignment.title || "Untitled") + "</dd></div>" +
            "<div><dt>Due</dt><dd>" + escapeHtml(assignment.dueDate || "No date") + "</dd></div>" +
            "<div><dt>Points</dt><dd>" + escapeHtml(assignment.points || "Not listed") + "</dd></div>" +
          "</dl>"
        : '<p class="coach-course-context">Course-level guidance uses only this course\'s syllabus summary.</p>') +
      '<div class="coach-quick-actions" role="group" aria-label="Coach quick questions">' +
        coachQuickActionButton("explain", "list-checks", "Explain assignment") +
        coachQuickActionButton("chat", "arrow-right", "What next?") +
        coachQuickActionButton("check", "scan-search", "Check requirements") +
        coachQuickActionButton("plan", "calendar-clock", "Make a plan") +
      "</div>" +
      '<div class="coach-transcript" aria-live="polite" aria-label="Coach conversation">' +
        transcript +
      "</div>" +
      (viewState.error
        ? '<p class="coach-request-status is-error" role="alert">' + escapeHtml(viewState.error) + "</p>"
        : viewState.pending
          ? '<p class="coach-request-status" role="status">Coach is reading this assignment...</p>'
          : "") +
      '<form class="coach-composer" data-coach-form>' +
        '<label class="coach-language">Language' +
          '<select data-coach-language name="coachLanguage" aria-label="Coach response language">' +
            coachLanguageOption("en", "English", language) +
            coachLanguageOption("zh", "中文", language) +
            coachLanguageOption("bilingual", "Bilingual", language) +
          "</select></label>" +
        '<label class="coach-question"><span class="visually-hidden">Question for Coach</span>' +
          '<textarea name="coachQuestion" maxlength="4000" required' +
            ' aria-label="Question for Coach" placeholder="Ask about ' +
            escapeHtml(contextLabel) + '"></textarea></label>' +
        '<div class="coach-composer-actions">' +
          '<button type="submit" class="primary-action"' +
            (viewState.pending ? " disabled" : "") + ' aria-label="Send question to Coach">' +
            '<i data-lucide="send" aria-hidden="true"></i><span>Send</span></button>' +
          '<button type="button" data-coach-stop' +
            (viewState.pending ? "" : " hidden") +
            ' aria-label="Stop Coach response" title="Stop Coach response">' +
            '<i data-lucide="square" aria-hidden="true"></i></button>' +
          '<button type="button" data-coach-clear' +
            (messages.length ? "" : " disabled") +
            ' aria-label="Clear this Coach conversation" title="Clear this Coach conversation">' +
            '<i data-lucide="trash-2" aria-hidden="true"></i></button>' +
        "</div>" +
      "</form>" +
      '<p class="coach-privacy"><i data-lucide="shield-check" aria-hidden="true"></i>' +
        "Selected course context is sent only when you ask. Conversations stay in this browser." +
      "</p>" +
      (!coachEndpoint && !coachMockMode
        ? '<p class="coach-setup-note">Live AI requires the secure Coach backend. No API key belongs in this browser.</p>'
        : coachMockMode
          ? '<p class="coach-setup-note">Mock responses are deterministic test guidance, not live AI.</p>'
          : "") +
    "</section>"
  );
}

function coachQuickActionButton(action, icon, label) {
  return '<button type="button" data-coach-action="' + action + '">' +
    '<i data-lucide="' + icon + '" aria-hidden="true"></i><span>' +
    escapeHtml(label) + "</span></button>";
}

function coachLanguageOption(value, label, selected) {
  return '<option value="' + value + '"' +
    (value === selected ? " selected" : "") + ">" + label + "</option>";
}

function renderCoachMessage(message, courseId = "", assignmentId = "") {
  const assistant = message.role === "assistant";
  const evidence = assistant && Array.isArray(message.evidence) && message.evidence.length
    ? '<div class="coach-evidence"><strong>Based on your course material</strong><ul>' +
        message.evidence.map((item) => (
          item.sourceId
            ? '<li><button type="button" class="coach-citation" data-coach-source-id="' +
                escapeHtml(item.sourceId) + '" data-course-id="' + escapeHtml(courseId) +
                '" data-assignment-id="' + escapeHtml(assignmentId) + '">' +
                '<span class="coach-citation-label">' + escapeHtml(item.label) + "</span>" +
                (item.location
                  ? '<span class="coach-citation-location">' + escapeHtml(item.location) + "</span>"
                  : "") +
                '<span class="coach-citation-excerpt">' +
                  escapeHtml(item.excerpt || item.text) + "</span></button></li>"
            : "<li><span>" + escapeHtml(item.label) + "</span>" +
                escapeHtml(item.excerpt || item.text) + "</li>"
        )).join("") + "</ul></div>"
    : "";
  const nextSteps = assistant && Array.isArray(message.nextSteps) && message.nextSteps.length
    ? '<div class="coach-next-steps"><strong>Next steps</strong><ol>' +
        message.nextSteps.map((item) => "<li><span>" + escapeHtml(item) + "</span>" +
          (assignmentId
            ? '<button type="button" class="coach-add-task" data-add-coach-task' +
                ' data-course-id="' + escapeHtml(courseId) + '" data-assignment-id="' +
                escapeHtml(assignmentId) + '" data-task-title="' + escapeHtml(item) +
                '" aria-label="Add this Coach step to assignment tasks">' +
                '<i data-lucide="plus" aria-hidden="true"></i><span>Add task</span></button>'
            : "") + "</li>").join("") +
      "</ol></div>"
    : "";
  const mode = assistant && message.mode === "mock"
    ? '<span class="coach-message-mode">Mock</span>'
    : "";
  return '<article class="coach-message ' + (assistant ? "is-assistant" : "is-user") + '">' +
    '<header><strong>' + (assistant ? "ClassPilot Coach" : "You") + "</strong>" + mode + "</header>" +
    '<p class="coach-message-text">' + escapeHtml(message.text) + "</p>" +
    evidence + nextSteps +
  "</article>";
}

function coachTarget(course) {
  const assignment = (course.assignments || []).find(
    (item) => item.id === state.selectedAssignmentId
  ) || null;
  return {
    assignment,
    assignmentId: assignment?.id || "",
    threadKey: coachThreadKey(course.id, assignment?.id || "")
  };
}

function renderCoachIfActive(courseId, assignmentId) {
  const activeCourse = getActiveCourse();
  if (
    state.activeView !== "courses" ||
    state.activeCourseTab !== "coach" ||
    activeCourse?.id !== courseId ||
    (state.selectedAssignmentId || "") !== (assignmentId || "")
  ) {
    return;
  }
  renderCoursesView();
  refreshIcons();
}

function buildLocalMockCoachResponse(course, assignment, action, sourceCatalog = []) {
  const language = workspace.preferences.language || "en";
  const guidance = assignment
    ? buildAssignmentCoach(course, assignment, language)
    : buildCourseCoach(course, language);
  const detailRequirements = assignment?.details?.requirements || [];
  const evidence = sourceCatalog
    .filter((source) => assignment
      ? source.id.startsWith("assignment:" + assignment.id + ":")
      : source.id.startsWith("course:" + course.id + ":"))
    .filter((source) => !assignment || ["requirement", "rubric", "deadline"].includes(source.kind))
    .slice(0, 3)
    .map((source) => ({
      sourceId: source.id,
      label: source.title,
      excerpt: source.text,
      location: source.location
    }));
  const guidanceSteps = guidance.nextSteps || guidance.priorities || guidance.studyFocus || [];
  const actionLead = {
    explain: "The uploaded material has been organized into requirements and deliverables.",
    check: "Compare your current work with every requirement below.",
    plan: "Work through the next steps in order and mark each one complete.",
    chat: "Start with the first incomplete step, then check the original instructions again."
  }[action] || "Use the uploaded instructions as your source of truth.";
  return {
    answer: "Mock mode: " + (guidance.summary || guidance.title || actionLead) + " " + actionLead,
    evidence,
    nextSteps: guidanceSteps.slice(0, 5),
    missingInformation: detailRequirements.length || !assignment
      ? []
      : ["No assignment requirements were detected."],
    usage: { inputTokens: 0, outputTokens: 0 },
    mode: "mock"
  };
}

async function submitCoachQuestion(course, assignment, question, action = "chat") {
  const text = String(question || "").trim().slice(0, 4000);
  if (!course || !text || !coachThreadStore) return false;
  const assignmentId = assignment?.id || "";
  const threadKey = coachThreadKey(course.id, assignmentId);
  coachThreadStore.append(course.id, assignmentId, {
    role: "user",
    text,
    timestamp: new Date().toISOString()
  });
  const controller = new AbortController();
  activeCoachRequest?.controller?.abort();
  activeCoachRequest = { controller, threadKey };
  coachViewStates.set(threadKey, { pending: true, error: "" });
  renderCoachIfActive(course.id, assignmentId);

  try {
    const sourceCatalog = buildSourceCatalog(course, assignment);
    const context = buildCoachContext(
      course,
      assignment,
      workspace.preferences.language || "en",
      action,
      sourceCatalog
    );
    const messages = coachThreadStore.get(course.id, assignmentId);
    const response = coachMockMode
      ? await Promise.resolve(buildLocalMockCoachResponse(
          course,
          assignment,
          action,
          sourceCatalog
        ))
      : await createCoachClient({ endpoint: coachEndpoint }).send({
          context,
          messages,
          signal: controller.signal
        });
    if (controller.signal.aborted) return false;
    coachThreadStore.append(course.id, assignmentId, {
      role: "assistant",
      text: response.answer,
      evidence: response.evidence,
      nextSteps: response.nextSteps,
      missingInformation: response.missingInformation,
      mode: response.mode,
      timestamp: new Date().toISOString()
    });
    coachViewStates.set(threadKey, { pending: false, error: "" });
    showStatus(
      response.mode === "mock"
        ? "Mock Coach response generated for interface testing."
        : "Coach response received.",
      response.mode === "mock" ? "info" : "success"
    );
    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      coachViewStates.set(threadKey, { pending: false, error: "Coach response stopped." });
      return false;
    }
    coachViewStates.set(threadKey, {
      pending: false,
      error: error?.message || "The AI Coach could not complete this request."
    });
    showStatus(error?.message || "The AI Coach could not complete this request.", "warn");
    return false;
  } finally {
    if (activeCoachRequest?.threadKey === threadKey) activeCoachRequest = undefined;
    renderCoachIfActive(course.id, assignmentId);
  }
}

function openAssignmentCoach(courseId, assignmentId) {
  const course = workspace.courses.find((item) => item.id === courseId);
  const assignment = course?.assignments?.find((item) => item.id === assignmentId);
  if (!course || !assignment) return false;
  if (!persistWorkspacePreferences({
    activeCourseId: course.id,
    activeView: "courses"
  })) {
    return false;
  }
  state.activeCourseTab = "coach";
  state.selectedAssignmentId = assignment.id;
  renderCourseRail();
  navigateToView("courses", { persist: false });
  showStatus("Coach is using " + assignment.title + " from " +
    (course.code || course.name || "the selected course") + ".");
  return true;
}

function handleCoachFormSubmit(event) {
  const form = event.target.closest?.("[data-coach-form]") || event.currentTarget;
  if (!form?.matches?.("[data-coach-form]") && !form?.dataset?.coachForm) return;
  event.preventDefault();
  const course = getActiveCourse();
  if (!course) return;
  const assignment = coachTarget(course).assignment;
  const questionControl = form.elements?.namedItem?.("coachQuestion") ||
    form.querySelector?.('[name="coachQuestion"]');
  const question = questionControl?.value || "";
  if (!question.trim()) return;
  questionControl.value = "";
  void submitCoachQuestion(course, assignment, question, "chat");
}

function handleCoachLanguageChange(event) {
  const select = event.target.closest("[data-coach-language]");
  if (!select) return false;
  const language = ["en", "zh", "bilingual"].includes(select.value)
    ? select.value
    : "en";
  if (!persistWorkspacePreferences({ language })) {
    select.value = workspace.preferences.language || "en";
    return true;
  }
  renderCoursesView();
  refreshIcons();
  return true;
}

function askCoachQuickQuestion(action) {
  const course = getActiveCourse();
  if (!course) return false;
  const assignment = coachTarget(course).assignment;
  return submitCoachQuestion(
    course,
    assignment,
    COACH_QUICK_ACTIONS[action] || COACH_QUICK_ACTIONS.chat,
    action
  );
}

function stopCoachResponse() {
  if (!activeCoachRequest) return false;
  activeCoachRequest.controller.abort();
  return true;
}

function clearCoachConversation() {
  const course = getActiveCourse();
  if (!course || !coachThreadStore) return false;
  const target = coachTarget(course);
  if (activeCoachRequest?.threadKey === target.threadKey) {
    activeCoachRequest.controller.abort();
  }
  coachThreadStore.clear(course.id, target.assignmentId);
  coachViewStates.delete(target.threadKey);
  renderCoursesView();
  refreshIcons();
  showStatus("This Coach conversation was cleared.", "success");
  return true;
}

function normalizeCoachTaskTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function createCoachTaskId(assignment, title) {
  const base = normalizeCoachTaskTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "next-step";
  const used = new Set((assignment.tasks || []).map((task) => String(task.id || "")));
  let candidate = "coach-" + base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = "coach-" + base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function addCoachStepAsTask(courseId, assignmentId, value) {
  const assignment = findAssignment(courseId, assignmentId);
  const title = normalizeCoachTaskTitle(value);
  if (!assignment || !title) return false;
  const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : [];
  const duplicate = tasks.some(
    (task) => normalizeCoachTaskTitle(task.title).toLowerCase() === title.toLowerCase()
  );
  if (duplicate) {
    showStatus("That Coach step is already in this assignment.", "warn");
    return false;
  }
  const nextWorkspace = updateAssignment(workspace, courseId, assignmentId, {
    tasks: [
      ...tasks,
      { id: createCoachTaskId(assignment, title), title, done: false }
    ]
  });
  if (!commitWorkspace(nextWorkspace)) return false;
  showStatus("Added " + title + " to this assignment.", "success");
  return true;
}

function focusCoachSource(courseId, assignmentId, sourceId) {
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return false;
  const assignment = (course.assignments || []).find((item) => item.id === assignmentId) || null;
  const source = findSourceRecord(buildSourceCatalog(course, assignment), sourceId);
  if (!source) {
    showStatus("This source is no longer available in the current course material.", "warn");
    return false;
  }
  if (source.kind.startsWith("course-") || ["grading", "policy", "exam", "weekly-guide"].includes(source.kind)) {
    state.activeCourseTab = "syllabus";
    state.selectedAssignmentId = "";
  } else {
    state.activeCourseTab = "assignments";
    state.selectedAssignmentId = assignment?.id || "";
  }
  renderCoursesView();
  refreshIcons();
  showStatus(source.location + ": " + source.text, "info");
  return true;
}

function renderCoursesView() {
  const course = getActiveCourse();
  elements.courseImportActions.innerHTML = "";
  elements.courseTabs.innerHTML = "";

  if (!course) {
    elements.courseWorkspace.innerHTML =
      '<section class="empty-state light">' +
        "<h2>No courses yet</h2>" +
        "<p>Import a syllabus or assignment to create your first course.</p>" +
        '<button type="button" class="primary-action" data-action="open-import">' +
          '<i data-lucide="upload" aria-hidden="true"></i>' +
          "<span>Import course material</span>" +
        "</button>" +
      "</section>";
    return;
  }

  elements.courseImportActions.innerHTML =
    '<button type="button" class="primary-action" data-action="open-import"' +
      ' data-course-id="' + escapeHtml(course.id) + '">' +
      '<i data-lucide="upload" aria-hidden="true"></i>' +
      "<span>Import into " +
        escapeHtml(course.code || course.name || "selected course") +
      "</span>" +
    "</button>" +
    '<button type="button" data-edit-course-plan data-course-id="' +
      escapeHtml(course.id) + '" data-focus-key="course-plan-action-' +
      escapeHtml(course.id) + '" aria-label="Edit course details"' +
      ' title="Edit course details">' +
      '<i data-lucide="pencil" aria-hidden="true"></i></button>' +
    '<button type="button" data-delete-course data-course-id="' +
      escapeHtml(course.id) + '" aria-label="Delete course: ' +
      escapeHtml(course.code || course.name || "Untitled course") +
      '" title="Delete course: ' +
      escapeHtml(course.code || course.name || "Untitled course") + '">' +
      '<i data-lucide="trash-2" aria-hidden="true"></i></button>';
  renderCourseTabs();

  const selectedAssignment = (course.assignments || []).find(
    (assignment) => assignment.id === state.selectedAssignmentId
  );
  if (state.activeCourseTab === "assignments" && selectedAssignment) {
    renderCoursePanel(
      renderSelectedAssignmentDetail(course, selectedAssignment)
    );
    return;
  }

  if (state.activeCourseTab === "syllabus") {
    renderCoursePanel(renderSyllabus(course));
  } else if (state.activeCourseTab === "coach") {
    renderCoursePanel(renderCoach(course));
  } else {
    renderCoursePanel(renderAssignmentList(course));
  }
}

function activateCourseTab(value, shouldFocus = false) {
  state.activeCourseTab = ["assignments", "syllabus", "coach"].includes(value)
    ? value
    : "assignments";
  if (state.activeCourseTab !== "coach") state.selectedAssignmentId = "";
  renderCoursesView();
  refreshIcons();
  if (shouldFocus) {
    const selected = Array.from(
      elements.courseTabs.querySelectorAll("[data-course-tab]")
    ).find((button) => button.dataset.courseTab === state.activeCourseTab);
    selected?.focus();
  }
}

function handleCourseTabKeydown(event) {
  const current = event.target.closest("[data-course-tab]");
  if (!current) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateCourseTab(current.dataset.courseTab, true);
    return;
  }
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const tabs = Array.from(
    elements.courseTabs.querySelectorAll("[data-course-tab]")
  );
  const currentIndex = tabs.findIndex(
    (button) => button.dataset.courseTab === current.dataset.courseTab
  );
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = tabs.length - 1;
  }
  activateCourseTab(tabs[nextIndex].dataset.courseTab, true);
}

function localDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function monthCells(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function currentCalendarFilter() {
  return {
    courseId: elements.calendarCourseFilter.value ||
      workspace.preferences.calendarCourseFilter || "all",
    type: elements.calendarTypeFilter.value || state.calendarTypeFilter || "all"
  };
}

function renderAgendaItems(items, emptyMessage) {
  if (items.length === 0) {
    return '<p class="empty-state light">' + escapeHtml(emptyMessage) + "</p>";
  }
  return "<ul>" + items.map((item) => (
    "<li><strong>" + escapeHtml(item.courseCode || "Course") + "</strong> " +
      escapeHtml(item.title || "Untitled item") +
      ' <span class="calendar-item-type">' + escapeHtml(item.type) + "</span></li>"
  )).join("") + "</ul>";
}

function renderCalendarCourseOptions() {
  const selected = currentCalendarFilter().courseId;
  elements.calendarCourseFilter.innerHTML =
    '<option value="all">All courses</option>' +
    workspace.courses.map((course) => (
      '<option value="' + escapeHtml(course.id) + '">' +
        escapeHtml(course.code || course.name || "Course") +
      "</option>"
    )).join("");
  elements.calendarCourseFilter.value = workspace.courses.some(
    (course) => course.id === selected
  ) ? selected : "all";
}

function renderCalendar() {
  renderCalendarCourseOptions();
  const items = buildCalendarItems(workspace, currentCalendarFilter());
  const byDate = new Map();
  const undated = [];
  items.forEach((item) => {
    const key = localDateKey(item.dueAt);
    if (!key) {
      undated.push(item);
      return;
    }
    byDate.set(key, [...(byDate.get(key) || []), item]);
  });

  if (!state.selectedCalendarDate) {
    state.selectedCalendarDate = localDateKey(new Date());
  }
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((label) => '<span class="calendar-weekday" aria-hidden="true">' +
      label + "</span>")
    .join("");
  elements.calendarGrid.innerHTML = weekdayLabels +
    monthCells(state.calendarCursor).map((date) => {
    const key = localDateKey(date);
    const events = byDate.get(key) || [];
    const selected = key === state.selectedCalendarDate;
    return (
      '<button type="button" class="calendar-day" data-calendar-date="' + key +
        '" aria-label="' + escapeHtml(date.toLocaleDateString()) +
        ", " + events.length + " item" + (events.length === 1 ? "" : "s") +
        '" aria-pressed="' + (selected ? "true" : "false") + '">' +
        '<span class="calendar-day-number">' + date.getDate() + "</span>" +
        '<span class="calendar-event-count">' + events.length + "</span>" +
        events.slice(0, 2).map((item) => (
          '<span class="calendar-event-label">' +
            escapeHtml(item.courseCode + " " + item.title) + "</span>"
        )).join("") +
      "</button>"
    );
    }).join("");
  elements.calendarAgenda.innerHTML = renderAgendaItems(
    byDate.get(state.selectedCalendarDate) || [],
    "No dated items match this day."
  );
  elements.undatedItems.innerHTML = renderAgendaItems(
    undated,
    "No undated items match these filters."
  );
  elements.calendarMonthLabel.textContent = state.calendarCursor
    .toLocaleDateString(undefined, { month: "long", year: "numeric" });
  refreshIcons();
}

function renderDataView() {
  const assignmentCount = workspace.courses.reduce(
    (total, course) => total + (course.assignments || []).length,
    0
  );
  elements.dataSummary.textContent = workspace.courses.length + " courses, " +
    assignmentCount + " assignments, schema " + workspace.schemaVersion + ".";
  elements.lastBackup.textContent = workspace.metadata.lastBackupAt
    ? "Last backup: " + new Date(workspace.metadata.lastBackupAt).toLocaleString()
    : "No backup exported yet.";
  elements.restoreBackup.disabled = !pendingBackup;
}

function renderData() {
  renderDataView();
}

function downloadTextFile(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadCalendar() {
  downloadTextFile(
    "classpilot-calendar.ics",
    "text/calendar;charset=utf-8",
    createIcsCalendar(buildCalendarItems(workspace, currentCalendarFilter()))
  );
  showStatus("Calendar download started.", "success");
  return true;
}

function downloadBackup() {
  const now = new Date();
  const previousWorkspace = workspace;
  const nextWorkspace = normalizeWorkspace(workspace, now);
  nextWorkspace.metadata.lastBackupAt = now.toISOString();
  const text = serializeWorkspaceBackup(nextWorkspace, now);
  workspace = nextWorkspace;
  const timestampSaved = saveWorkspace();
  if (timestampSaved) {
    invalidateUndo();
    renderAll();
  } else {
    workspace = previousWorkspace;
  }
  downloadTextFile("classpilot-backup.json", "application/json;charset=utf-8", text);
  showStatus(
    timestampSaved
      ? "Backup download started."
      : "Backup download started, but the last backup time could not be saved.",
    timestampSaved ? "success" : "warn"
  );
  return true;
}

function resetBackupPreview() {
  pendingBackup = undefined;
  elements.backupPreview.textContent = "Choose a backup to validate it before restoring.";
  elements.restoreBackup.disabled = true;
}

function clearBackupPreview() {
  backupPreviewOperation += 1;
  resetBackupPreview();
}

async function previewBackup(file) {
  const operation = ++backupPreviewOperation;
  resetBackupPreview();
  if (!file) throw new Error("Choose a backup file to restore.");
  if (Number(file.size) > 25 * 1024 * 1024) {
    throw new Error("Backup files must be 25 MB or smaller.");
  }
  const parsed = parseWorkspaceBackup(await file.text());
  if (operation !== backupPreviewOperation) return false;
  pendingBackup = normalizeWorkspace(parsed);
  const assignmentCount = pendingBackup.courses.reduce(
    (total, course) => total + (course.assignments || []).length,
    0
  );
  elements.backupPreview.textContent = pendingBackup.courses.length + " courses and " +
    assignmentCount + " assignments ready to restore.";
  elements.restoreBackup.disabled = false;
  return true;
}

function restoreBackup() {
  if (!pendingBackup) {
    showStatus("Choose and validate a backup before restoring.", "warn");
    return false;
  }
  const nextWorkspace = normalizeRestoredWorkspace(pendingBackup);
  if (!commitWorkspace(nextWorkspace, {
    allowStorageRecovery: true,
    render: false
  })) {
    return false;
  }
  state.assignmentFilters.clear();
  state.activeView = workspace.preferences.activeView;
  state.activeCourseTab = "assignments";
  state.selectedAssignmentId = "";
  state.calendarTypeFilter = "all";
  state.selectedCalendarDate = "";
  elements.calendarCourseFilter.value =
    workspace.preferences.calendarCourseFilter;
  elements.calendarTypeFilter.value = "all";
  clearBackupPreview();
  elements.importBackup.value = "";
  renderAll();
  window.history.replaceState(null, "", "#" + state.activeView);
  showStatus("Backup restored.", "success");
  return true;
}

function normalizeRestoredWorkspace(value) {
  const next = normalizeWorkspace(value);
  const courseIds = new Set(next.courses.map((course) => course.id));
  next.preferences.activeView = normalizedView(
    next.preferences.activeView
  );
  next.preferences.activeCourseId = courseIds.has(
    next.preferences.activeCourseId
  )
    ? next.preferences.activeCourseId
    : next.courses[0]?.id || "";
  next.preferences.calendarCourseFilter =
    next.preferences.calendarCourseFilter === "all" ||
    courseIds.has(next.preferences.calendarCourseFilter)
      ? next.preferences.calendarCourseFilter
      : "all";
  return next;
}

async function handleBackupFileChange(event) {
  const operation = backupPreviewOperation + 1;
  const file = event.currentTarget.files?.[0];
  try {
    const ready = await previewBackup(file);
    if (!ready || operation !== backupPreviewOperation) return;
    showStatus("Backup validated. Review the preview, then restore it.", "success");
  } catch (error) {
    if (operation !== backupPreviewOperation) return;
    resetBackupPreview();
    showStatus("Backup could not be prepared: " + error.message, "warn");
  }
}

function requestClearWorkspace(opener) {
  clearWorkspaceConfirmationPending = true;
  elements.confirmationDialog.innerHTML =
    '<h2 id="confirmationDialogTitle">Clear workspace?</h2>' +
    "<p>Export a backup before clearing. This replaces the current version 7 workspace in this browser.</p>" +
    '<div class="dialog-actions">' +
      '<button type="button" data-dialog-close>Cancel</button>' +
      '<button type="button" data-action="confirm-clear-workspace">Clear workspace</button>' +
    "</div>";
  showDialog(elements.confirmationDialog, opener);
  return true;
}

function clearWorkspaceAfterConfirmation() {
  if (!clearWorkspaceConfirmationPending) return false;
  const nextWorkspace = createEmptyWorkspace(new Date());
  if (!commitWorkspace(nextWorkspace, { allowStorageRecovery: true })) {
    return false;
  }
  state.assignmentFilters.clear();
  clearWorkspaceConfirmationPending = false;
  state.activeCourseTab = "assignments";
  state.selectedAssignmentId = "";
  clearBackupPreview();
  elements.importBackup.value = "";
  elements.confirmationDialog.close();
  renderAll();
  showStatus("Workspace cleared. Your version 6 recovery data was left untouched.", "success");
  return true;
}

function renderActiveView() {
  switch (state.activeView) {
    case "courses":
      renderCoursesView();
      break;
    case "calendar":
      renderCalendar();
      break;
    case "data":
      renderData();
      break;
    default:
      renderToday();
  }
}

function updateViewHeader() {
  const headers = {
    today: ["Today", "Your next move"],
    courses: ["Courses", "Course workspace"],
    calendar: ["Calendar", "Deadlines at a glance"],
    data: ["Data", "Protect your workspace"]
  };
  const [eyebrow, title] = headers[state.activeView];
  elements.viewEyebrow.textContent = eyebrow;
  elements.viewTitle.textContent = title;
  elements.headerImportButton.hidden =
    state.activeView === "calendar" || state.activeView === "data";
}

function navigateToView(view, options = {}) {
  const nextView = normalizedView(view);
  if (options.persist !== false) {
    if (!persistWorkspacePreferences({ activeView: nextView })) return false;
  } else {
    workspace.preferences.activeView = nextView;
  }
  state.activeView = nextView;

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== state.activeView;
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    const selected = button.dataset.view === state.activeView;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });

  updateViewHeader();
  renderActiveView();

  if (options.updateHash !== false) {
    const nextHash = "#" + state.activeView;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
  }
  if (options.focus !== false) elements.mainWorkspace.focus();
  refreshIcons();
  return true;
}

function renderAll() {
  renderNavigation();
  renderCourseRail();
  renderToday();
  renderCoursesView();
  renderCalendar();
  renderData();
  navigateToView(state.activeView, {
    focus: false,
    persist: false,
    updateHash: false
  });
  refreshIcons();
}

function assignmentStatusValue(assignment) {
  const status = assignment.status;
  const statusRecord = status && typeof status === "object" ? status : {};
  const statusValue = String(
    typeof status === "string"
      ? status
      : statusRecord.value || statusRecord.status || ""
  ).trim().toLowerCase();
  const category = String(assignment.category || "").trim().toLowerCase();
  if (
    statusRecord.completed ||
    ["complete", "completed", "feedback"].includes(statusValue) ||
    ["complete", "completed", "feedback"].includes(category)
  ) {
    return "completed";
  }
  if (
    statusValue === "graded" ||
    category === "graded" ||
    String(statusRecord.grading || "").trim().toLowerCase() === "graded" ||
    hasMeaningfulScore(statusRecord.score)
  ) {
    return "graded";
  }
  if (
    statusRecord.submittedAt ||
    statusValue === "submitted" ||
    category === "submitted"
  ) {
    return "submitted";
  }
  if (statusRecord.late || statusValue === "late" || category === "late") {
    return "late";
  }
  return "active";
}

function clearGradingEvidence(status = {}) {
  const next = { ...status };
  delete next.score;
  delete next.gradedAt;
  if (
    String(next.grading || "").trim().toLowerCase() === "graded"
  ) {
    delete next.grading;
  }
  return next;
}

function openAssignmentEditor(courseId, assignmentId, opener) {
  const assignment = findAssignment(courseId, assignmentId);
  if (!assignment) return false;
  const form = elements.assignmentForm;
  editorControl(form, "courseId").value = courseId;
  editorControl(form, "assignmentId").value = assignmentId;
  editorControl(form, "assignmentTitle").value = assignment.title || "";
  editorControl(form, "assignmentDueDate").value = assignment.dueDate || "";
  editorControl(form, "assignmentPoints").value = assignment.points || "";
  editorControl(form, "assignmentStatus").value = assignmentStatusValue(assignment);
  editorControl(form, "assignmentEstimate").value = assignment.estimateMinutes || "";
  editorControl(form, "assignmentRequirements").value =
    (assignment.details?.requirements || []).map(assignmentDetailItemText).join("\n");
  editorControl(form, "assignmentDeliverables").value =
    (assignment.details?.deliverables || []).map(assignmentDetailItemText).join("\n");
  editorControl(form, "assignmentSteps").value =
    (assignment.details?.steps || []).map(assignmentDetailItemText).join("\n");
  showDialog(elements.assignmentDialog, opener);
  editorControl(form, "assignmentTitle").focus();
  return true;
}

function submitAssignmentEdit(form = elements.assignmentForm) {
  const courseId = editorValue(form, "courseId");
  const assignmentId = editorValue(form, "assignmentId");
  const current = findAssignment(courseId, assignmentId);
  if (!current) return false;
  const dueDateInput = editorValue(form, "assignmentDueDate").trim();
  if (dueDateInput && !parseDueAt(dueDateInput)) {
    showStatus(
      "Enter a valid due date, such as Feb 29, 2024, or leave it blank.",
      "warn"
    );
    editorControl(form, "assignmentDueDate").focus();
    return false;
  }
  const structuredDueDate = parseStructuredEnglishDate(
    dueDateInput,
    { now: new Date() }
  );
  const dueDate = structuredDueDate.matched && structuredDueDate.valid
    ? structuredDueDate.formatted
    : dueDateInput;
  const statusValue = editorValue(form, "assignmentStatus");
  const currentStatus = current.status && typeof current.status === "object"
    ? current.status
    : {};
  const graded = statusValue === "graded";
  let status = {
    ...currentStatus,
    value: statusValue,
    late: statusValue === "late" || (graded && Boolean(currentStatus.late)),
    submittedAt: statusValue === "submitted"
      ? currentStatus.submittedAt || new Date().toLocaleString()
      : graded
        ? currentStatus.submittedAt || ""
        : "",
    completed: statusValue === "completed",
    grading: graded
      ? "Graded"
      : String(currentStatus.grading || "").trim().toLowerCase() === "graded"
        ? ""
        : currentStatus.grading || ""
  };
  if (!graded) status = clearGradingEvidence(status);
  const category = {
    active: "To submit",
    late: "Late",
    submitted: "Submitted",
    completed: "Completed",
    graded: "Graded"
  }[statusValue] || current.category;
  const nextWorkspace = updateAssignment(workspace, courseId, assignmentId, {
    title: editorValue(form, "assignmentTitle").trim(),
    dueDate,
    points: editorValue(form, "assignmentPoints").trim(),
    estimateMinutes: Number(editorValue(form, "assignmentEstimate")) || 30,
    category,
    status,
    details: {
      ...(current.details || {}),
      requirements: splitEditableLines(editorValue(form, "assignmentRequirements")),
      deliverables: splitEditableLines(editorValue(form, "assignmentDeliverables")),
      steps: splitEditableLines(editorValue(form, "assignmentSteps"))
    }
  });
  if (!commitWorkspace(nextWorkspace)) return false;
  elements.assignmentDialog.close();
  showStatus("Saved " + (editorValue(form, "assignmentTitle").trim() || "assignment") + ".", "success");
  return true;
}

function openTaskEditor(courseId, assignmentId, taskId, opener) {
  const assignment = findAssignment(courseId, assignmentId);
  const task = assignment?.tasks?.find((item) => item.id === taskId);
  if (!task) return false;
  const form = elements.taskForm;
  editorControl(form, "courseId").value = courseId;
  editorControl(form, "assignmentId").value = assignmentId;
  editorControl(form, "taskId").value = taskId;
  editorControl(form, "taskTitle").value = task.title || "";
  showDialog(elements.taskDialog, opener);
  editorControl(form, "taskTitle").focus();
  return true;
}

function submitTaskEdit(form = elements.taskForm) {
  const courseId = editorValue(form, "courseId");
  const assignmentId = editorValue(form, "assignmentId");
  const taskId = editorValue(form, "taskId");
  const assignment = findAssignment(courseId, assignmentId);
  const task = assignment?.tasks?.find((item) => item.id === taskId);
  if (!assignment || !task) return false;
  const title = editorValue(form, "taskTitle").trim();
  if (!title) {
    showStatus("Enter a task title before saving.", "warn");
    editorControl(form, "taskTitle").focus();
    return false;
  }
  const nextWorkspace = updateAssignment(workspace, courseId, assignmentId, {
    tasks: assignment.tasks.map((item) =>
      item.id === taskId ? { ...item, title } : item
    )
  });
  if (!commitWorkspace(nextWorkspace)) return false;
  elements.taskDialog.close();
  showStatus("Saved task " + title + ".", "success");
  return true;
}

function openCoursePlanEditor(courseId, opener) {
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return false;
  const plan = course.coursePlan || {};
  const form = elements.coursePlanForm;
  editorControl(form, "courseId").value = courseId;
  editorControl(form, "courseCode").value = course.code || "";
  editorControl(form, "courseName").value = course.name || "";
  editorControl(form, "coursePlanTerm").value = plan.term || "";
  editorControl(form, "coursePlanProfessor").value = plan.professor || "";
  editorControl(form, "coursePlanMeeting").value = plan.meetingLocation || "";
  editorControl(form, "coursePlanOfficeHours").value = plan.officeHours || "";
  editorControl(form, "coursePlanEmail").value = plan.email || "";
  showDialog(elements.coursePlanDialog, opener);
  editorControl(form, "courseCode").focus();
  return true;
}

function normalizeCourseCode(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizeCourseName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function submitCoursePlanEdit(form = elements.coursePlanForm) {
  const courseId = editorValue(form, "courseId");
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return false;
  const code = editorValue(form, "courseCode").replace(/\s+/g, " ").trim();
  const name = editorValue(form, "courseName").replace(/\s+/g, " ").trim();
  if (!code || !name) {
    const missing = !code
      ? editorControl(form, "courseCode")
      : editorControl(form, "courseName");
    showStatus("Enter both a course code and course name before saving.", "warn");
    missing.focus();
    return false;
  }
  const otherCourses = workspace.courses.filter((item) => item.id !== courseId);
  const codeConflict = otherCourses.find((item) =>
    normalizeCourseCode(item.code) === normalizeCourseCode(code)
  );
  if (codeConflict) {
    showStatus(
      "Course code " + code + " already belongs to " +
      (codeConflict.code || codeConflict.name || "another course") +
      ". Enter a unique course code.",
      "warn"
    );
    editorControl(form, "courseCode").focus();
    return false;
  }
  const nameConflict = otherCourses.find((item) =>
    normalizeCourseName(item.name) === normalizeCourseName(name)
  );
  if (nameConflict) {
    showStatus(
      "Course name " + name + " already belongs to " +
      (nameConflict.code || nameConflict.name || "another course") +
      ". Enter a unique course name.",
      "warn"
    );
    editorControl(form, "courseName").focus();
    return false;
  }
  const nextWorkspace = updateCourse(workspace, courseId, {
    code,
    name,
    coursePlan: {
      ...(course.coursePlan || {}),
      term: editorValue(form, "coursePlanTerm").trim(),
      professor: editorValue(form, "coursePlanProfessor").trim(),
      meetingLocation: editorValue(form, "coursePlanMeeting").trim(),
      officeHours: editorValue(form, "coursePlanOfficeHours").trim(),
      email: editorValue(form, "coursePlanEmail").trim()
    }
  });
  if (!commitWorkspace(nextWorkspace)) return false;
  elements.coursePlanDialog.close();
  showStatus("Saved course details for " + code + ".", "success");
  return true;
}

function invalidateUndo() {
  clearTimeout(undoTimer);
  undoTimer = undefined;
  undoState = undefined;
  elements.undoToast.hidden = true;
}

function showUndo(message, snapshot) {
  invalidateUndo();
  undoState = { snapshot };
  elements.undoToast.innerHTML =
    "<span>" + escapeHtml(message) +
    '</span><button type="button" data-undo>Undo</button>';
  elements.undoToast.hidden = false;
  undoTimer = setTimeout(() => {
    invalidateUndo();
  }, 10000);
}

function deleteAssignmentWithUndo(courseId, assignmentId) {
  const assignment = findAssignment(courseId, assignmentId);
  if (!assignment) return false;
  const snapshot = createWorkspaceSnapshot(workspace);
  const nextWorkspace = removeAssignment(workspace, courseId, assignmentId);
  if (!commitWorkspace(nextWorkspace, { invalidateUndo: false })) return false;
  state.selectedAssignmentId = "";
  showUndo("Assignment " + (assignment.title || "Untitled assignment") + " deleted.", snapshot);
  return true;
}

function deleteCourseWithUndo(courseId) {
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return false;
  const snapshot = createWorkspaceSnapshot(workspace);
  const nextWorkspace = removeWorkspaceCourse(workspace, courseId);
  if (!commitWorkspace(nextWorkspace, { invalidateUndo: false })) return false;
  state.selectedAssignmentId = "";
  showUndo("Course " + (course.code || course.name || "Untitled course") + " deleted.", snapshot);
  return true;
}

function deleteTaskWithUndo(courseId, assignmentId, taskId) {
  const assignment = findAssignment(courseId, assignmentId);
  const task = assignment?.tasks?.find((item) => item.id === taskId);
  if (!assignment || !task) return false;
  const snapshot = createWorkspaceSnapshot(workspace);
  const nextWorkspace = updateAssignment(workspace, courseId, assignmentId, {
    tasks: assignment.tasks.filter((item) => item.id !== taskId)
  });
  if (!commitWorkspace(nextWorkspace, { invalidateUndo: false })) return false;
  showUndo("Task " + (task.title || "Untitled task") + " deleted.", snapshot);
  return true;
}

function setTaskCompletion(courseId, assignmentId, taskId, done) {
  const assignment = findAssignment(courseId, assignmentId);
  if (!assignment?.tasks?.some((item) => item.id === taskId)) return false;
  const nextWorkspace = updateAssignment(workspace, courseId, assignmentId, {
    tasks: assignment.tasks.map((task) => task.id === taskId
      ? { ...task, done: Boolean(done) }
      : task)
  });
  return commitWorkspace(nextWorkspace);
}

function restoreUndo() {
  if (!undoState) return false;
  const nextWorkspace = restoreWorkspaceSnapshot(undoState.snapshot);
  if (!commitWorkspace(nextWorkspace, { invalidateUndo: false })) return false;
  invalidateUndo();
  showStatus("Deletion undone.", "success");
  return true;
}

function importControl(name) {
  return elements.importForm.elements?.namedItem(name) ||
    elements.importForm.elements?.[name] ||
    null;
}

function resetImportProgress() {
  const labels = {
    reading: "Reading file",
    extracting: "Extracting information",
    checking: "Checking required fields",
    saved: "Saved or needs review"
  };
  elements.importProgress.querySelectorAll("[data-import-stage]")
    .forEach((item) => {
      item.classList.toggle("is-active", false);
      item.classList.toggle("is-complete", false);
      item.setAttribute("aria-current", "false");
      item.textContent = labels[item.dataset.importStage];
    });
  elements.importProgressDetail.textContent = "";
}

function renderImportProgress(progress = {}) {
  const update = typeof progress === "string"
    ? { stage: progress }
    : progress;
  const rawStage = update.stage || "reading";
  const stage = rawStage === "ocr" ? "extracting" : rawStage;
  const stageOrder = ["reading", "extracting", "checking", "saved"];
  const activeIndex = Math.max(0, stageOrder.indexOf(stage));
  elements.importProgress.querySelectorAll("[data-import-stage]")
    .forEach((item) => {
      const index = stageOrder.indexOf(item.dataset.importStage);
      item.classList.toggle("is-complete", index < activeIndex);
      item.classList.toggle("is-active", index === activeIndex);
      item.setAttribute("aria-current", index === activeIndex ? "step" : "false");
    });

  let detail = "";
  if (rawStage === "reading") {
    detail = "Reading " + (update.fileName || "pasted text") +
      (update.kind ? " (" + update.kind + ")" : "") + ".";
  } else if (rawStage === "ocr") {
    const percent = Math.round(Math.max(0, Math.min(1, Number(update.progress) || 0)) * 100);
    const page = update.pageNumber
      ? " page " + update.pageNumber +
        (update.pageCount ? " of " + update.pageCount : "")
      : "";
    detail = "Running local OCR" + page + ": " + percent + "%.";
  } else if (rawStage === "extracting") {
    detail = update.pageNumber
      ? "Extracting page " + update.pageNumber + " of " + update.pageCount + "."
      : "Extracting course and assignment details.";
  } else if (rawStage === "checking") {
    detail = "Checking confidence, warnings, and required fields.";
  } else if (rawStage === "saved") {
    detail = update.outcome === "review"
      ? "Import needs review before it can be saved."
      : "Saved to " + (update.destination || "the course workspace") + ".";
  }
  elements.importProgressDetail.textContent = detail;
}

function setImportBusy(isBusy) {
  elements.analyzeImport.disabled = Boolean(isBusy);
  elements.saveImportReview.disabled = Boolean(isBusy);
  elements.importFile.disabled = Boolean(isBusy);
  elements.importText.disabled = Boolean(isBusy);
}

function yieldImportStage() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    } else {
      setTimeout(() => setTimeout(resolve, 0), 0);
    }
  });
}

function assertCurrentImport(controller) {
  if (
    controller.signal.aborted ||
    importController !== controller
  ) {
    throw createImportAbortError();
  }
}

function createImportAbortError() {
  if (typeof DOMException === "function") {
    return new DOMException("Import cancelled.", "AbortError");
  }
  const error = new Error("Import cancelled.");
  error.name = "AbortError";
  return error;
}

function recognizeImage(image, onProgress) {
  if (typeof window.Tesseract?.createWorker !== "function") {
    throw new Error("Local image OCR is unavailable.");
  }
  const previousOperation = activeOcrOperation;
  previousOperation?.cancel();
  let worker;
  let cancelled = false;
  let rejectCancellation;
  let terminationPromise;
  let operation;
  const cancellation = new Promise((_resolve, reject) => {
    rejectCancellation = reject;
  });
  cancellation.catch(() => {});
  const terminateWorker = () => {
    if (!worker) return Promise.resolve();
    if (!terminationPromise) {
      terminationPromise = Promise.resolve()
        .then(() => worker.terminate?.())
        .catch(() => {});
    }
    return terminationPromise;
  };
  const run = (async () => {
    try {
      if (previousOperation?.cleanup) {
        await previousOperation.cleanup;
      }
      if (cancelled) throw createImportAbortError();
      worker = await window.Tesseract.createWorker(
        "eng",
        window.Tesseract.OEM?.LSTM_ONLY ?? 1,
        {
          workerPath: "./vendor/tesseract/worker.min.js",
          corePath: "./vendor/tesseract/tesseract-core.wasm.js",
          langPath: "./vendor/tesseract",
          logger(message) {
            if (
              message.status === "recognizing text" &&
              Number.isFinite(message.progress)
            ) {
              onProgress?.(message.progress);
            }
          }
        }
      );
      if (cancelled) throw createImportAbortError();
      const result = await Promise.race([
        Promise.resolve(worker.recognize(image)),
        cancellation
      ]);
      if (cancelled) throw createImportAbortError();
      return result?.data?.text || "";
    } catch (error) {
      if (cancelled) throw createImportAbortError();
      throw error;
    } finally {
      await terminateWorker();
      if (activeOcrOperation === operation) {
        activeOcrOperation = undefined;
      }
    }
  })();
  operation = Promise.race([run, cancellation]);
  const cleanup = run.then(
    () => undefined,
    () => undefined
  );
  const cancel = () => {
    if (!cancelled) {
      cancelled = true;
      rejectCancellation(createImportAbortError());
    }
    void terminateWorker();
    return cleanup;
  };
  operation.cancel = cancel;
  operation.terminate = cancel;
  operation.cleanup = cleanup;
  activeOcrOperation = operation;
  return operation;
}

function openImportDialog(courseId = "", opener) {
  importController?.abort();
  importController = undefined;
  const course = workspace.courses.find((item) => item.id === courseId);
  if (courseId && !course) {
    importCourseId = "";
    importControl("courseId").value = "";
    elements.importDialog.close?.();
    showStatus(
      "The selected course is no longer available. Open Courses and choose the course again.",
      "warn"
    );
    return false;
  }
  pendingImportDraft = undefined;
  importCourseId = course?.id || "";
  importControl("courseId").value = importCourseId;
  elements.importFile.value = "";
  elements.importText.value = "";
  elements.importReview.hidden = true;
  elements.saveImportReview.hidden = true;
  elements.analyzeImport.hidden = false;
  setImportBusy(false);
  resetImportProgress();
  if (elements.importDialogTitle) {
    elements.importDialogTitle.textContent = course
      ? "Import into " + (course.code || course.name || "selected course")
      : "Import course material";
  }
  showDialog(elements.importDialog, opener);
  elements.importFile.focus();
  return true;
}

function importStatusValue(status = {}) {
  if (
    status.grading === "Graded" ||
    hasMeaningfulScore(status.score)
  ) return "graded";
  if (status.late) return "late";
  if (status.submittedAt) return "submitted";
  return "assigned";
}

const REVIEW_FIELDS = {
  courseCode: {
    control: "reviewCourseCode",
    id: "review-course-code-details",
    label: "Course code"
  },
  courseName: {
    control: "reviewCourseName",
    id: "review-course-name-details",
    label: "Course name"
  },
  materialType: {
    control: "reviewMaterialType",
    id: "review-material-type-details",
    label: "Material type"
  },
  assignment: {
    control: "reviewAssignment",
    id: "review-assignment-details",
    label: "Assignment title"
  },
  dueDate: {
    control: "reviewDueDate",
    id: "review-due-date-details",
    label: "Due date"
  },
  points: {
    control: "reviewPoints",
    id: "review-points-details",
    label: "Points"
  },
  status: {
    control: "reviewStatus",
    id: "review-status-details",
    label: "Status"
  },
  links: {
    control: "reviewLinks",
    id: "review-links-details",
    label: "Links"
  },
  requirements: {
    control: "reviewRequirements",
    id: "review-requirements-details",
    label: "Requirements"
  },
  deliverables: {
    control: "reviewDeliverables",
    id: "review-deliverables-details",
    label: "Deliverables"
  },
  tasks: {
    control: "reviewTasks",
    id: "review-tasks-details",
    label: "Tasks"
  },
  steps: {
    control: "reviewSteps",
    id: "review-steps-details",
    label: "Steps"
  }
};

function reviewFieldForText(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("course code")) return "courseCode";
  if (
    text === "course" ||
    text.includes("course name") ||
    text.includes("course identity")
  ) {
    return "courseName";
  }
  if (text.includes("due") || text.includes("date")) return "dueDate";
  if (text.includes("assignment") || text.includes("title")) return "assignment";
  if (text.includes("point")) return "points";
  if (text.includes("submitted") || text.includes("status") || text.includes("score")) {
    return "status";
  }
  if (text.includes("link") || text.includes("url")) return "links";
  if (text.includes("require")) return "requirements";
  if (text.includes("deliverable")) return "deliverables";
  if (text.includes("step")) return "steps";
  if (text.includes("task")) return "tasks";
  if (text.includes("source") || text.includes("material")) return "materialType";
  return "materialType";
}

function renderImportReview(draft = {}) {
  pendingImportDraft = clone(draft);
  const details = draft.assignmentDetails || {};
  importControl("reviewCourseCode").value = draft.code || "";
  importControl("reviewCourseName").value = draft.name || "";
  importControl("reviewMaterialType").value =
    draft.sourceType || "Course material";
  importControl("reviewAssignment").value = draft.assignment || "";
  importControl("reviewDueDate").value = draft.dueDate || "";
  importControl("reviewPoints").value = draft.points || "";
  importControl("reviewStatus").value = importStatusValue(draft.status);
  importControl("reviewLinks").value = draft.linksText || "";
  importControl("reviewRequirements").value =
    (details.requirements || []).join("\n");
  importControl("reviewDeliverables").value =
    (details.deliverables || []).join("\n");
  importControl("reviewTasks").value = draft.tasksText || "";
  importControl("reviewSteps").value = (details.steps || []).map(
    (step) => typeof step === "string" ? step : step.title || ""
  ).filter(Boolean).join("\n");

  const messages = Object.fromEntries(
    Object.keys(REVIEW_FIELDS).map((key) => [key, []])
  );
  (draft.evidence || []).forEach((item) => {
    const key = reviewFieldForText(item.label);
    messages[key].push(
      item.label + ": " + item.value +
      (item.source ? " (" + item.source + ")" : "")
    );
  });
  (draft.warnings || []).forEach((warning) => {
    messages[reviewFieldForText(warning)].push("Warning: " + warning);
  });

  elements.reviewEvidence.innerHTML = Object.entries(REVIEW_FIELDS)
    .map(([key, field]) => {
      const control = importControl(field.control);
      if (messages[key].length === 0) {
        control.setAttribute("aria-describedby", "");
        return "";
      }
      control.setAttribute("aria-describedby", field.id);
      return (
        '<p id="' + field.id + '"><strong>' + escapeHtml(field.label) +
        ":</strong> " + escapeHtml(messages[key].join(" ")) + "</p>"
      );
    })
    .join("");
  elements.importReview.hidden = false;
  elements.saveImportReview.hidden = false;
  renderImportProgress({ stage: "saved", outcome: "review" });
  const missingControl = missingImportField(draft);
  const warningField = (draft.warnings || []).map(reviewFieldForText)[0];
  const focusControl = missingControl ||
    REVIEW_FIELDS[warningField]?.control ||
    "reviewCourseCode";
  importControl(focusControl).focus();
  elements.analyzeImport.hidden = true;
}

function isCourseLevelDraft(draft = {}) {
  return draft.sourceType === "Syllabus or schedule";
}

function missingImportField(draft = {}) {
  if (!String(draft.code || "").trim()) return "reviewCourseCode";
  if (!String(draft.name || "").trim()) return "reviewCourseName";
  if (!String(draft.sourceType || "").trim()) return "reviewMaterialType";
  if (!isCourseLevelDraft(draft) && !String(draft.assignment || "").trim()) {
    return "reviewAssignment";
  }
  if (!isCourseLevelDraft(draft) && !String(draft.dueDate || "").trim()) {
    return "reviewDueDate";
  }
  if (!isCourseLevelDraft(draft) && !parseDueAt(draft.dueDate)) {
    return "reviewDueDate";
  }
  return "";
}

function shouldAutoSaveDraft(draft = {}) {
  return !missingImportField(draft) &&
    Number(draft.confidence) >= 86 &&
    Array.isArray(draft.warnings) &&
    draft.warnings.length === 0;
}

function matchingSavedAssignment(course, draft) {
  const title = String(draft.assignment || "").trim().toLowerCase();
  const due = Date.parse(String(draft.dueDate || ""));
  return [...(course?.assignments || [])].reverse().find((assignment) => {
    if (String(assignment.title || "").trim().toLowerCase() !== title) {
      return false;
    }
    const assignmentDue = Date.parse(String(assignment.dueDate || ""));
    if (Number.isFinite(due) && Number.isFinite(assignmentDue)) {
      return due === assignmentDue;
    }
    return String(assignment.dueDate || "").trim().toLowerCase() ===
      String(draft.dueDate || "").trim().toLowerCase();
  });
}

async function commitImportDraft(draft = {}, options = {}) {
  const previousWorkspace = clone(workspace);
  const boundCourseId = options.courseId ?? importCourseId;
  const boundCourse = workspace.courses.find(
    (course) => course.id === boundCourseId
  );
  let finalDraft = clone(draft);
  if (boundCourseId) {
    if (!boundCourse) {
      renderImportReview(finalDraft);
      showStatus("The selected course is no longer available.", "warn");
      return false;
    }
    if (!options.bound) {
      finalDraft = bindDraftToCourse(finalDraft, boundCourse);
    }
  }

  const result = upsertCourseFromDraft(
    workspace.courses,
    finalDraft,
    boundCourseId || workspace.preferences.activeCourseId
  );
  if (!result.course || result.action === "needs-course") {
    renderImportReview(finalDraft);
    showStatus(result.message || "Review the course identity before saving.", "warn");
    return false;
  }
  if (
    boundCourse &&
    (
      result.courses.length !== previousWorkspace.courses.length ||
      result.course.id !== boundCourse.id
    )
  ) {
    renderImportReview(finalDraft);
    showStatus("Import stayed in review because the selected course could not be guaranteed.", "warn");
    return false;
  }

  workspace = {
    ...workspace,
    courses: result.courses,
    preferences: {
      ...workspace.preferences,
      activeCourseId: result.course.id,
      activeView: "courses"
    }
  };
  if (!saveWorkspace()) {
    workspace = previousWorkspace;
    pendingImportDraft = clone(finalDraft);
    renderImportReview(finalDraft);
    return false;
  }
  invalidateUndo();

  const course = workspace.courses.find(
    (item) => item.id === result.course.id
  );
  const syllabus = isCourseLevelDraft(finalDraft);
  const assignment = syllabus
    ? null
    : matchingSavedAssignment(course, finalDraft);
  state.activeCourseTab = syllabus ? "syllabus" : "assignments";
  state.selectedAssignmentId = assignment?.id || "";
  pendingImportDraft = undefined;
  importCourseId = "";
  importControl("courseId").value = "";
  renderCourseRail();
  const destination = (course.code || course.name || "Course") +
    " > " + (syllabus ? "Syllabus" : "Assignments");
  renderImportProgress({
    stage: "saved",
    outcome: "saved",
    destination
  });
  await yieldImportStage();
  if (
    options.controller &&
    (
      options.controller.signal.aborted ||
      importController !== options.controller
    )
  ) {
    return true;
  }
  navigateToView("courses", {
    focus: false,
    persist: false
  });
  suppressDialogFocusReturn(elements.importDialog);
  elements.importDialog.close?.();
  showStatus(
    "Saved " +
      (syllabus ? "syllabus" : finalDraft.assignment || "assignment") +
      " in " + destination + ".",
    "success"
  );
  elements.mainWorkspace.focus();
  return true;
}

async function processImport(source, courseId = "") {
  importController?.abort();
  const controller = new AbortController();
  importController = controller;
  const selectedCourse = workspace.courses.find(
    (item) => item.id === courseId
  );
  if (courseId && !selectedCourse) {
    importController = undefined;
    showStatus("The selected course is no longer available.", "warn");
    return false;
  }
  importCourseId = selectedCourse?.id || "";
  importControl("courseId").value = importCourseId;
  setImportBusy(true);
  try {
    let text;
    let fileName = "";
    if (typeof source === "string") {
      text = source.trim();
      renderImportProgress({
        stage: "reading",
        kind: "text",
        fileName: "pasted text"
      });
      await yieldImportStage();
    } else {
      fileName = source?.name || "";
      const result = await readImportFile(source, {
        signal: controller.signal,
        onProgress(progress) {
          if (
            !controller.signal.aborted &&
            importController === controller
          ) {
            renderImportProgress(progress);
          }
        },
        ocrImage: recognizeImage
      });
      text = result.text;
      assertCurrentImport(controller);
      await yieldImportStage();
    }
    assertCurrentImport(controller);
    if (!String(text || "").trim()) {
      throw new Error("Add pasted text or choose a non-empty supported file.");
    }

    renderImportProgress({ stage: "extracting" });
    await yieldImportStage();
    assertCurrentImport(controller);
    const rawDraft = createCourseDraftFromMaterial(text, fileName);
    const draft = selectedCourse
      ? bindDraftToCourse(rawDraft, selectedCourse)
      : rawDraft;
    renderImportProgress({ stage: "checking" });
    await yieldImportStage();
    assertCurrentImport(controller);
    if (shouldAutoSaveDraft(draft)) {
      return await commitImportDraft(draft, {
        bound: Boolean(selectedCourse),
        courseId: selectedCourse?.id || "",
        controller
      });
    }
    renderImportReview(draft);
    await yieldImportStage();
    assertCurrentImport(controller);
    return false;
  } catch (error) {
    if (
      error.name !== "AbortError" &&
      importController === controller
    ) {
      console.error("ClassPilot import failed.", error);
      showStatus(error.message || "The material could not be imported.", "warn");
    }
    return false;
  } finally {
    if (importController === controller) {
      importController = undefined;
      setImportBusy(false);
    }
  }
}

function reviewedStatus(value, current = {}) {
  let status = { ...current };
  if (value === "assigned") {
    return {};
  }
  if (value !== "graded") {
    status = clearGradingEvidence(status);
  }
  if (value === "submitted") {
    status.late = false;
    status.submittedAt ||= "Submitted";
  }
  if (value === "late") status.late = true;
  if (value === "graded") {
    status.grading = "Graded";
  }
  return status;
}

function reviewedImportDraft() {
  const draft = clone(pendingImportDraft || {});
  const details = clone(draft.assignmentDetails || {});
  return {
    ...draft,
    code: importControl("reviewCourseCode").value.trim(),
    name: importControl("reviewCourseName").value.trim(),
    sourceType: importControl("reviewMaterialType").value,
    assignment: importControl("reviewAssignment").value.trim(),
    dueDate: importControl("reviewDueDate").value.trim(),
    points: importControl("reviewPoints").value.trim(),
    status: reviewedStatus(
      importControl("reviewStatus").value,
      draft.status
    ),
    linksText: importControl("reviewLinks").value.trim(),
    tasksText: importControl("reviewTasks").value.trim(),
    assignmentDetails: {
      ...details,
      requirements: splitReviewLines(
        importControl("reviewRequirements").value
      ),
      deliverables: splitReviewLines(
        importControl("reviewDeliverables").value
      ),
      steps: splitReviewLines(importControl("reviewSteps").value)
    },
    reviewed: true
  };
}

function saveReviewedImport() {
  const draft = reviewedImportDraft();
  const missing = missingImportField(draft);
  if (missing) {
    const control = importControl(missing);
    const invalidDate = missing === "reviewDueDate" &&
      Boolean(String(draft.dueDate || "").trim());
    showStatus(
      invalidDate
        ? "Enter a valid due date before saving this assignment."
        : "Complete the highlighted import field before saving.",
      "warn"
    );
    control.focus();
    return false;
  }
  return commitImportDraft(draft, {
    bound: false,
    courseId: importControl("courseId").value
  });
}

function cancelImport() {
  importController?.abort();
  importController = undefined;
  setImportBusy(false);
  elements.importDialog.close?.();
}

function handleImportSubmit(event) {
  event.preventDefault();
  const file = elements.importFile.files?.[0];
  const text = elements.importText.value.trim();
  if (!file && !text) {
    showStatus("Choose one supported file or paste course material.", "warn");
    elements.importFile.focus();
    return;
  }
  return processImport(file || text, importControl("courseId").value);
}

function handleImportDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    showStatus("Drop one supported file to import it.", "warn");
    return;
  }
  return processImport(file, importControl("courseId").value);
}

function selectCourse(courseId) {
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return false;
  if (!persistWorkspacePreferences({
    activeCourseId: course.id,
    activeView: "courses"
  })) {
    return false;
  }
  state.activeCourseTab = "assignments";
  state.selectedAssignmentId = "";
  renderCourseRail();
  navigateToView("courses", { persist: false });
  showStatus("Viewing " + (course.code || course.name || "selected course") + ".");
  return true;
}

function selectAssignment(button) {
  const courseId = button.dataset.courseId || "";
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return false;
  const assignment = (course.assignments || []).find(
    (item) => item.id === (button.dataset.assignmentId || "")
  );
  if (!assignment) return false;
  if (!persistWorkspacePreferences({
    activeCourseId: course.id,
    activeView: "courses"
  })) {
    return false;
  }
  state.activeCourseTab = "assignments";
  state.selectedAssignmentId = assignment.id;
  renderCourseRail();
  navigateToView("courses", { persist: false });
  showStatus(
    "Opened " + assignment.title + " in " +
      (course.code || course.name || "its course") + "."
  );
  return true;
}

function handleDocumentClick(event) {
  const dialogClose = event.target.closest("[data-dialog-close]");
  if (dialogClose) {
    dialogClose.closest("dialog")?.close();
    return;
  }

  if (event.target.closest("[data-undo]")) {
    restoreUndo();
    return;
  }

  const assignmentCoach = event.target.closest("[data-open-coach]");
  if (assignmentCoach) {
    openAssignmentCoach(
      assignmentCoach.dataset.courseId,
      assignmentCoach.dataset.assignmentId
    );
    return;
  }

  const coachSource = event.target.closest("[data-coach-source-id]");
  if (coachSource) {
    focusCoachSource(
      coachSource.dataset.courseId,
      coachSource.dataset.assignmentId,
      coachSource.dataset.coachSourceId
    );
    return;
  }

  const coachTask = event.target.closest("[data-add-coach-task]");
  if (coachTask) {
    addCoachStepAsTask(
      coachTask.dataset.courseId,
      coachTask.dataset.assignmentId,
      coachTask.dataset.taskTitle
    );
    return;
  }

  const coachAction = event.target.closest("[data-coach-action]");
  if (coachAction) {
    void askCoachQuickQuestion(coachAction.dataset.coachAction);
    return;
  }

  if (event.target.closest("[data-coach-stop]")) {
    stopCoachResponse();
    return;
  }

  if (event.target.closest("[data-coach-clear]")) {
    clearCoachConversation();
    return;
  }

  const calendarMonth = event.target.closest("[data-calendar-month]");
  if (calendarMonth) {
    state.calendarCursor = new Date(
      state.calendarCursor.getFullYear(),
      state.calendarCursor.getMonth() +
        (calendarMonth.dataset.calendarMonth === "previous" ? -1 : 1),
      1
    );
    state.selectedCalendarDate = localDateKey(state.calendarCursor);
    renderCalendar();
    return;
  }

  const calendarDate = event.target.closest("[data-calendar-date]");
  if (calendarDate) {
    state.selectedCalendarDate = calendarDate.dataset.calendarDate;
    renderCalendar();
    return;
  }

  const assignmentEditor = event.target.closest("[data-edit-assignment]");
  if (assignmentEditor) {
    openAssignmentEditor(
      assignmentEditor.dataset.courseId,
      assignmentEditor.dataset.assignmentId,
      assignmentEditor
    );
    return;
  }

  const coursePlanEditor = event.target.closest("[data-edit-course-plan]");
  if (coursePlanEditor) {
    openCoursePlanEditor(coursePlanEditor.dataset.courseId, coursePlanEditor);
    return;
  }

  const assignmentDelete = event.target.closest("[data-delete-assignment]");
  if (assignmentDelete) {
    deleteAssignmentWithUndo(
      assignmentDelete.dataset.courseId,
      assignmentDelete.dataset.assignmentId
    );
    return;
  }

  const courseDelete = event.target.closest("[data-delete-course]");
  if (courseDelete) {
    deleteCourseWithUndo(courseDelete.dataset.courseId);
    return;
  }

  const taskDelete = event.target.closest("[data-delete-task]");
  if (taskDelete) {
    deleteTaskWithUndo(
      taskDelete.dataset.courseId,
      taskDelete.dataset.assignmentId,
      taskDelete.dataset.taskId
    );
    return;
  }

  const taskEditor = event.target.closest("[data-edit-task]");
  if (taskEditor) {
    openTaskEditor(
      taskEditor.dataset.courseId,
      taskEditor.dataset.assignmentId,
      taskEditor.dataset.taskId,
      taskEditor
    );
    return;
  }

  const taskCheckbox = event.target.closest("[data-task-id]");
  if (taskCheckbox?.matches("input[type=checkbox]")) {
    const task = findAssignment(
      taskCheckbox.dataset.courseId,
      taskCheckbox.dataset.assignmentId
    )?.tasks?.find((item) => item.id === taskCheckbox.dataset.taskId);
    const saved = setTaskCompletion(
      taskCheckbox.dataset.courseId,
      taskCheckbox.dataset.assignmentId,
      taskCheckbox.dataset.taskId,
      taskCheckbox.checked
    );
    if (!saved) taskCheckbox.checked = Boolean(task?.done);
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    navigateToView(viewButton.dataset.view);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    if (actionButton.dataset.action === "open-courses") {
      navigateToView("courses");
    }
    if (actionButton.dataset.action === "open-import") {
      openImportDialog(actionButton.dataset.courseId || "", actionButton);
    }
    if (actionButton.dataset.action === "confirm-clear-workspace") {
      clearWorkspaceAfterConfirmation();
    }
    return;
  }

  const courseButton = event.target.closest("[data-select-course]");
  if (courseButton) {
    selectCourse(courseButton.dataset.courseId);
    return;
  }

  const assignmentButton = event.target.closest("[data-assignment-id]");
  if (assignmentButton) {
    selectAssignment(assignmentButton);
    return;
  }

  const courseTab = event.target.closest("[data-course-tab]");
  if (courseTab) {
    activateCourseTab(courseTab.dataset.courseTab, true);
    return;
  }
}

function handleHistoryRoute() {
  navigateToView(window.location.hash, {
    focus: false,
    persist: true,
    updateHash: false
  });
  if (window.location.hash !== "#" + state.activeView) {
    window.history.replaceState(null, "", "#" + state.activeView);
  }
}

function initialize() {
  workspace = loadWorkspace();
  coachThreadStore = createThreadStore(localStorage);

  if (
    !workspace.courses.some(
      (course) => course.id === workspace.preferences.activeCourseId
    )
  ) {
    workspace.preferences.activeCourseId = workspace.courses[0]?.id || "";
  }

  state.activeView = routeFromHash();
  renderAll();

  if (window.location.hash !== "#" + state.activeView) {
    window.history.replaceState(null, "", "#" + state.activeView);
  }
  if (state.storageAvailable) {
    showStatus("Workspace ready. Your course data stays in this browser.");
  }
}

document.addEventListener("click", handleDocumentClick);
elements.globalImportButton.addEventListener("click", (event) => {
  openImportDialog("", event.currentTarget);
});
elements.headerImportButton.addEventListener("click", (event) => {
  openImportDialog("", event.currentTarget);
});
elements.importForm.addEventListener("submit", handleImportSubmit);
elements.assignmentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAssignmentEdit(event.currentTarget);
});
elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitTaskEdit(event.currentTarget);
});
elements.coursePlanForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCoursePlanEdit(event.currentTarget);
});
elements.cancelImport.addEventListener("click", cancelImport);
elements.saveImportReview.addEventListener("click", saveReviewedImport);
elements.calendarCourseFilter.addEventListener("change", () => {
  const nextFilter = elements.calendarCourseFilter.value || "all";
  if (!persistWorkspacePreferences({
    calendarCourseFilter: nextFilter
  })) {
    elements.calendarCourseFilter.value =
      workspace.preferences.calendarCourseFilter || "all";
    return;
  }
  renderCalendar();
});
elements.calendarTypeFilter.addEventListener("change", () => {
  state.calendarTypeFilter = elements.calendarTypeFilter.value || "all";
  renderCalendar();
});
elements.exportCalendar.addEventListener("click", downloadCalendar);
elements.exportBackup.addEventListener("click", downloadBackup);
elements.importBackup.addEventListener("change", handleBackupFileChange);
elements.restoreBackup.addEventListener("click", restoreBackup);
elements.clearWorkspace.addEventListener("click", (event) => {
  requestClearWorkspace(event.currentTarget);
});
elements.importDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});
elements.importDropZone.addEventListener("drop", handleImportDrop);
elements.courseWorkspace.addEventListener("input", handleAssignmentFilterChange);
elements.courseWorkspace.addEventListener("change", (event) => {
  if (!handleCoachLanguageChange(event)) handleAssignmentFilterChange(event);
});
elements.courseWorkspace.addEventListener("submit", handleCoachFormSubmit);
elements.importDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelImport();
});
elements.confirmationDialog.addEventListener("close", () => {
  clearWorkspaceConfirmationPending = false;
});
elements.confirmationDialog.addEventListener("cancel", () => {
  clearWorkspaceConfirmationPending = false;
});
[elements.importDialog, elements.assignmentDialog, elements.taskDialog,
  elements.coursePlanDialog, elements.confirmationDialog].forEach((dialog) => {
  dialog.addEventListener("close", () => restoreDialogFocus(dialog));
});
elements.courseTabs.addEventListener("keydown", handleCourseTabKeydown);
window.addEventListener("hashchange", handleHistoryRoute);

initialize();
