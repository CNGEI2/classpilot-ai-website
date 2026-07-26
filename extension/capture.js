(function attachClassPilotCanvasCapture(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotCanvasCapture = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCanvasCapture() {
  "use strict";

  const RAW_TEXT_LIMIT = 100000;
  const LIST_LIMIT = 40;

  function cleanText(value, maxLength = 2000) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function cleanMultiline(value, maxLength = RAW_TEXT_LIMIT) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function cleanList(values, maxItems = LIST_LIMIT, maxLength = 1000) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((value) => cleanText(value, maxLength))
      .filter(Boolean))]
      .slice(0, maxItems);
  }

  function optional(target, key, value) {
    if (value !== "" && value != null && (!Array.isArray(value) || value.length)) {
      target[key] = value;
    }
    return target;
  }

  function parsedUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url;
    } catch (_error) {
      return null;
    }
  }

  function idsFromUrl(url) {
    const pathname = url?.pathname || "";
    const course = pathname.match(/\/courses\/(\d+)(?:\/|$)/i);
    const assignment = pathname.match(/\/courses\/\d+\/assignments\/(\d+)(?:\/|$)/i);
    return {
      courseId: course?.[1] || "",
      assignmentId: assignment?.[1] || ""
    };
  }

  function courseCode(value) {
    const source = cleanText(value, 300);
    const section = source.match(/\b([A-Z]{2,}\s*\d{2,4})\s*-\s*([A-Z0-9]+)\b/i);
    if (section) return `${section[1].replace(/\s+/g, "").toUpperCase()}-${section[2].toUpperCase()}`;
    const plain = source.match(/\b([A-Z]{2,}\s*\d{2,4}[A-Z]?)\b/i);
    return plain ? plain[1].replace(/\s+/g, "").toUpperCase() : "";
  }

  function courseBreadcrumb(values) {
    const items = cleanList(values, 12, 500);
    return items.find((item) =>
      !/^(home|assignments|syllabus|modules|grades|pages)$/i.test(item) && courseCode(item)
    ) || items.find((item) => !/^(home|assignments|syllabus)$/i.test(item)) || "";
  }

  function assignmentTitle(snapshot, breadcrumbs) {
    const assignmentIndex = breadcrumbs.findIndex((item) => /^assignments$/i.test(item));
    if (assignmentIndex >= 0 && breadcrumbs[assignmentIndex + 1]) {
      return cleanText(breadcrumbs[assignmentIndex + 1], 500);
    }
    return cleanText(snapshot.title, 500)
      .replace(/\s*[:|-]\s*Canvas\s*$/i, "")
      .trim();
  }

  function fieldMatch(text, expression) {
    return cleanText(text.match(expression)?.[1], 500);
  }

  function extractDueDate(text) {
    return fieldMatch(text, /(?:^|\n)\s*Due:\s*([^\n]+)/i)
      .replace(/^(.*?)(?:\s*Due:\s*\1)+$/i, "$1");
  }

  function extractPoints(text) {
    const match = text.match(/(?:^|\n)\s*(\d+(?:\.\d+)?\s+Points?(?:\s+Possible)?)(?:\s|$)/i);
    return cleanText(match?.[1], 120);
  }

  function extractStatus(text) {
    const status = {};
    const state = text.match(/(?:^|\n)\s*(Late|In Progress|Submitted|Graded|Not Submitted)(?:\s|$)/i)?.[1];
    const nextUp = fieldMatch(text, /(?:^|\n)\s*NEXT UP:\s*([^\n]+)/i);
    const submittedAt = fieldMatch(text, /(?:^|\n)\s*Submitted on\s+([^\n]+)/i);
    const score = fieldMatch(text, /(?:Attempt\s+\d+\s+Score|Score):\s*([^\n]+)/i);
    optional(status, "state", cleanText(state, 120));
    optional(status, "nextUp", nextUp);
    optional(status, "submittedAt", submittedAt);
    optional(status, "score", score);
    return status;
  }

  function extractInstructions(text) {
    const lines = cleanMultiline(text).split("\n").map((line) => line.trim()).filter(Boolean);
    const detailIndex = lines.findIndex((line) => /^details$/i.test(line));
    const start = detailIndex >= 0 ? detailIndex + 1 : 0;
    const stopPatterns = /^(choose a submission type|submission types?|previous|next|submit assignment)$/i;
    const selected = [];
    for (let index = start; index < lines.length; index += 1) {
      if (stopPatterns.test(lines[index])) break;
      selected.push(lines[index]);
    }
    return cleanMultiline(selected.join("\n"), 80000);
  }

  function parseCanvasSnapshot(snapshot = {}) {
    const url = parsedUrl(snapshot.url);
    const ids = idsFromUrl(url);
    const breadcrumbs = cleanList(snapshot.breadcrumbs, 12, 500);
    const courseLabel = courseBreadcrumb(breadcrumbs);
    const rawText = cleanMultiline(snapshot.mainText, RAW_TEXT_LIMIT);
    const isSyllabus = /(?:^|\/)syllabus(?:\/|$)/i.test(url?.pathname || "") ||
      breadcrumbs.some((item) => /^syllabus$/i.test(item)) ||
      snapshot.pageKind === "syllabus";
    const capture = {
      version: 1,
      capturedAt: cleanText(snapshot.capturedAt, 80) || new Date().toISOString(),
      sourceUrl: url?.href || "",
      sourceType: isSyllabus ? "Course syllabus" : "Canvas assignment page",
      canvasHost: url?.hostname.toLowerCase() || "",
      course: {
        canvasId: ids.courseId,
        code: courseCode(courseLabel),
        name: cleanText(courseLabel, 500)
      },
      rawText
    };

    if (isSyllabus) {
      capture.syllabus = { text: rawText };
      return capture;
    }

    const assignment = {
      canvasId: ids.assignmentId,
      title: assignmentTitle(snapshot, breadcrumbs)
    };
    optional(assignment, "dueDate", extractDueDate(rawText));
    optional(assignment, "points", extractPoints(rawText));
    const status = extractStatus(rawText);
    if (Object.keys(status).length) assignment.status = status;
    optional(assignment, "instructionsText", extractInstructions(rawText));
    optional(assignment, "links", (Array.isArray(snapshot.links) ? snapshot.links : [])
      .map((item) => ({
        text: cleanText(item?.text, 300),
        href: parsedUrl(item?.href)?.href || ""
      }))
      .filter((item) => item.href)
      .slice(0, 40));
    optional(assignment, "submissionTypes", cleanList(snapshot.submissionTypes, 12, 80));
    optional(assignment, "allowedExtensions", cleanList(snapshot.allowedExtensions, 20, 20)
      .map((item) => item.replace(/^\./, "").toLowerCase()));
    optional(assignment, "rubric", (Array.isArray(snapshot.rubric) ? snapshot.rubric : [])
      .map((item) => ({
        label: cleanText(item?.label, 300),
        description: cleanText(item?.description, 1200),
        points: cleanText(item?.points, 120)
      }))
      .filter((item) => item.label)
      .slice(0, 30));
    capture.assignment = assignment;
    return capture;
  }

  function visibleElement(element) {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function textOf(element) {
    return cleanText(element?.innerText || element?.textContent, 2000);
  }

  function captureCanvasPage(documentRef, locationRef) {
    if (!documentRef) return parseCanvasSnapshot({ url: locationRef?.href || "" });
    const main = documentRef.querySelector?.("#content, #content-wrapper, main, [role='main']") || documentRef.body;
    const clone = main?.cloneNode?.(true);
    if (clone?.querySelectorAll) {
      clone.querySelectorAll(
        "script, style, noscript, form, input, textarea, select, [hidden], [aria-hidden='true'], nav, header, footer"
      ).forEach((element) => element.remove());
    }
    const breadcrumbs = Array.from(documentRef.querySelectorAll?.(
      "[aria-label*='breadcrumb' i] a, [aria-label*='breadcrumb' i] span, .ic-app-crumbs a, .ic-app-crumbs span"
    ) || []).filter(visibleElement).map(textOf).filter(Boolean);
    const headings = Array.from(main?.querySelectorAll?.("h1, h2, h3") || [])
      .filter(visibleElement).map(textOf).filter(Boolean);
    const links = Array.from(main?.querySelectorAll?.("a[href]") || [])
      .filter(visibleElement)
      .map((link) => ({ text: textOf(link), href: link.href }))
      .filter((link) => link.href);
    const rubric = Array.from(main?.querySelectorAll?.("[data-testid*='rubric'] tr, .rubric_table tr") || [])
      .map((row) => Array.from(row.querySelectorAll("th, td")).map(textOf).filter(Boolean))
      .filter((cells) => cells.length)
      .map((cells) => ({
        label: cells[0],
        description: cells.slice(1, -1).join(" "),
        points: cells.length > 1 ? cells[cells.length - 1] : ""
      }));
    const mainText = cleanMultiline(clone?.innerText || clone?.textContent || main?.innerText || main?.textContent);
    const submissionTypes = ["Text", "Web URL", "Media", "Upload", "Studio", "File Upload", "Website URL"]
      .filter((label) => new RegExp(`(?:^|\\n)\\s*${label.replace(" ", "\\s+")}\\s*(?:\\n|$)`, "i").test(mainText));
    const allowedExtensions = [...mainText.matchAll(/\.(pdf|docx|pptx|txt|rtf|zip|jpg|jpeg|png)\b/gi)]
      .map((match) => match[1]);
    return parseCanvasSnapshot({
      url: locationRef?.href || documentRef.location?.href || "",
      title: documentRef.title,
      breadcrumbs,
      headings,
      mainText,
      links,
      rubric,
      submissionTypes,
      allowedExtensions
    });
  }

  function validateCapture(capture = {}) {
    const missing = [];
    if (!cleanText(capture.canvasHost, 300)) missing.push("canvasHost");
    if (!capture.course || (!cleanText(capture.course.code, 160) &&
      !cleanText(capture.course.name, 500) && !cleanText(capture.course.canvasId, 160))) {
      missing.push("course");
    }
    if (!cleanText(capture.assignment?.title, 500) && !cleanMultiline(capture.syllabus?.text, 1000)) {
      missing.push("material");
    }
    return {
      valid: missing.length === 0,
      missing,
      message: missing.length
        ? "Open a Canvas assignment, rubric, or syllabus page and try again."
        : "Ready to add to ClassPilot."
    };
  }

  return {
    RAW_TEXT_LIMIT,
    captureCanvasPage,
    parseCanvasSnapshot,
    validateCapture
  };
});
