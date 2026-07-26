(function attachClassPilotCanvasCalendar(root, factory) {
  const connector = root.ClassPilotCanvasConnector || (
    typeof require === "function" ? require("./canvas-connector.js") : {}
  );
  const planner = root.ClassPilotPlanner || (
    typeof require === "function" ? require("./planner.js") : {}
  );
  const api = factory(connector, planner);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotCanvasCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCanvasCalendar(
  connector,
  planner
) {
  "use strict";

  const MAX_ICS_CHARACTERS = 1000000;
  const MAX_EVENTS = 1000;

  function cleanText(value, maxLength = 2000) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function cleanMultiline(value, maxLength = 20000) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function normalizeCanvasCalendarFeedUrl(value) {
    const source = String(value || "").trim().replace(/^webcal:/i, "https:");
    if (!source) return "";
    try {
      const url = new URL(source);
      const hostname = url.hostname.toLowerCase();
      const validHost = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) &&
        hostname.includes(".") && !/^\d+(?:\.\d+){3}$/.test(hostname) &&
        !hostname.includes(":");
      const validPath = /^\/feeds\/calendars\/[a-z0-9._~-]+\.ics$/i.test(url.pathname);
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
          url.hash || !validHost || !validPath) return "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function unfoldIcsLines(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .reduce((lines, line) => {
        if (/^[ \t]/.test(line) && lines.length) {
          lines[lines.length - 1] += line.slice(1);
        } else {
          lines.push(line);
        }
        return lines;
      }, []);
  }

  function unescapeIcsText(value) {
    return String(value || "")
      .replace(/\\[nN]/g, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }

  function parseProperty(line) {
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const declaration = line.slice(0, separator).split(";");
    const name = declaration.shift().toUpperCase();
    const params = {};
    declaration.forEach((part) => {
      const equals = part.indexOf("=");
      if (equals > 0) params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1);
    });
    return { name, params, value: unescapeIcsText(line.slice(separator + 1)) };
  }

  function parseEvents(ics) {
    const events = [];
    let current = null;
    for (const line of unfoldIcsLines(ics)) {
      if (line.toUpperCase() === "BEGIN:VEVENT") {
        current = {};
        continue;
      }
      if (line.toUpperCase() === "END:VEVENT") {
        if (current) events.push(current);
        current = null;
        if (events.length >= MAX_EVENTS) break;
        continue;
      }
      if (!current) continue;
      const property = parseProperty(line);
      if (!property) continue;
      current[property.name] ||= [];
      current[property.name].push(property);
    }
    return events;
  }

  function firstProperty(event, name) {
    return event?.[name]?.[0] || { value: "", params: {} };
  }

  function icsDate(property) {
    const raw = cleanText(property?.value, 80);
    const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    const dateTime = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i);
    if (!dateTime) return "";
    const base = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T` +
      `${dateTime[4]}:${dateTime[5]}:${dateTime[6]}`;
    if (!dateTime[7]) return base;
    const parsed = new Date(base + "Z");
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }

  function stableSlug(value) {
    return cleanText(value, 300).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function eventIdentity(event, sourceUrl) {
    const uid = cleanText(firstProperty(event, "UID").value, 300);
    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch (_error) {
      parsedUrl = null;
    }
    const courseId = sourceUrl.match(/\/courses\/([^/?#]+)/i)?.[1] ||
      parsedUrl?.searchParams.get("include_contexts")?.match(/(?:^|,)course_([^,]+)/i)?.[1] ||
      sourceUrl.match(/(?:^|[?&,])course_([^&#,]+)/i)?.[1] || "";
    const assignmentId = sourceUrl.match(/\/assignments\/([^/?#]+)/i)?.[1] ||
      uid.match(/assignment[_-]([a-z0-9]+)/i)?.[1] || "";
    const eventId = parsedUrl?.searchParams.get("event_id") ||
      uid.match(/event[_-]([a-z0-9]+)/i)?.[1] || "";
    return {
      uid,
      courseId: cleanText(courseId, 160),
      assignmentId: cleanText(assignmentId, 160),
      eventId: cleanText(eventId, 160)
    };
  }

  function eventCourseAndTitle(summary) {
    const source = cleanText(summary, 500);
    const bracket = source.match(/\s*\[([^\]]+)\]\s*$/);
    return {
      courseCode: cleanText(bracket?.[1], 160),
      title: cleanText(bracket ? source.slice(0, bracket.index) : source, 500)
    };
  }

  function parseCanvasCalendarFeed(ics, feedUrl) {
    const normalizedUrl = normalizeCanvasCalendarFeedUrl(feedUrl);
    if (!normalizedUrl) throw new Error("Enter a valid Canvas calendar feed URL.");
    const source = String(ics || "");
    if (!source || source.length > MAX_ICS_CHARACTERS || !/BEGIN:VCALENDAR/i.test(source)) {
      throw new Error("Canvas returned an invalid calendar feed.");
    }
    const domain = new URL(normalizedUrl).hostname.toLowerCase();
    const events = parseEvents(source);
    const courses = new Map();
    let skippedEventCount = 0;

    events.forEach((event) => {
      const summary = firstProperty(event, "SUMMARY").value;
      const { courseCode, title } = eventCourseAndTitle(summary);
      const sourceUrl = cleanText(firstProperty(event, "URL").value, 2000);
      const identity = eventIdentity(event, sourceUrl);
      const dueAt = icsDate(firstProperty(event, "DTSTART"));
      if ((!identity.courseId && !courseCode) || !title || !dueAt) {
        skippedEventCount += 1;
        return;
      }
      const courseKey = identity.courseId || `code:${courseCode.toLowerCase()}`;
      if (!courses.has(courseKey)) {
        courses.set(courseKey, {
          id: identity.courseId || `calendar-${stableSlug(domain)}-${stableSlug(courseCode)}`,
          course_code: courseCode || `Canvas ${identity.courseId}`,
          name: courseCode || `Canvas course ${identity.courseId}`,
          source_type: "Canvas calendar feed",
          assignments: [],
          deadlines: [],
          exams: []
        });
      }
      const course = courses.get(courseKey);
      if (!course.course_code && courseCode) course.course_code = courseCode;
      const description = cleanMultiline(firstProperty(event, "DESCRIPTION").value, 20000);
      if (identity.assignmentId) {
        course.assignments.push({
          id: identity.assignmentId,
          name: title,
          due_at: dueAt,
          html_url: sourceUrl,
          description,
          source_type: "Canvas calendar feed"
        });
        return;
      }
      const calendarId = identity.eventId || stableSlug(identity.uid || `${title}-${dueAt}`);
      const record = {
        id: `canvas-event-${calendarId}`,
        label: title,
        date: dueAt,
        type: /\b(?:final|midterm|exam)\b/i.test(title) ? "exam" : "deadline",
        source: {
          type: "Canvas calendar feed",
          canvasEventId: calendarId,
          htmlUrl: sourceUrl
        }
      };
      course.deadlines.push(record);
      if (record.type === "exam") course.exams.push(record);
    });

    return {
      domain,
      courses: [...courses.values()],
      eventCount: events.length,
      importedEventCount: events.length - skippedEventCount,
      skippedEventCount
    };
  }

  function isCalendarRecord(item) {
    return item?.source?.type === "Canvas calendar feed";
  }

  function findMergedCourse(courses, remote, domain) {
    return courses.find((course) =>
      String(course.source?.canvasCourseId || "") === String(remote.id) &&
      course.source?.canvasDomain === domain
    ) || courses.find((course) =>
      cleanText(course.code, 160).toLowerCase() ===
        cleanText(remote.course_code, 160).toLowerCase()
    );
  }

  function mergeCanvasCalendar(workspace, snapshot = {}, now = new Date()) {
    const normalized = {
      domain: snapshot.domain,
      courses: (Array.isArray(snapshot.courses) ? snapshot.courses : []).map((course) => ({
        ...course,
        syllabus_body: ""
      }))
    };
    const next = connector.mergeCanvasSnapshot(workspace, normalized, now);
    normalized.courses.forEach((remote) => {
      const course = findMergedCourse(next.courses, remote, normalized.domain);
      if (!course) return;
      const retainedDeadlines = (Array.isArray(course.coursePlan?.deadlines)
        ? course.coursePlan.deadlines : []).filter((item) => !isCalendarRecord(item));
      const retainedExams = (Array.isArray(course.coursePlan?.exams)
        ? course.coursePlan.exams : []).filter((item) => !isCalendarRecord(item));
      course.coursePlan = {
        ...(course.coursePlan || {}),
        deadlines: [...retainedDeadlines, ...(remote.deadlines || [])],
        exams: [...retainedExams, ...(remote.exams || [])],
        calendarFeedSyncedAt: new Date(now).toISOString()
      };
    });
    return typeof planner.normalizeWorkspace === "function"
      ? planner.normalizeWorkspace(next, now)
      : next;
  }

  return {
    mergeCanvasCalendar,
    normalizeCanvasCalendarFeedUrl,
    parseCanvasCalendarFeed
  };
});
