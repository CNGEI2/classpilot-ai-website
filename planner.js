(function exposePlanner(root) {
  "use strict";
  const WORKSPACE_SCHEMA_VERSION = 7;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const isoNow = (now = new Date()) => new Date(now).toISOString();
  const logicApi = root.ClassPilotLogic || (
    typeof require === "function" ? require("./logic.js") : {}
  );
  const hasMeaningfulScore = logicApi.hasMeaningfulScore;
  const parseStructuredEnglishDate =
    logicApi.parseStructuredEnglishDate;

  function createEmptyWorkspace(now = new Date()) {
    return {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      courses: [],
      preferences: {
        activeView: "today",
        activeCourseId: "",
        language: "en",
        calendarCourseFilter: "all"
      },
      metadata: { updatedAt: isoNow(now), lastBackupAt: "" }
    };
  }

  function normalizeWorkspace(value, now = new Date()) {
    const empty = createEmptyWorkspace(now);
    const source = value && typeof value === "object" ? value : {};
    return {
      ...empty,
      ...clone(source),
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      courses: Array.isArray(source.courses) ? clone(source.courses) : [],
      preferences: { ...empty.preferences, ...(source.preferences || {}) },
      metadata: { ...empty.metadata, ...(source.metadata || {}) }
    };
  }

  function migrateLegacyCourses(courses, now = new Date()) {
    return normalizeWorkspace({ courses: Array.isArray(courses) ? courses : [] }, now);
  }

  function findCourseIndex(workspace, courseId) {
    return workspace.courses.findIndex((course) => course.id === courseId);
  }

  function touchWorkspace(workspace, now = new Date()) {
    workspace.metadata.updatedAt = isoNow(now);
    return workspace;
  }

  function updateAssignment(workspace, courseId, assignmentId, patch, now = new Date()) {
    const next = normalizeWorkspace(workspace, now);
    const courseIndex = findCourseIndex(next, courseId);
    if (courseIndex < 0) return next;
    const assignmentIndex = (next.courses[courseIndex].assignments || [])
      .findIndex((assignment) => assignment.id === assignmentId);
    if (assignmentIndex < 0) return next;
    const current = next.courses[courseIndex].assignments[assignmentIndex];
    const changes = clone(patch || {});
    if (Object.prototype.hasOwnProperty.call(changes, "dueDate")) {
      changes.dueAt = parseDueAt(changes.dueDate, now);
    }
    next.courses[courseIndex].assignments[assignmentIndex] = {
      ...current,
      ...changes,
      updatedAt: isoNow(now)
    };
    return touchWorkspace(next, now);
  }

  function updateCourse(workspace, courseId, patch, now = new Date()) {
    const next = normalizeWorkspace(workspace, now);
    const courseIndex = findCourseIndex(next, courseId);
    if (courseIndex < 0) return next;
    const current = next.courses[courseIndex];
    const changes = patch && typeof patch === "object" ? patch : {};
    next.courses[courseIndex] = {
      ...current,
      ...(Object.prototype.hasOwnProperty.call(changes, "code")
        ? { code: String(changes.code || "") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(changes, "name")
        ? { name: String(changes.name || "") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(changes, "coursePlan")
        ? { coursePlan: clone(changes.coursePlan || {}) }
        : {})
    };
    return touchWorkspace(next, now);
  }

  function removeAssignment(workspace, courseId, assignmentId, now = new Date()) {
    const next = normalizeWorkspace(workspace, now);
    const courseIndex = findCourseIndex(next, courseId);
    if (courseIndex < 0) return next;
    const assignments = next.courses[courseIndex].assignments || [];
    if (!assignments.some((assignment) => assignment.id === assignmentId)) return next;
    next.courses[courseIndex].assignments = assignments
      .filter((assignment) => assignment.id !== assignmentId);
    return touchWorkspace(next, now);
  }

  function removeWorkspaceCourse(workspace, courseId, now = new Date()) {
    const next = normalizeWorkspace(workspace, now);
    if (findCourseIndex(next, courseId) < 0) return next;
    next.courses = next.courses.filter((course) => course.id !== courseId);
    if (next.preferences.activeCourseId === courseId) {
      next.preferences.activeCourseId = next.courses[0]?.id || "";
    }
    return touchWorkspace(next, now);
  }

  function replaceCoursePlan(workspace, courseId, coursePlan, now = new Date()) {
    const next = normalizeWorkspace(workspace, now);
    const index = findCourseIndex(next, courseId);
    if (index < 0) return next;
    next.courses[index].coursePlan = clone(coursePlan || {});
    return touchWorkspace(next, now);
  }

  function isValidCalendarDate(year, month, day) {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1
    ) {
      return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  }

  function strictNumericDateParts(value) {
    const source = String(value || "").trim();
    const iso = source.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[T\s,])/
    );
    if (iso) {
      return {
        year: Number(iso[1]),
        month: Number(iso[2]),
        day: Number(iso[3])
      };
    }
    const local = source.match(
      /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?=$|[\s,])/
    );
    if (!local) return null;
    const rawYear = Number(local[3]);
    return {
      year: local[3].length === 2 ? 2000 + rawYear : rawYear,
      month: Number(local[1]),
      day: Number(local[2])
    };
  }

  function parseDueAt(value, now = new Date()) {
    const source = String(value || "").trim();
    if (!source) return "";
    const structuredEnglish = parseStructuredEnglishDate(
      source,
      { now }
    );
    if (structuredEnglish.matched) {
      return structuredEnglish.valid
        ? structuredEnglish.dueAt
        : "";
    }
    const numeric = strictNumericDateParts(source);
    if (
      numeric &&
      !isValidCalendarDate(numeric.year, numeric.month, numeric.day)
    ) {
      return "";
    }
    const localDateOnly = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (localDateOnly) {
      const date = new Date(0);
      date.setFullYear(
        Number(localDateOnly[1]),
        Number(localDateOnly[2]) - 1,
        Number(localDateOnly[3])
      );
      date.setHours(0, 0, 0, 0);
      return date.toISOString();
    }
    const timestamp = Date.parse(source);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  }

  function assignmentDueAt(assignment = {}, now = new Date()) {
    if (isNonEmptyString(assignment.dueDate)) {
      const dueDate = parseDueAt(assignment.dueDate, now);
      if (dueDate) return dueDate;
    }
    return parseDueAt(assignment.dueAt, now);
  }

  function buildCalendarItems(workspace, filter = {}) {
    const items = [];
    const now = filter.now || new Date();
    normalizeWorkspace(workspace).courses.forEach((course) => {
      if (filter.courseId && filter.courseId !== "all" && filter.courseId !== course.id) return;
      (Array.isArray(course.assignments) ? course.assignments : []).forEach((assignment) => {
        const dueAt = assignmentDueAt(assignment, now);
        items.push({
          id: assignment.id,
          courseId: course.id,
          courseCode: course.code,
          title: assignment.title,
          dueAt,
          displayDate: dueAt
            ? assignment.dueDate || assignment.dueAt
            : "Needs a date",
          type: "assignment"
        });
      });
      const examIdentityCounts = new Map();
      (Array.isArray(course.coursePlan?.exams) ? course.coursePlan.exams : [])
        .forEach((exam) => {
          const identity = calendarExamIdentity(exam);
          const occurrence = (examIdentityCounts.get(identity) || 0) + 1;
          examIdentityCounts.set(identity, occurrence);
          items.push({
            id: identity + (occurrence > 1 ? "|" + occurrence : ""),
            courseId: course.id,
            courseCode: course.code,
            title: exam.label,
            dueAt: parseDueAt(exam.date, now),
            displayDate: exam.date || "Needs a date",
            type: "exam"
          });
        });
    });
    return items.filter((item) => !filter.type || filter.type === "all" || item.type === filter.type);
  }

  function normalizedCalendarIdentity(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function calendarExamIdentity(exam = {}) {
    if (isNonEmptyString(exam.id)) return exam.id.trim();
    const label = normalizedCalendarIdentity(exam.label) || "exam";
    const date = normalizedCalendarIdentity(exam.date) || "no-date";
    return "exam:" + label + "|" + date;
  }

  function escapeIcs(value) {
    return String(value || "").replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function icsTimestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function createIcsCalendar(items) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClassPilot AI//EN", "CALSCALE:GREGORIAN"];
    (Array.isArray(items) ? items : []).forEach((item) => {
      const dueAt = icsTimestamp(item && item.dueAt);
      if (!dueAt) return;
      lines.push("BEGIN:VEVENT");
      const type = String(item.type || "item").trim() || "item";
      const courseId = String(item.courseId || "unassigned-course").trim() ||
        "unassigned-course";
      const identity = String(item.id || "").trim() ||
        [
          String(item.title || "untitled item").trim(),
          String(item.displayDate || item.dueAt || "undated").trim()
        ].join("|");
      lines.push(
        "UID:" + escapeIcs(
          [type, courseId, identity].join("|") + "@classpilot.local"
        )
      );
      lines.push("DTSTAMP:" + icsTimestamp(new Date()));
      lines.push("DTSTART:" + dueAt);
      lines.push("SUMMARY:" + escapeIcs(item.courseCode + " - " + item.title));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function validateNonEmptyStringList(value, path) {
    if (!Array.isArray(value)) {
      throw new Error(path + " must be a list.");
    }
    value.forEach((item, index) => {
      if (!isNonEmptyString(item)) {
        throw new Error(
          path + "[" + index + "] must be a non-empty string."
        );
      }
    });
  }

  function validateOptionalString(record, key, path, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return;
    const value = record[key];
    if (typeof value !== "string") {
      throw new Error(path + "." + key + " must be a string.");
    }
    if (options.nonEmpty && !value.trim()) {
      throw new Error(path + "." + key + " must be a non-empty string.");
    }
  }

  function validateOptionalBoolean(record, key, path) {
    if (
      Object.prototype.hasOwnProperty.call(record, key) &&
      typeof record[key] !== "boolean"
    ) {
      throw new Error(path + "." + key + " must be true or false.");
    }
  }

  function validateOptionalFiniteNumber(record, key, path) {
    if (
      Object.prototype.hasOwnProperty.call(record, key) &&
      (typeof record[key] !== "number" || !Number.isFinite(record[key]))
    ) {
      throw new Error(path + "." + key + " must be a finite number.");
    }
  }

  function validateEvidenceList(value, path) {
    if (!Array.isArray(value)) {
      throw new Error(path + " must be a list.");
    }
    value.forEach((item, index) => {
      const itemPath = path + "[" + index + "]";
      if (!isRecord(item)) {
        throw new Error(itemPath + " must be an object.");
      }
      ["label", "value"].forEach((key) => {
        if (!isNonEmptyString(item[key])) {
          throw new Error(
            itemPath + "." + key + " must be a non-empty string."
          );
        }
      });
      if (
        Object.prototype.hasOwnProperty.call(item, "source") &&
        !isNonEmptyString(item.source)
      ) {
        throw new Error(
          itemPath + ".source must be a non-empty string."
        );
      }
    });
  }

  function validateSource(source, path) {
    if (!isRecord(source)) {
      throw new Error(path + " must be an object.");
    }
    ["fileName", "sourceType", "importedAt"].forEach((key) => {
      validateOptionalString(source, key, path);
    });
    validateOptionalFiniteNumber(source, "confidence", path);
    if (Object.prototype.hasOwnProperty.call(source, "warnings")) {
      validateNonEmptyStringList(source.warnings, path + ".warnings");
    }
    if (Object.prototype.hasOwnProperty.call(source, "evidence")) {
      validateEvidenceList(source.evidence, path + ".evidence");
    }
  }

  function validateStatus(status, path) {
    if (typeof status === "string") return;
    if (!isRecord(status)) {
      throw new Error(path + " must be an object or string.");
    }
    ["late", "completed"].forEach((key) => {
      validateOptionalBoolean(status, key, path);
    });
    [
      "value",
      "status",
      "grading",
      "submittedAt",
      "completedAt",
      "gradedAt",
      "nextUp",
      "attempt",
      "attemptsAllowed",
      "progress"
    ].forEach((key) => validateOptionalString(status, key, path));
    if (
      Object.prototype.hasOwnProperty.call(status, "score") &&
      status.score !== null &&
      typeof status.score !== "string" &&
      (typeof status.score !== "number" || !Number.isFinite(status.score))
    ) {
      throw new Error(
        path + ".score must be a string or finite number."
      );
    }
  }

  function validateDetailSteps(value, path) {
    if (!Array.isArray(value)) {
      throw new Error(path + " must be a list.");
    }
    value.forEach((step, index) => {
      const stepPath = path + "[" + index + "]";
      if (typeof step === "string") {
        if (!step.trim()) {
          throw new Error(stepPath + " must be a non-empty string or object.");
        }
        return;
      }
      if (!isRecord(step)) {
        throw new Error(stepPath + " must be a non-empty string or object.");
      }
      if (!isNonEmptyString(step.title)) {
        throw new Error(stepPath + ".title must be a non-empty string.");
      }
      validateOptionalBoolean(step, "done", stepPath);
    });
  }

  function validateDetailRecordList(value, path, requiredFields) {
    if (!Array.isArray(value)) {
      throw new Error(path + " must be a list.");
    }
    value.forEach((item, index) => {
      const itemPath = path + "[" + index + "]";
      if (!isRecord(item)) {
        throw new Error(itemPath + " must be an object.");
      }
      requiredFields.forEach((key) => {
        if (!isNonEmptyString(item[key])) {
          throw new Error(
            itemPath + "." + key + " must be a non-empty string."
          );
        }
      });
      ["weight", "description"].forEach((key) => {
        validateOptionalString(item, key, itemPath);
      });
      if (Object.prototype.hasOwnProperty.call(item, "requirements")) {
        validateNonEmptyStringList(
          item.requirements,
          itemPath + ".requirements"
        );
      }
    });
  }

  function validateAssignmentDetails(details, path) {
    validateOptionalString(details, "overview", path);
    [
      "requirements",
      "deliverables",
      "requiredReading",
      "submissionTypes",
      "successCriteria"
    ].forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(details, key)) return;
      validateNonEmptyStringList(details[key], path + "." + key);
    });
    if (Object.prototype.hasOwnProperty.call(details, "steps")) {
      validateDetailSteps(details.steps, path + ".steps");
    }
    if (Object.prototype.hasOwnProperty.call(details, "rubric")) {
      validateDetailRecordList(details.rubric, path + ".rubric", ["label"]);
    }
    if (Object.prototype.hasOwnProperty.call(details, "coreTasks")) {
      validateDetailRecordList(
        details.coreTasks,
        path + ".coreTasks",
        ["label", "title"]
      );
    }
  }

  function validateCoursePlanRecordList(coursePlan, key, path, fields) {
    if (!Object.prototype.hasOwnProperty.call(coursePlan, key)) return;
    const listPath = path + "." + key;
    const values = coursePlan[key];
    if (!Array.isArray(values)) {
      throw new Error(listPath + " must be a list.");
    }
    values.forEach((item, index) => {
      const itemPath = listPath + "[" + index + "]";
      if (!isRecord(item)) {
        throw new Error(itemPath + " must be an object.");
      }
      fields.forEach((field) => {
        if (!isNonEmptyString(item[field])) {
          throw new Error(
            itemPath + "." + field + " must be a non-empty string."
          );
        }
      });
    });
  }

  function validateCoursePlan(coursePlan, path) {
    validateOptionalBoolean(coursePlan, "syllabusUploaded", path);
    [
      "sourceType",
      "term",
      "professor",
      "credits",
      "section",
      "modality",
      "meetingLocation",
      "officeHours",
      "email"
    ].forEach((key) => validateOptionalString(coursePlan, key, path));
    validateCoursePlanRecordList(
      coursePlan,
      "deadlines",
      path,
      ["label", "date"]
    );
    validateCoursePlanRecordList(
      coursePlan,
      "exams",
      path,
      ["label", "date"]
    );
    validateCoursePlanRecordList(
      coursePlan,
      "policies",
      path,
      ["label", "text"]
    );
    validateCoursePlanRecordList(
      coursePlan,
      "grading",
      path,
      ["label", "weight"]
    );
    validateCoursePlanRecordList(
      coursePlan,
      "weeklyGuide",
      path,
      ["week", "topic"]
    );

    ["deadlines", "exams"].forEach((key) => {
      (Array.isArray(coursePlan[key]) ? coursePlan[key] : [])
        .forEach((item, index) => {
          validateOptionalString(
            item,
            "type",
            path + "." + key + "[" + index + "]"
          );
        });
    });
    const weeklyGuide = Array.isArray(coursePlan.weeklyGuide)
      ? coursePlan.weeklyGuide
      : [];
    weeklyGuide.forEach((week, index) => {
      ["activities", "assignments", "resources"].forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(week, key)) return;
        validateNonEmptyStringList(
          week[key],
          path + ".weeklyGuide[" + index + "]." + key
        );
      });
    });

    ["topics", "courseRequirements"].forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(coursePlan, key)) return;
      validateNonEmptyStringList(coursePlan[key], path + "." + key);
    });
  }

  function validateBackupPreferences(parsed) {
    if (!Object.prototype.hasOwnProperty.call(parsed, "preferences")) return;
    const preferences = parsed.preferences;
    if (!isRecord(preferences)) {
      throw new Error("Backup preferences must be an object.");
    }
    if (
      Object.prototype.hasOwnProperty.call(preferences, "activeView") &&
      !["today", "courses", "calendar", "data"].includes(
        preferences.activeView
      )
    ) {
      throw new Error(
        "Backup preferences.activeView must be one of today, courses, calendar, or data."
      );
    }
    ["activeCourseId", "language", "calendarCourseFilter"].forEach((key) => {
      validateOptionalString(preferences, key, "Backup preferences");
    });
  }

  function validateBackupMetadata(parsed) {
    if (!Object.prototype.hasOwnProperty.call(parsed, "metadata")) return;
    const metadata = parsed.metadata;
    if (!isRecord(metadata)) {
      throw new Error("Backup metadata must be an object.");
    }
    ["updatedAt", "lastBackupAt"].forEach((key) => {
      validateOptionalString(metadata, key, "Backup metadata");
    });
  }

  function validateTaskList(tasks, parentLabel) {
    if (!Array.isArray(tasks)) {
      throw new Error(parentLabel + " tasks must be a list.");
    }
    const taskIds = new Set();
    tasks.forEach((task, taskIndex) => {
      const taskLabel = parentLabel + " task " + (taskIndex + 1);
      if (!isRecord(task)) {
        throw new Error(taskLabel + " must be an object.");
      }
      if (!isNonEmptyString(task.id)) {
        throw new Error(taskLabel + " must have a non-empty id.");
      }
      const taskId = task.id.trim();
      if (taskIds.has(taskId)) {
        throw new Error(
          parentLabel + ' contains duplicate task id "' + taskId + '".'
        );
      }
      taskIds.add(taskId);
      if (!isNonEmptyString(task.title)) {
        throw new Error(taskLabel + " must have a non-empty title.");
      }
      if (
        Object.prototype.hasOwnProperty.call(task, "done") &&
        typeof task.done !== "boolean"
      ) {
        throw new Error(taskLabel + " done must be true or false.");
      }
      ["assignmentId", "localNote"].forEach((key) => {
        validateOptionalString(task, key, taskLabel);
      });
      if (
        Object.prototype.hasOwnProperty.call(task, "semanticKey") &&
        typeof task.semanticKey !== "string"
      ) {
        throw new Error(taskLabel + " semanticKey must be a string.");
      }
      if (
        typeof task.semanticKey === "string" &&
        !task.semanticKey.trim()
      ) {
        throw new Error(
          taskLabel + " semanticKey must be a non-empty string."
        );
      }
      if (
        Object.prototype.hasOwnProperty.call(task, "semanticOccurrence") &&
        (
          !Number.isInteger(task.semanticOccurrence) ||
          task.semanticOccurrence < 1
        )
      ) {
        throw new Error(
          taskLabel + " semanticOccurrence must be a positive integer."
        );
      }
    });
  }

  function validateStringOrFiniteNumber(record, key, path) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return;
    const value = record[key];
    if (
      typeof value !== "string" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(
        path + "." + key + " must be a string or finite number."
      );
    }
  }

  function validateAssignment(assignment, assignmentLabel) {
    if (!isRecord(assignment)) {
      throw new Error(assignmentLabel + " must be an object.");
    }
    if (!isNonEmptyString(assignment.id)) {
      throw new Error(assignmentLabel + " must have a non-empty id.");
    }
    if (!isNonEmptyString(assignment.title)) {
      throw new Error(assignmentLabel + " must have a non-empty title.");
    }
    [
      "dueDate",
      "dueAt",
      "category",
      "sourceType",
      "confidenceLabel",
      "priorityBand",
      "nextAction",
      "createdAt",
      "updatedAt"
    ].forEach((key) => validateOptionalString(assignment, key, assignmentLabel));
    ["points", "weight"].forEach((key) => {
      validateStringOrFiniteNumber(assignment, key, assignmentLabel);
    });
    [
      "estimateMinutes",
      "estimatedRemainingMinutes",
      "priorityScore",
      "confidence"
    ].forEach((key) => {
      if (
        Object.prototype.hasOwnProperty.call(assignment, key) &&
        (
          typeof assignment[key] !== "number" ||
          !Number.isFinite(assignment[key])
        )
      ) {
        throw new Error(
          assignmentLabel + " " + key + " must be a finite number."
        );
      }
    });
    if (Object.prototype.hasOwnProperty.call(assignment, "details")) {
      if (!isRecord(assignment.details)) {
        throw new Error(assignmentLabel + " details must be an object.");
      }
      validateAssignmentDetails(
        assignment.details,
        assignmentLabel + " details"
      );
    }
    if (Object.prototype.hasOwnProperty.call(assignment, "status")) {
      validateStatus(assignment.status, assignmentLabel + " status");
    }
    if (Object.prototype.hasOwnProperty.call(assignment, "source")) {
      validateSource(assignment.source, assignmentLabel + " source");
    }
    ["links", "warnings", "actionPlan"].forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(assignment, key)) return;
      validateNonEmptyStringList(
        assignment[key],
        assignmentLabel + " " + key
      );
    });
    if (Object.prototype.hasOwnProperty.call(assignment, "evidence")) {
      validateEvidenceList(
        assignment.evidence,
        assignmentLabel + " evidence"
      );
    }
    if (Object.prototype.hasOwnProperty.call(assignment, "tasks")) {
      validateTaskList(assignment.tasks, assignmentLabel);
    }
  }

  function validateBackupRoot(parsed) {
    if (!isRecord(parsed)) {
      throw new Error("Backup must contain a valid workspace object.");
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "schemaVersion")) {
      if (
        !Number.isInteger(parsed.schemaVersion) ||
        parsed.schemaVersion < 1
      ) {
        throw new Error(
          "Backup schemaVersion must be a positive integer."
        );
      }
      if (parsed.schemaVersion > WORKSPACE_SCHEMA_VERSION) {
        throw new Error(
          "Backup schemaVersion " + parsed.schemaVersion +
          " is newer than supported version " + WORKSPACE_SCHEMA_VERSION +
          ". Update ClassPilot before restoring this backup."
        );
      }
    }
    if (!Array.isArray(parsed.courses)) {
      throw new Error("Backup must contain a valid course list.");
    }
    validateBackupPreferences(parsed);
    validateBackupMetadata(parsed);
    const courseIds = new Set();
    parsed.courses.forEach((course, index) => {
      const courseLabel = "Backup course " + (index + 1);
      if (!isRecord(course)) {
        throw new Error(courseLabel + " must be an object.");
      }
      if (!isNonEmptyString(course.id)) {
        throw new Error(courseLabel + " must have a non-empty id.");
      }
      const courseId = course.id.trim();
      if (courseIds.has(courseId)) {
        throw new Error('Backup contains duplicate course id "' + courseId + '".');
      }
      courseIds.add(courseId);
      ["code", "name"].forEach((key) => {
        validateOptionalString(course, key, courseLabel);
      });
      if (!isNonEmptyString(course.code) && !isNonEmptyString(course.name)) {
        throw new Error(courseLabel + " must have a code or name.");
      }
      if (
        Object.prototype.hasOwnProperty.call(course, "coursePlan") &&
        !isRecord(course.coursePlan)
      ) {
        throw new Error(courseLabel + " coursePlan must be an object.");
      }
      if (Object.prototype.hasOwnProperty.call(course, "coursePlan")) {
        validateCoursePlan(course.coursePlan, courseLabel + " coursePlan");
      }
      if (Object.prototype.hasOwnProperty.call(course, "source")) {
        validateSource(course.source, courseLabel + " source");
      }
      if (Object.prototype.hasOwnProperty.call(course, "status")) {
        validateStatus(course.status, courseLabel + " status");
      }
      ["warnings", "actionPlan"].forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(course, key)) return;
        validateNonEmptyStringList(course[key], courseLabel + " " + key);
      });
      if (Object.prototype.hasOwnProperty.call(course, "evidence")) {
        validateEvidenceList(course.evidence, courseLabel + " evidence");
      }
      if (Object.prototype.hasOwnProperty.call(course, "assignments") &&
        !Array.isArray(course.assignments)) {
        throw new Error(courseLabel + " assignments must be a list.");
      }
      const assignmentIds = new Set();
      (course.assignments || []).forEach((assignment, assignmentIndex) => {
        const assignmentLabel = courseLabel + " assignment " +
          (assignmentIndex + 1);
        validateAssignment(assignment, assignmentLabel);
        const assignmentId = assignment.id.trim();
        if (assignmentIds.has(assignmentId)) {
          throw new Error(
            courseLabel + ' contains duplicate assignment id "' +
            assignmentId + '".'
          );
        }
        assignmentIds.add(assignmentId);
      });
      if (Object.prototype.hasOwnProperty.call(course, "tasks")) {
        validateTaskList(course.tasks, courseLabel);
      }
    });
  }

  function serializeWorkspaceBackup(workspace, now = new Date()) {
    const normalized = normalizeWorkspace(workspace, now);
    normalized.metadata.lastBackupAt = isoNow(now);
    return JSON.stringify(normalized, null, 2);
  }

  function parseWorkspaceBackup(text) {
    let parsed;
    try { parsed = JSON.parse(String(text || "")); }
    catch (error) { throw new Error("Backup is not valid JSON."); }
    validateBackupRoot(parsed);
    return normalizeWorkspace(parsed);
  }

  function assignmentPlanningItems(assignment = {}) {
    const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : [];
    if (tasks.length > 0) return tasks;
    return Array.isArray(assignment.details?.steps)
      ? assignment.details.steps
      : [];
  }

  function isIncompletePlanningItem(item) {
    return typeof item === "string" || !item?.done;
  }

  function estimateAssignmentMinutes(assignment = {}) {
    if (Number(assignment.estimateMinutes) > 0) {
      return Math.min(1200, Math.max(30, Number(assignment.estimateMinutes)));
    }
    const details = assignment.details || {};
    const text = [...(details.requirements || []), ...(details.deliverables || [])]
      .join(" ").toLowerCase();
    const stepCount = assignmentPlanningItems(assignment).length;
    let minutes = Math.max(30, stepCount * 30);
    if (/research|source|bibliograph|citation/.test(text)) minutes += 60;
    if (/interview|survey|primary research/.test(text)) minutes += 120;
    const pages = text.match(/(\d+)\s*(?:-|to)?\s*\d*\s*pages?/);
    if (pages) minutes += Number(pages[1]) * 35;
    return Math.min(1200, Math.ceil(minutes / 15) * 15);
  }

  function estimateRemainingMinutes(assignment = {}) {
    const total = estimateAssignmentMinutes(assignment);
    const items = assignmentPlanningItems(assignment);
    if (items.length === 0) return total;
    const incomplete = items.filter(isIncompletePlanningItem).length;
    if (incomplete === 0) return 0;
    return Math.ceil((total * incomplete / items.length) / 15) * 15;
  }

  function assignmentNextAction(assignment = {}) {
    const items = assignmentPlanningItems(assignment);
    const next = items.find(isIncompletePlanningItem);
    if (typeof next === "string") return next;
    if (next?.title) return next.title;
    if (items.length > 0) return "Review and submit the assignment";
    return "Review the assignment requirements";
  }

  function exactStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function completionInfo(assignment = {}) {
    const status = assignment.status;
    const statusValue = typeof status === "string"
      ? exactStatus(status)
      : exactStatus(status?.value || status?.status);
    const category = exactStatus(assignment.category);
    const grading = exactStatus(
      status && typeof status === "object" ? status.grading : ""
    );
    const completed = Boolean(
      status &&
      typeof status === "object" &&
      status.completed === true
    ) || ["complete", "completed", "feedback"].includes(statusValue) ||
      ["complete", "completed", "feedback"].includes(category);
    const graded = statusValue === "graded" ||
      category === "graded" ||
      grading === "graded" ||
      hasMeaningfulScore(
        status && typeof status === "object" ? status.score : undefined
      );
    const submitted = Boolean(
      status &&
      typeof status === "object" &&
      status.submittedAt
    ) || statusValue === "submitted" || category === "submitted";
    if (!completed && !graded && !submitted) return null;

    const candidates = completed
      ? [status?.completedAt, assignment.updatedAt, status?.submittedAt,
          assignment.dueAt, assignment.dueDate]
      : graded
        ? [status?.gradedAt, assignment.updatedAt, status?.submittedAt,
            assignment.dueAt, assignment.dueDate]
        : [status?.submittedAt, assignment.updatedAt, assignment.dueAt,
            assignment.dueDate];
    const completedAt = candidates.find((value) =>
      Number.isFinite(Date.parse(String(value || "")))
    ) || "";
    return {
      label: completed ? "Completed" : graded ? "Graded" : "Submitted",
      completedAt,
      timestamp: completedAt ? Date.parse(completedAt) : 0
    };
  }

  function numericSignal(value) {
    const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 0;
  }

  function assignmentImpactRisk(assignment = {}) {
    const details = assignment.details || {};
    const values = [
      assignment.points,
      assignment.weight,
      details.points,
      details.weight
    ];
    return values.reduce((risk, value) => {
      const amount = numericSignal(value);
      if (!amount) return risk;
      const next = String(value || "").includes("%")
        ? Math.min(40, amount * 0.8)
        : Math.min(40, Math.sqrt(amount) * 3);
      return Math.max(risk, next);
    }, 0);
  }

  function missingInformationRisk(assignment, dueAt) {
    const details = assignment.details || {};
    let risk = 0;
    if (!dueAt) risk += 30;
    if (
      (details.requirements || []).length === 0 &&
      (details.deliverables || []).length === 0
    ) {
      risk += 10;
    }
    if (assignmentPlanningItems(assignment).length === 0) risk += 10;
    return risk;
  }

  function urgencyScore(deltaHours) {
    if (!Number.isFinite(deltaHours)) return 40;
    if (deltaHours < 0) {
      return 1000 + Math.min(200, Math.abs(deltaHours) * 2);
    }
    if (deltaHours <= 24) return 600 + (24 - deltaHours) * 4;
    if (deltaHours <= 72) return 400 + (72 - deltaHours) * 2;
    if (deltaHours <= 168) return 220 + (168 - deltaHours);
    return Math.max(40, 180 - (deltaHours - 168) / 12);
  }

  function priorityBandFor(priorityScore) {
    // Fixed score thresholds keep visible urgency monotonic with queue order.
    if (priorityScore >= 600) return "do-now";
    if (priorityScore >= 300) return "do-next";
    return "planned";
  }

  function assignmentPriority(assignment, dueAt, deltaHours) {
    const estimatedRemainingMinutes = estimateRemainingMinutes(assignment);
    // Score = urgency + remaining effort + points/weight + missing-info/late risk.
    const priorityScore = urgencyScore(deltaHours) +
      Math.min(45, estimatedRemainingMinutes / 15) +
      assignmentImpactRisk(assignment) +
      missingInformationRisk(assignment, dueAt) +
      (assignment.status?.late ? 30 : 0);
    return {
      estimatedRemainingMinutes,
      priorityBand: priorityBandFor(priorityScore),
      priorityScore
    };
  }

  function buildTodayQueue(workspace, now = new Date()) {
    const current = new Date(now).getTime();
    const active = [];
    const recentlyCompleted = [];
    normalizeWorkspace(workspace, now).courses.forEach((course) => {
      (course.assignments || []).forEach((assignment) => {
        const dueAt = assignmentDueAt(assignment, now);
        const completion = completionInfo(assignment);
        if (completion) {
          recentlyCompleted.push({
            ...clone(assignment),
            courseId: course.id,
            courseCode: course.code,
            courseName: course.name,
            dueAt,
            completionLabel: completion.label,
            completedAt: completion.completedAt,
            completionTimestamp: completion.timestamp
          });
          return;
        }
        const deltaHours = dueAt
          ? (new Date(dueAt).getTime() - current) / 3600000
          : Infinity;
        const priority = assignmentPriority(
          assignment,
          dueAt,
          deltaHours
        );
        active.push({
          ...clone(assignment),
          courseId: course.id,
          courseCode: course.code,
          dueAt,
          estimateMinutes: estimateAssignmentMinutes(assignment),
          estimatedRemainingMinutes: priority.estimatedRemainingMinutes,
          priorityBand: priority.priorityBand,
          priorityScore: priority.priorityScore,
          nextAction: assignmentNextAction(assignment)
        });
      });
    });
    active.sort((a, b) => b.priorityScore - a.priorityScore ||
      String(a.title || "").localeCompare(String(b.title || "")));
    recentlyCompleted.sort((a, b) =>
      b.completionTimestamp - a.completionTimestamp ||
      String(a.title || "").localeCompare(String(b.title || ""))
    );
    return {
      active,
      now: active[0] || null,
      upNext: active.slice(1, 5),
      thisWeek: active.filter((item) => item.dueAt &&
        new Date(item.dueAt).getTime() - current <= 7 * 86400000),
      recentlyCompleted: recentlyCompleted.slice(0, 5).map((item) => {
        const next = { ...item };
        delete next.completionTimestamp;
        return next;
      })
    };
  }

  function enrichWorkspacePlanningFields(workspace, now = new Date()) {
    const next = normalizeWorkspace(workspace, now);
    const queue = buildTodayQueue(next, now);
    const planning = new Map(
      queue.active.map((item) => [item.courseId + "|" + item.id, item])
    );
    next.courses = next.courses.map((course) => ({
      ...course,
      assignments: (course.assignments || []).map((assignment) => {
        const item = planning.get(course.id + "|" + assignment.id);
        return {
          ...assignment,
          dueAt: assignmentDueAt(assignment, now),
          estimateMinutes: item?.estimateMinutes ||
            estimateAssignmentMinutes(assignment),
          estimatedRemainingMinutes: item
            ? item.estimatedRemainingMinutes
            : estimateRemainingMinutes(assignment),
          priorityBand: item?.priorityBand || "planned",
          nextAction: item?.nextAction || assignmentNextAction(assignment)
        };
      })
    }));
    return next;
  }

  const createWorkspaceSnapshot = (workspace) => JSON.stringify(normalizeWorkspace(workspace));
  const restoreWorkspaceSnapshot = (snapshot) => normalizeWorkspace(JSON.parse(snapshot));

  const api = {
    WORKSPACE_SCHEMA_VERSION,
    buildCalendarItems,
    buildTodayQueue,
    createEmptyWorkspace,
    createIcsCalendar,
    createWorkspaceSnapshot,
    enrichWorkspacePlanningFields,
    estimateAssignmentMinutes,
    estimateRemainingMinutes,
    hasMeaningfulScore,
    migrateLegacyCourses,
    normalizeWorkspace,
    removeAssignment,
    removeWorkspaceCourse,
    replaceCoursePlan,
    parseDueAt,
    parseWorkspaceBackup,
    restoreWorkspaceSnapshot,
    serializeWorkspaceBackup,
    updateCourse,
    updateAssignment
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClassPilotPlanner = api;
})(typeof window !== "undefined" ? window : globalThis);
