(function attachClassPilotCanvasConnector(root, factory) {
  const logic = root.ClassPilotLogic || (
    typeof require === "function" ? require("./logic.js") : {}
  );
  const planner = root.ClassPilotPlanner || (
    typeof require === "function" ? require("./planner.js") : {}
  );
  const api = factory(logic, planner);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotCanvasConnector = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCanvasConnector(logic, planner) {
  "use strict";

  function cleanText(value, maxLength = 2000) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function normalizeCanvasDomain(value) {
    const source = String(value || "").trim();
    if (!source || /^http:\/\//i.test(source)) return "";
    try {
      const url = new URL(/^https:\/\//i.test(source) ? source : "https://" + source);
      if (url.protocol !== "https:" || url.username || url.password ||
          url.port || (url.pathname !== "/" && url.pathname !== "") ||
          url.search || url.hash) return "";
      const hostname = url.hostname.toLowerCase();
      return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) && hostname.includes(".")
        ? hostname
        : "";
    } catch (_error) {
      return "";
    }
  }

  function cleanMultiline(value, maxLength = 100000) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function htmlToText(value) {
    const html = String(value || "").slice(0, 200000);
    if (typeof DOMParser === "function") {
      const documentHtml = new DOMParser().parseFromString(html, "text/html");
      return cleanMultiline(documentHtml.body?.innerText || documentHtml.body?.textContent);
    }
    return cleanMultiline(html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"));
  }

  function htmlListItems(value) {
    const html = String(value || "").slice(0, 200000);
    if (typeof DOMParser === "function") {
      const documentHtml = new DOMParser().parseFromString(html, "text/html");
      return Array.from(documentHtml.querySelectorAll("li"))
        .map((item) => cleanText(item.textContent, 1000))
        .filter(Boolean)
        .slice(0, 40);
    }
    return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((match) => cleanText(htmlToText(match[1]), 1000))
      .filter(Boolean)
      .slice(0, 40);
  }

  function stableId(prefix, ...parts) {
    return prefix + "-" + parts.map((part) => cleanText(part, 160)
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
      .filter(Boolean).join("-");
  }

  function taskKey(task) {
    return cleanText(task?.title, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function preserveTaskState(existing, next) {
    const completed = new Map((existing?.tasks || []).map((task) => [taskKey(task), Boolean(task.done)]));
    return (next.tasks || []).map((task) => ({
      ...task,
      done: completed.has(taskKey(task)) ? completed.get(taskKey(task)) : Boolean(task.done)
    }));
  }

  function canvasStatus(remote = {}) {
    const submission = remote.submission && typeof remote.submission === "object"
      ? remote.submission
      : {};
    const points = Number(remote.points_possible);
    const score = Number(submission.score);
    return {
      value: submission.workflow_state === "graded" ? "Graded" :
        submission.workflow_state === "submitted" ? "Submitted" : "In progress",
      grading: submission.workflow_state === "graded" ? "Graded" : "",
      score: Number.isFinite(score)
        ? Number.isFinite(points) ? score + "/" + points : String(score)
        : "",
      submittedAt: cleanText(submission.submitted_at, 120),
      submission: submission.workflow_state === "submitted" || submission.workflow_state === "graded"
        ? "Submitted"
        : "Not submitted"
    };
  }

  function canvasAssignment(remote, course, localCourseId, existing) {
    const description = htmlToText(remote.description);
    const listItems = htmlListItems(remote.description);
    const due = cleanText(remote.due_at, 120);
    const points = Number(remote.points_possible);
    const material = [
      `${course.course_code || course.name} > Assignments > ${remote.name}`,
      due ? `Due: ${due}` : "",
      Number.isFinite(points) ? `${points} Points Possible` : "",
      description
    ].filter(Boolean).join("\n");
    const draft = logic.createCourseDraftFromMaterial(material);
    draft.code = cleanText(course.course_code, 160) || cleanText(course.name, 160);
    draft.name = cleanText(course.name, 500) || draft.code;
    draft.assignment = cleanText(remote.name, 500) || "Untitled assignment";
    draft.dueDate = due || "No date";
    draft.points = Number.isFinite(points) ? `${points} Points Possible` : "";
    draft.linksText = cleanText(remote.html_url, 2000);
    draft.sourceType = "Canvas API";
    draft.confidence = 100;
    draft.confidenceLabel = "Verified from Canvas";
    draft.status = canvasStatus(remote);
    if (listItems.length) draft.tasksText = listItems.join("\n");
    draft.assignmentDetails = {
      ...(draft.assignmentDetails || {}),
      overview: description,
      requirements: [...new Set([
        ...(draft.assignmentDetails?.requirements || []),
        ...listItems
      ])].slice(0, 40),
      allowedExtensions: (Array.isArray(remote.allowed_extensions)
        ? remote.allowed_extensions
        : []).map((item) => cleanText(item, 20).toLowerCase()).filter(Boolean),
      submissionTypes: (Array.isArray(remote.submission_types)
        ? remote.submission_types
        : []).map((item) => cleanText(item, 80)).filter(Boolean)
    };
    const created = logic.createAssignmentFromDraft(draft, localCourseId);
    const dueAt = due && Number.isFinite(new Date(due).getTime())
      ? new Date(due).toISOString()
      : "";
    const next = {
      ...created,
      id: existing?.id || stableId("canvas-assignment", course.id, remote.id),
      title: draft.assignment,
      dueDate: due || "No date",
      dueAt,
      points: draft.points,
      status: draft.status,
      details: draft.assignmentDetails,
      tasks: preserveTaskState(existing, created),
      source: {
        ...(created.source || {}),
        type: "Canvas API",
        canvasDomain: course.canvasDomain,
        canvasCourseId: String(course.id),
        canvasAssignmentId: String(remote.id),
        htmlUrl: cleanText(remote.html_url, 2000)
      }
    };
    if (existing?.submissionReport) next.submissionReport = existing.submissionReport;
    return next;
  }

  function findCourse(courses, remote, domain) {
    return courses.find((course) =>
      String(course.source?.canvasCourseId || "") === String(remote.id) &&
      course.source?.canvasDomain === domain
    ) || courses.find((course) =>
      cleanText(course.code, 160).toLowerCase() ===
        cleanText(remote.course_code, 160).toLowerCase()
    );
  }

  function mergeCanvasSnapshot(workspace, snapshot = {}, now = new Date()) {
    const domain = normalizeCanvasDomain(snapshot.domain);
    if (!domain) throw new Error("Canvas returned an invalid school domain.");
    const next = planner.normalizeWorkspace(workspace, now);
    for (const remote of Array.isArray(snapshot.courses) ? snapshot.courses.slice(0, 30) : []) {
      if (!remote || remote.id == null) continue;
      const existing = findCourse(next.courses, remote, domain);
      const localCourseId = existing?.id || stableId("canvas-course", domain, remote.id);
      const syllabusText = htmlToText(remote.syllabus_body);
      const syllabusDraft = syllabusText
        ? logic.createCourseDraftFromMaterial(
            `${remote.course_code || "Course"} ${remote.name || ""}\nSyllabus\n${syllabusText}`
          )
        : {};
      const base = existing || {
        id: localCourseId,
        code: cleanText(remote.course_code, 160) || cleanText(remote.name, 160),
        name: cleanText(remote.name, 500) || cleanText(remote.course_code, 160),
        assignments: [],
        coursePlan: {}
      };
      const assignments = [...(base.assignments || [])];
      for (const remoteAssignment of Array.isArray(remote.assignments)
        ? remote.assignments.slice(0, 250)
        : []) {
        const assignmentIndex = assignments.findIndex((assignment) =>
          String(assignment.source?.canvasAssignmentId || "") === String(remoteAssignment.id)
        );
        const existingAssignment = assignmentIndex >= 0 ? assignments[assignmentIndex] : null;
        const merged = canvasAssignment(
          remoteAssignment,
          { ...remote, canvasDomain: domain },
          localCourseId,
          existingAssignment
        );
        if (assignmentIndex >= 0) assignments[assignmentIndex] = merged;
        else assignments.push(merged);
      }
      const course = {
        ...base,
        id: localCourseId,
        code: cleanText(remote.course_code, 160) || base.code,
        name: cleanText(remote.name, 500) || base.name,
        assignments,
        coursePlan: {
          ...(base.coursePlan || {}),
          ...(syllabusDraft.coursePlan || {}),
          term: cleanText(remote.term?.name, 240) ||
            syllabusDraft.coursePlan?.term || base.coursePlan?.term || "",
          syllabusUploaded: Boolean(syllabusText) || Boolean(base.coursePlan?.syllabusUploaded),
          sourceType: "Canvas API"
        },
        source: {
          ...(base.source || {}),
          type: "Canvas API",
          canvasDomain: domain,
          canvasCourseId: String(remote.id)
        }
      };
      const courseIndex = next.courses.findIndex((item) => item.id === localCourseId);
      if (courseIndex >= 0) next.courses[courseIndex] = course;
      else next.courses.push(course);
    }
    next.metadata.updatedAt = new Date(now).toISOString();
    return next;
  }

  return { htmlToText, mergeCanvasSnapshot, normalizeCanvasDomain };
});
