(function attachClassPilotSourceEvidence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotSourceEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSourceEvidence() {
  "use strict";

  const MAX_SOURCES = 40;

  function cleanText(value, maxLength = 1600) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function cleanId(value) {
    return cleanText(value, 160).replace(/[^a-zA-Z0-9._:-]/g, "-") || "unknown";
  }

  function itemText(item) {
    if (item == null) return "";
    if (typeof item !== "object") return cleanText(item);
    const label = cleanText(item.label || item.week, 240);
    const value = cleanText(
      item.description || item.text || item.topic || item.date || item.weight,
      1300
    );
    if (label && value && label.toLowerCase() !== value.toLowerCase()) {
      return cleanText(`${label}: ${value}`);
    }
    return value || label;
  }

  function buildSourceCatalog(course = {}, assignment = null) {
    const records = [];
    const seen = new Set();
    const courseId = cleanId(course.id);
    const assignmentId = assignment && typeof assignment === "object"
      ? cleanId(assignment.id)
      : "";

    function add(id, kind, title, location, text) {
      if (records.length >= MAX_SOURCES) return;
      const record = {
        id: cleanText(id, 180),
        kind: cleanText(kind, 80),
        title: cleanText(title, 240),
        location: cleanText(location, 240),
        text: cleanText(text, 1600)
      };
      if (!record.id || !record.kind || !record.title || !record.text) return;
      const duplicateKey = `${record.kind}:${record.text.toLowerCase()}`;
      if (seen.has(duplicateKey)) return;
      seen.add(duplicateKey);
      records.push(record);
    }

    function addList(values, options) {
      (Array.isArray(values) ? values : [])
        .slice(0, options.limit)
        .forEach((item, index) => {
          const text = options.format ? options.format(item) : itemText(item);
          const title = options.title ? options.title(item, index) : options.label;
          add(
            `${options.prefix}:${index + 1}`,
            options.kind,
            title,
            `${options.location} ${index + 1}`,
            text
          );
        });
    }

    if (assignmentId) {
      const details = assignment.details && typeof assignment.details === "object"
        ? assignment.details
        : {};
      const prefix = `assignment:${assignmentId}`;
      add(`${prefix}:deadline`, "deadline", "Due date", "Assignment deadline", assignment.dueDate);
      add(`${prefix}:points`, "points", "Points", "Assignment points", assignment.points);
      add(`${prefix}:overview`, "overview", "Overview", "Assignment overview", details.overview);
      addList(details.requirements, {
        prefix: `${prefix}:requirement`,
        kind: "requirement",
        label: "Requirement",
        location: "Requirement",
        limit: 16
      });
      addList(details.deliverables, {
        prefix: `${prefix}:deliverable`,
        kind: "deliverable",
        label: "Deliverable",
        location: "Deliverable",
        limit: 12
      });
      addList(details.rubric, {
        prefix: `${prefix}:rubric`,
        kind: "rubric",
        location: "Rubric criterion",
        limit: 12,
        title(item, index) {
          return cleanText(item?.label, 240) || `Rubric criterion ${index + 1}`;
        },
        format(item) {
          if (!item || typeof item !== "object") return itemText(item);
          const weight = cleanText(item.weight, 120);
          const description = cleanText(item.description, 1400);
          return [weight, description].filter(Boolean).join(": ") || cleanText(item.label, 1600);
        }
      });
      addList(details.steps, {
        prefix: `${prefix}:step`,
        kind: "step",
        label: "Completion step",
        location: "Completion step",
        limit: 16
      });
    }

    const plan = course.coursePlan && typeof course.coursePlan === "object"
      ? course.coursePlan
      : {};
    const coursePrefix = `course:${courseId}`;
    addList(plan.topics, {
      prefix: `${coursePrefix}:topic`,
      kind: "course-topic",
      label: "Course topic",
      location: "Course topic",
      limit: 12
    });
    addList(plan.grading, {
      prefix: `${coursePrefix}:grading`,
      kind: "grading",
      title: (item, index) => cleanText(item?.label, 240) || `Grading item ${index + 1}`,
      location: "Grading item",
      limit: 10
    });
    addList(plan.policies, {
      prefix: `${coursePrefix}:policy`,
      kind: "policy",
      title: (item, index) => cleanText(item?.label, 240) || `Course policy ${index + 1}`,
      location: "Course policy",
      limit: 8
    });
    addList(plan.exams, {
      prefix: `${coursePrefix}:exam`,
      kind: "exam",
      title: (item, index) => cleanText(item?.label, 240) || `Exam ${index + 1}`,
      location: "Exam",
      limit: 8
    });
    addList(plan.weeklyGuide, {
      prefix: `${coursePrefix}:week`,
      kind: "weekly-guide",
      title: (item, index) => cleanText(item?.week || item?.label, 240) || `Week ${index + 1}`,
      location: "Weekly guide",
      limit: 12
    });

    return records;
  }

  function findSourceRecord(catalog, sourceId) {
    const id = cleanText(sourceId, 180);
    return (Array.isArray(catalog) ? catalog : []).find((item) => item?.id === id) || null;
  }

  function validateSourceCitation(value, catalog) {
    if (!value || typeof value !== "object") return null;
    const sourceId = cleanText(value.sourceId, 180);
    const source = findSourceRecord(catalog, sourceId);
    if (!source) return null;
    return {
      sourceId,
      label: cleanText(value.label, 160) || cleanText(source.title, 160),
      excerpt: cleanText(value.excerpt || value.text, 1000) || cleanText(source.text, 1000),
      location: cleanText(value.location, 240) || cleanText(source.location, 240)
    };
  }

  return {
    buildSourceCatalog,
    findSourceRecord,
    validateSourceCitation
  };
});
