(function attachClassPilotCoach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotCoach = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createClassPilotCoach() {
  "use strict";

  const THREAD_PREFIX = "classpilot.coach.v1";
  const ALLOWED_ACTIONS = new Set(["chat", "explain", "check", "plan"]);
  const ALLOWED_LANGUAGES = new Set(["en", "zh", "bilingual"]);
  const ALLOWED_ROLES = new Set(["user", "assistant"]);

  function cleanText(value, maxLength = 1200) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function cleanId(value) {
    return cleanText(value, 160).replace(/[^a-zA-Z0-9._:-]/g, "-") || "unknown";
  }

  function cleanStringList(values, maxItems = 12, maxLength = 1200) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map((value) => cleanText(value, maxLength))
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxItems);
  }

  function cleanLabeledList(values, maxItems = 10) {
    return (Array.isArray(values) ? values : [])
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const label = cleanText(item.label || item.week, 240);
        const value = cleanText(
          item.weight || item.date || item.topic || item.text || item.description,
          800
        );
        if (!label && !value) return null;
        return { label, value };
      })
      .filter(Boolean)
      .slice(0, maxItems);
  }

  function cleanRubric(values) {
    return (Array.isArray(values) ? values : [])
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const label = cleanText(item.label, 240);
        if (!label) return null;
        return {
          label,
          weight: cleanText(item.weight, 120),
          description: cleanText(item.description, 800)
        };
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  function buildCoachContext(course = {}, assignment = null, language = "en", action = "chat") {
    const plan = course && typeof course.coursePlan === "object" ? course.coursePlan : {};
    const context = {
      course: {
        id: cleanId(course.id),
        code: cleanText(course.code, 120),
        name: cleanText(course.name, 500),
        syllabus: {
          term: cleanText(plan.term, 160),
          topics: cleanStringList(plan.topics, 12, 300),
          grading: cleanLabeledList(plan.grading, 10),
          policies: cleanLabeledList(plan.policies, 8),
          exams: cleanLabeledList(plan.exams, 8),
          weeklyGuide: cleanLabeledList(plan.weeklyGuide, 12)
        }
      },
      assignment: null,
      language: ALLOWED_LANGUAGES.has(language) ? language : "en",
      action: ALLOWED_ACTIONS.has(action) ? action : "chat"
    };

    if (assignment && typeof assignment === "object") {
      const details = assignment.details && typeof assignment.details === "object"
        ? assignment.details
        : {};
      const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : [];
      context.assignment = {
        id: cleanId(assignment.id),
        title: cleanText(assignment.title, 500),
        dueDate: cleanText(assignment.dueDate, 240),
        points: cleanText(assignment.points, 160),
        status: {
          state: cleanText(assignment.status?.state || assignment.status, 120),
          score: cleanText(assignment.status?.score, 120),
          nextUp: cleanText(assignment.status?.nextUp, 240),
          submission: cleanText(assignment.status?.submission, 240)
        },
        overview: cleanText(details.overview, 1600),
        requirements: cleanStringList(details.requirements, 16, 1200),
        deliverables: cleanStringList(details.deliverables, 12, 800),
        rubric: cleanRubric(details.rubric),
        steps: cleanStringList(details.steps, 16, 800),
        completedSteps: cleanStringList(
          tasks.filter((task) => Boolean(task?.done)).map((task) => task.title),
          16,
          800
        ),
        remainingSteps: cleanStringList(
          tasks.filter((task) => !task?.done).map((task) => task.title),
          16,
          800
        )
      };
    }

    return context;
  }

  function coachThreadKey(courseId, assignmentId) {
    return `${THREAD_PREFIX}:${cleanId(courseId)}:${assignmentId ? cleanId(assignmentId) : "course"}`;
  }

  function normalizeMessage(message) {
    if (!message || typeof message !== "object") return null;
    const role = ALLOWED_ROLES.has(message.role) ? message.role : "";
    const text = cleanText(message.text || message.content, 4000);
    if (!role || !text) return null;
    const normalized = { role, text };
    const timestamp = cleanText(message.timestamp, 80);
    if (timestamp) normalized.timestamp = timestamp;
    if (role === "assistant") {
      normalized.evidence = cleanEvidence(message.evidence);
      normalized.nextSteps = cleanStringList(message.nextSteps, 8, 600);
      normalized.missingInformation = cleanStringList(message.missingInformation, 8, 600);
      normalized.mode = ["live", "mock"].includes(message.mode) ? message.mode : "live";
    }
    return normalized;
  }

  function boundMessages(messages, maxMessages = 40, maxCharacters = 40000) {
    const bounded = (Array.isArray(messages) ? messages : [])
      .map(normalizeMessage)
      .filter(Boolean)
      .slice(-Math.max(1, maxMessages));
    while (
      bounded.length > 1 &&
      bounded.reduce((sum, item) => sum + item.text.length, 0) > maxCharacters
    ) {
      bounded.shift();
    }
    if (bounded.length === 1 && bounded[0].text.length > maxCharacters) {
      bounded[0].text = bounded[0].text.slice(-maxCharacters);
    }
    return bounded;
  }

  function createThreadStore(storage, options = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new TypeError("A localStorage-compatible storage object is required.");
    }
    const maxMessages = Number.isFinite(options.maxMessages) ? Math.max(1, options.maxMessages) : 40;
    const maxCharacters = Number.isFinite(options.maxCharacters) ? Math.max(1, options.maxCharacters) : 40000;

    function get(courseId, assignmentId) {
      try {
        const parsed = JSON.parse(storage.getItem(coachThreadKey(courseId, assignmentId)) || "[]");
        return boundMessages(parsed, maxMessages, maxCharacters);
      } catch (_error) {
        return [];
      }
    }

    function save(courseId, assignmentId, messages) {
      const bounded = boundMessages(messages, maxMessages, maxCharacters);
      storage.setItem(coachThreadKey(courseId, assignmentId), JSON.stringify(bounded));
      return bounded;
    }

    return {
      get,
      append(courseId, assignmentId, message) {
        const normalized = normalizeMessage(message);
        if (!normalized) throw new TypeError("Coach messages require a user or assistant role and text.");
        return save(courseId, assignmentId, [...get(courseId, assignmentId), normalized]);
      },
      replace(courseId, assignmentId, messages) {
        return save(courseId, assignmentId, messages);
      },
      clear(courseId, assignmentId) {
        storage.removeItem(coachThreadKey(courseId, assignmentId));
      }
    };
  }

  function cleanEvidence(values) {
    return (Array.isArray(values) ? values : [])
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const label = cleanText(item.label, 160);
        const text = cleanText(item.text, 1000);
        return label && text ? { label, text } : null;
      })
      .filter(Boolean)
      .slice(0, 8);
  }

  function validateCoachResponse(value) {
    if (!value || typeof value !== "object") throw new TypeError("Coach response must be an object.");
    const answer = cleanText(value.answer, 8000);
    if (!answer) throw new TypeError("Coach response requires an answer.");
    return {
      answer,
      evidence: cleanEvidence(value.evidence),
      nextSteps: cleanStringList(value.nextSteps, 8, 600),
      missingInformation: cleanStringList(value.missingInformation, 8, 600),
      usage: {
        inputTokens: Math.max(0, Math.floor(Number(value.usage?.inputTokens) || 0)),
        outputTokens: Math.max(0, Math.floor(Number(value.usage?.outputTokens) || 0))
      },
      mode: value.mode === "mock" ? "mock" : "live"
    };
  }

  function createCoachError(message, code = "request_failed", status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function createCoachClient(options = {}) {
    const endpoint = cleanText(options.endpoint, 1000);
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    return {
      async send({ context, messages = [], signal } = {}) {
        if (!endpoint) {
          throw createCoachError("The live AI Coach is not connected yet.", "not_configured");
        }
        if (!fetchImpl) throw createCoachError("This browser cannot send Coach requests.", "fetch_unavailable");
        const body = {
          context: context && typeof context === "object" ? context : {},
          messages: boundMessages(messages, 8, 24000)
        };
        const encoded = JSON.stringify(body);
        if (encoded.length > 64000) throw createCoachError("The Coach context is too large to send.", "payload_too_large", 413);
        let response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: encoded,
            signal
          });
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          throw createCoachError("The AI Coach could not reach its server.", "network_error");
        }
        let value = {};
        try {
          value = await response.json();
        } catch (_error) {
          throw createCoachError("The AI Coach returned an unreadable response.", "invalid_response", response.status);
        }
        if (!response.ok) {
          throw createCoachError(
            cleanText(value.message, 500) || "The AI Coach request failed.",
            cleanText(value.code, 120) || "request_failed",
            response.status
          );
        }
        return validateCoachResponse(value);
      }
    };
  }

  return {
    buildCoachContext,
    coachThreadKey,
    createThreadStore,
    createCoachClient,
    validateCoachResponse
  };
});
