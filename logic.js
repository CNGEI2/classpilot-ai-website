(function attachClassPilotLogic(root) {
  const monthNamePattern =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const monthPattern = `${monthNamePattern}\\.?`;
  const deadlineMonthNames = {
    jan: "Jan",
    january: "Jan",
    feb: "Feb",
    february: "Feb",
    mar: "Mar",
    march: "Mar",
    apr: "Apr",
    april: "Apr",
    may: "May",
    jun: "Jun",
    june: "Jun",
    jul: "Jul",
    july: "Jul",
    aug: "Aug",
    august: "Aug",
    sep: "Sep",
    sept: "Sep",
    september: "Sep",
    oct: "Oct",
    october: "Oct",
    nov: "Nov",
    november: "Nov",
    dec: "Dec",
    december: "Dec"
  };
  const deadlineMonthNumbers = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12
  };

  const explanationBank = {
    rubric: {
      en:
        "A grading rubric is the checklist your instructor uses to decide the score. ClassPilot turns it into action items so you can check your work before submitting.",
      zh:
        "评分标准是老师用来打分的清单。ClassPilot 会把它拆成可执行任务，帮助你在提交前检查作业是否符合要求。"
    },
    "process scheduling": {
      en:
        "Process scheduling means how the operating system decides which program runs next. Start by comparing fairness, speed, and response time.",
      zh:
        "进程调度是操作系统决定下一个运行哪个程序的方法。复习时先比较公平性、速度和响应时间。"
    },
    segmentation: {
      en:
        "Segmentation means grouping users by shared needs or behavior. For your project, connect each group to a specific product feature.",
      zh:
        "用户细分是根据相似需求或行为把用户分组。做项目时，要把每个群体和具体产品功能联系起来。"
    },
    thesis: {
      en:
        "A thesis is the main claim your paper will prove. A strong thesis is specific, arguable, and connected to evidence.",
      zh:
        "论点是一篇文章要证明的核心观点。好的论点要具体、可讨论，并且能用证据支持。"
    },
    default: {
      en:
        "ClassPilot explains academic tasks in plain language, then connects the explanation to a next step.",
      zh:
        "ClassPilot 会用简单语言解释学术任务，然后把解释转成下一步行动。"
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createCourseFromInput(input) {
    const code = normalizeText(input.code).toUpperCase() || "COURSE";
    const name = normalizeText(input.name) || "New Course";
    const deadlineLabel = normalizeText(input.deadlineLabel) || "Next assignment";
    const dueDate = formatDisplayDate(input.dueDate) || "No date";
    const baseId = slugify(`${code}-${name}`) || `course-${Date.now()}`;
    const taskTitles = splitLines(input.tasksText);
    const weakTopics = splitList(input.topicsText);

    const tasks = (taskTitles.length > 0 ? taskTitles : ["Review course materials", "Check assignment rubric", "Plan next study session"]).map(
      (title, index) => ({
        id: `${baseId}-task-${index + 1}`,
        title,
        done: false
      })
    );

    const topics = weakTopics.length > 0 ? weakTopics : ["rubric"];
    if (!topics.some((topic) => topic.toLowerCase() === "rubric")) {
      topics.push("rubric");
    }

    return {
      id: baseId,
      code,
      name,
      audience: normalizeText(input.audience) || "college students",
      accent: input.accent || "teal",
      nextDue: deadlineLabel,
      dueDate,
      weakTopics: topics.slice(0, 5),
      tasks,
      deadlines: [
        {
          label: deadlineLabel,
          date: dueDate,
          type: inferDeadlineType(deadlineLabel)
        }
      ],
      notes: `User-created course. ClassPilot will organize ${tasks.length} tasks around ${deadlineLabel}.`
    };
  }

  function createCourseFromMaterial(material, filename = "", options = {}) {
    return createCourseFromDraft(
      createCourseDraftFromMaterial(material, filename, options)
    );
  }

  function createCourseDraftFromMaterial(
    material,
    filename = "",
    options = {}
  ) {
    const rawSource = String(material || "").trim();
    const source = normalizeImportedSource(rawSource);
    const lines = source
      .split(/\r?\n/)
      .map(cleanImportedLine)
      .filter(Boolean);
    const dateContext = academicDateContext(lines, options);
    const sourceType = classifyMaterial(lines, source);
    const analysis = analyzeSyllabus(source, dateContext);
    const deadlines = refineCanvasDeadlines(analysis.deadlines, lines, sourceType);
    const metadata = inferMaterialMetadata(lines);
    const status = inferAssignmentStatus(lines, dateContext);
    const primaryDeadline = deadlines[0] || { label: "Next assignment", date: "" };
    const identity = refineCourseIdentity(inferCourseIdentity(lines, filename, primaryDeadline.label), {
      sourceType,
      assignment: primaryDeadline.label,
      lines
    });
    const topicsText = inferTopicsText(lines);
    const tasksText = inferSmartTaskText(lines, analysis.deadlines, metadata, primaryDeadline.label, sourceType, status);
    const assignmentDetails = inferAssignmentDetails(lines, source, metadata, status, primaryDeadline, sourceType);
    const coursePlan = inferCoursePlan(lines, { ...analysis, deadlines }, topicsText, sourceType);
    const scheduleDateIssues = Array.isArray(analysis.dateIssues)
      ? clone(analysis.dateIssues)
      : [];
    const warnings = [
      ...buildDraftWarnings({
        identity,
        primaryDeadline,
        tasksText,
        sourceType,
        lines
      }),
      ...buildScheduleDateWarnings(scheduleDateIssues)
    ];
    const evidence = [
      ...buildExtractionEvidence({
        identity,
        primaryDeadline,
        metadata,
        status,
        sourceType,
        lines
      }),
      ...scheduleDateIssues.map((issue) => ({
        label: issue.kind === "ambiguous"
          ? "Ambiguous syllabus date"
          : "Invalid syllabus date",
        value: issue.value,
        source: issue.source
      }))
    ];
    const confidence = scoreDraftConfidence({ identity, primaryDeadline, tasksText, metadata, status, sourceType, evidence, warnings });

    return {
      code: identity.code,
      name: identity.name,
      assignment: primaryDeadline.label,
      dueDate: primaryDeadline.date,
      tasksText,
      topicsText,
      points: metadata.points,
      linksText: metadata.links.join("\n"),
      status,
      assignmentDetails,
      coursePlan,
      deadlines,
      filename: normalizeText(filename),
      sourceType,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      evidence,
      warnings,
      scheduleDateIssues,
      actionPlan: buildActionPlan(primaryDeadline, metadata, tasksText, sourceType, status),
      rawText: rawSource
    };
  }

  function createCourseFromDraft(draft = {}) {
    const points = normalizeText(draft.points);
    const links = splitLines(draft.linksText);
    const course = createCourseFromInput({
      code: draft.code,
      name: draft.name,
      audience: "college students",
      deadlineLabel: draft.assignment,
      dueDate: draft.dueDate,
      tasksText: draft.tasksText,
      topicsText: draft.topicsText
    });
    const assignment = createAssignmentFromDraft(draft, course.id);

    return {
      ...course,
      tasks: assignment.tasks,
      deadlines: mergeCourseDeadlines(course, Array.isArray(draft.deadlines) ? draft.deadlines.slice(1) : []).deadlines,
      assignments: [assignment],
      source: buildAssignmentSource(draft),
      sourceType: draft.sourceType || "Course material",
      confidence: Number(draft.confidence) || 0,
      confidenceLabel: draft.confidenceLabel || confidenceLabel(Number(draft.confidence) || 0),
      evidence: Array.isArray(draft.evidence) ? draft.evidence : [],
      warnings: Array.isArray(draft.warnings) ? draft.warnings : [],
      status: draft.status || {},
      coursePlan: draft.coursePlan || {},
      actionPlan: Array.isArray(draft.actionPlan) ? draft.actionPlan : buildActionPlan({ label: course.nextDue, date: course.dueDate }, { links }, course.tasks.map((task) => task.title).join("\n"), draft.sourceType || "Course material", draft.status || {}),
      notes: buildDraftNotes(course, points, links, draft)
    };
  }

  function normalizeImportedSource(value) {
    return normalizeOcrMistakes(value)
      .split(/\r?\n/)
      .map(cleanImportedLine)
      .join("\n")
      .trim();
  }

  function cleanImportedLine(line) {
    return collapseRepeatedText(
      normalizeText(
        String(line || "")
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/^\s*[-*•]\s*/, "")
          .replace(/\s*\*\s*$/g, "")
      )
    );
  }

  function collapseRepeatedText(line) {
    const source = normalizeText(line);
    if (!source || source.length % 2 !== 0) return source;
    const middle = source.length / 2;
    const first = source.slice(0, middle);
    const second = source.slice(middle);
    return first === second ? first : source;
  }

  function normalizeOcrMistakes(value) {
    return String(value || "")
      .replace(/\bvide0\b/gi, "video")
      .replace(/\bAl(\d{3,4})\b/g, "AI$1")
      .replace(/\bAI(\d{2,3})O\b/g, (_, digits) => `AI${digits}0`);
  }

  function classifyMaterial(lines, source) {
    const text = `${source} ${lines.join(" ")}`.toLowerCase();
    const syllabusSignals = [
      /semester and year/,
      /course description/,
      /goals?\s*&?\s*outcomes?/,
      /course grading policy/,
      /weekly course guide/,
      /late submission policy/,
      /attendance policy/,
      /office hours/,
      /\bsyllabus\b/
    ].filter((pattern) => pattern.test(text)).length;
    if (syllabusSignals >= 2) {
      return "Syllabus or schedule";
    }
    if (/submitted on|next up:\s*review feedback|attempt\s+\d+\s+score|ungraded|late/.test(text)) {
      return "Canvas submitted assignment";
    }
    if (/instructure\.com|canvas|immersive reader|submit assignment|points possible|choose a submission type/.test(text)) {
      return "Canvas assignment page";
    }
    if (/syllabus|course schedule|office hours|grading policy|week\s+\d|module\s+\d/.test(text)) {
      return "Syllabus or schedule";
    }
    if (/rubric|points possible|submission type|submit your|assignment prompt|due date/.test(text)) {
      return "Assignment brief";
    }
    return "Course material";
  }

  function refineCourseIdentity(identity, context) {
    const sourceType = context.sourceType || "";
    const assignment = normalizeComparable(context.assignment);
    const name = normalizeComparable(identity.name);
    const code = normalizeText(identity.code);
    const looksLikeBrowserLine = /chrome|safari|firefox|instructure\.com|http|watch this video|account home/i.test(identity.name);
    const numericBrowserCode = /^\d+$/.test(code);
    const weakGeneratedCode = code.length <= 3 && !/\d/.test(code);
    const weakBrowserName = /^\d+$/.test(name) || isWeakCanvasAssignmentTitle(identity.name);

    if (sourceType === "Canvas submitted assignment" && assignment && (weakGeneratedCode || !code)) {
      return {
        code: "",
        name: ""
      };
    }

    if (sourceType === "Canvas assignment page" && (numericBrowserCode || weakBrowserName || looksLikeBrowserLine || (weakGeneratedCode && name === assignment))) {
      return { code: "", name: "" };
    }

    return identity;
  }

  function normalizeComparable(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function inferCourseIdentity(lines, filename, fallbackTitle = "") {
    const canvasIdentity = inferCanvasCourseIdentity(lines);
    if (canvasIdentity) return canvasIdentity;

    const explicitCourseLine =
      lines.find((line) => /\b[A-Z]{2,5}\s*-?\s*\d{2,4}[A-Z]?\b/.test(line)) ||
      lines.find((line) => /course\s*:/i.test(line));
    const ocrTitleLine = isUsableIdentityLine(fallbackTitle) ? normalizeText(fallbackTitle) : "";
    const firstContentLine = lines.find(isUsableIdentityLine) || "";
    const sourceLine =
      explicitCourseLine ||
      ocrTitleLine ||
      firstContentLine ||
      normalizeText(filename).replace(/\.[^.]+$/, "") ||
      "Imported Course";
    const catalogTitle = parseCatalogCourseTitle(sourceLine, lines);
    if (catalogTitle) return catalogTitle;
    const courseMatch = sourceLine.match(/\b([A-Z]{2,5})\s*-?\s*(\d{2,4}[A-Z]?)(?:\s*[-–—]\s*([A-Z]))?\b/i);

    if (courseMatch) {
      const beforeCode = normalizeText(sourceLine.slice(0, courseMatch.index || 0));
      const afterCode = normalizeText(sourceLine.slice((courseMatch.index || 0) + courseMatch[0].length)).replace(
        /^[\s:>\-–—]+/,
        ""
      );
      return {
        code: formatCourseCode(courseMatch),
        name: beforeCode ? normalizeText(sourceLine) : afterCode || normalizeText(sourceLine) || "Imported Course"
      };
    }

    const labeledMatch = sourceLine.match(/course\s*:\s*(.+)$/i);
    const name = normalizeText(labeledMatch?.[1] || sourceLine) || "Imported Course";
    return {
      code: name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || "COURSE",
      name
    };
  }

  function parseCatalogCourseTitle(sourceLine, lines = []) {
    const cleanLine = normalizeText(sourceLine);
    const match = cleanLine.match(/^([A-Z]{2,5})\s*-?\s*(\d{2,4})\s*[-–—]\s*(.+)$/i);
    if (!match) return null;

    const repeatedCodePattern = new RegExp(`\\s*[-–—]\\s*${match[1]}\\s*-?\\s*${match[2]}\\s*\\(([A-Z])\\)\\s*$`, "i");
    const repeatedCodeMatch = cleanLine.match(repeatedCodePattern);
    const sectionLine = lines.find((line) => /^section number\s*:/i.test(line));
    const section = repeatedCodeMatch?.[1] || sectionLine?.replace(/^section number\s*:\s*/i, "") || "";
    const rawName = match[3]
      .replace(repeatedCodePattern, "")
      .replace(/\s*[-–—]\s*(spring|summer|fall|winter)\s+\d{4}\s*$/i, "");

    return {
      code: `${match[1].toUpperCase()}${match[2]}${section ? `-${normalizeText(section).toUpperCase()}` : ""}`,
      name: normalizeText(rawName) || cleanLine
    };
  }

  function inferCanvasCourseIdentity(lines) {
    for (const line of lines) {
      const directCourseName = extractCanvasCourseName(line);
      if (directCourseName) {
        return {
          code: extractCourseCode(directCourseName) || initialsFromName(directCourseName),
          name: directCourseName
        };
      }

      const parts = splitCanvasBreadcrumb(line);
      const assignmentIndex = parts.findIndex((part) => /^assignments?$/i.test(part));
      if (assignmentIndex <= 0) continue;
      const courseName = cleanCanvasCourseName(parts[assignmentIndex - 1]);
      if (!courseName) continue;
      return {
        code: extractCourseCode(courseName) || initialsFromName(courseName),
        name: courseName
      };
    }

    return null;
  }

  function extractCanvasCourseName(line) {
    const value = normalizeText(line);
    if (!/\bassignments?\b/i.test(value)) return "";
    const match = value.match(/\b((?:spring|summer|fall|winter)\s+\d{4}\s+[A-Z]{2,5}\s*-?\s*\d{2,4}\s*[-–—]\s*[A-Z])\b/i);
    return match ? normalizeText(match[1]) : "";
  }

  function cleanCanvasCourseName(value) {
    const line = normalizeText(value);
    const termCourseMatch = line.match(/\b((?:spring|summer|fall|winter)\s+\d{4}\s+[A-Z]{2,5}\s*-?\s*\d{2,4}\s*[-–—]\s*[A-Z])\b/i);
    return normalizeText(termCourseMatch?.[1] || line);
  }

  function splitCanvasBreadcrumb(line) {
    return normalizeText(line)
      .split(/\s*(?:>|›|»|\/)\s*/)
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  function extractCanvasAssignmentTitle(line) {
    const parts = splitCanvasBreadcrumb(line);
    const assignmentIndex = parts.findIndex((part) => /^assignments?$/i.test(part));
    const title = assignmentIndex >= 0 ? cleanCanvasAssignmentTitle(parts[assignmentIndex + 1]) : "";
    return isWeakCanvasAssignmentTitle(title) ? "" : title;
  }

  function extractBestCanvasAssignmentTitle(lines) {
    for (const line of lines) {
      const title = extractCanvasAssignmentTitle(line);
      if (title) return title;
    }

    for (const line of lines) {
      const match = normalizeText(line).match(/^(.+?)\s+\d+(?:\.\d+)?\s+points?\s+possible\b/i);
      const title = cleanCanvasAssignmentTitle(match?.[1] || "");
      if (title && !isWeakCanvasAssignmentTitle(title)) return title;
    }

    return "";
  }

  function cleanCanvasAssignmentTitle(value) {
    return normalizeText(value)
      .replace(/\s*(?:Immersive Reader|\[\%?\)|\(%?\)|100\s+Points\s+Possible|\d+(?:\.\d+)?\s+Points?\s+Possible).*$/i, "")
      .replace(/[|<>{}«»].*$/g, "")
      .replace(/^[^\w]+/, "")
      .trim();
  }

  function isWeakCanvasAssignmentTitle(value) {
    const line = normalizeText(value);
    if (!line) return true;
    if (/^\d+$/.test(line)) return true;
    if (/^(account|account home|home|dashboard|courses|calendar|inbox|history|help|assignments|previous|next|details|submit assignment|immersive reader)$/i.test(line)) {
      return true;
    }
    if (/sfbu\.instructure\.com|courses\/\d+|module_item_id|chrome|safari|firefox/i.test(line)) return true;
    return false;
  }

  function extractCourseCode(line) {
    const match = normalizeText(line).match(/\b([A-Z]{2,5})\s*-?\s*(\d{2,4}[A-Z]?)(?:\s*[-–—]\s*([A-Z]))?\b/i);
    return match ? formatCourseCode(match) : "";
  }

  function formatCourseCode(match) {
    const base = `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
    return match[3] ? `${base}-${match[3].toUpperCase()}` : base;
  }

  function initialsFromName(name) {
    return (
      normalizeText(name)
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || "COURSE"
    );
  }

  function isUsableIdentityLine(value) {
    const line = normalizeText(value);
    if (!line || line.length > 110) return false;
    if (/^(course deadline|next assignment)$/i.test(line)) return false;
    if (/^(dashboard|courses|calendar|inbox|history|help|account|home)$/i.test(line)) return false;
    if (/^(assignments?|grades|modules|people|pages|files|quizzes|syllabus|settings)$/i.test(line)) return false;
    if (/^(due\s*date|due|deadline|available until|until|by)\b/i.test(line)) return false;
    if (/^(points|submitting|attempts|allowed attempts|start assignment|submit assignment)$/i.test(line)) return false;
    return true;
  }

  function inferTopicsText(lines) {
    const topicLine = lines.find((line) => /^(topics?|units?|chapters?)\s*:/i.test(line));
    if (topicLine) {
      return topicLine.replace(/^(topics?|units?|chapters?)\s*:\s*/i, "");
    }

    const topicCandidates = lines
      .filter((line) => !/(due|exam|quiz|assignment|homework|project|paper|presentation)/i.test(line))
      .filter((line) => line.length >= 5 && line.length <= 80)
      .slice(1, 4);
    return topicCandidates.join(", ");
  }

  function inferAssignmentDetails(lines, source, metadata = {}, status = {}, primaryDeadline = {}, sourceType = "Course material") {
    if (sourceType === "Syllabus or schedule") {
      return {
        overview: "Course-level syllabus upload. Assignment-specific requirements will appear after uploading an assignment page.",
        requiredReading: [],
        coreTasks: [],
        deliverables: [],
        rubric: [],
        requirements: [],
        steps: [],
        successCriteria: []
      };
    }

    const canvasDetailLines = extractCanvasDetails(lines);
    const overview = sectionText(lines, /^assignment overview$/i) || canvasDetailLines.join(" ");
    const requiredReading = sectionLines(lines, /^required reading$/i).filter((line) => !isSectionHeading(line));
    const coreTasks = extractCoreTaskSections(lines);
    const deliverables = extractDeliverables(lines);
    const rubric = extractRubric(lines);
    const successCriteria = extractSuccessCriteria(lines);
    const requirements = buildAssignmentRequirements({
      primaryDeadline,
      metadata,
      status,
      requiredReading,
      coreTasks,
      deliverables,
      rubric,
      lines,
      detailLines: canvasDetailLines,
      submissionTypes: metadata.submissionTypes || []
    });
    const steps = buildAssignmentCompletionSteps({
      primaryDeadline,
      metadata,
      requiredReading,
      coreTasks,
      deliverables,
      lines,
      detailLines: canvasDetailLines,
      sourceType
    });

    return {
      overview,
      requiredReading,
      coreTasks,
      deliverables,
      rubric,
      requirements,
      steps,
      submissionTypes: metadata.submissionTypes || [],
      successCriteria
    };
  }

  function extractCanvasDetails(lines) {
    const detailsStart = lines.findIndex((line) => /^details:?$/i.test(line));
    if (detailsStart < 0) return extractCanvasDetailFallback(lines);

    const details = [];
    for (let index = detailsStart + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^choose a submission type$/i.test(line)) break;
      if (isCanvasInterfaceLine(line)) continue;
      const detail = cleanCanvasDetailLine(line);
      if (!detail || isCanvasInterfaceLine(detail)) continue;
      details.push(detail);
    }

    return uniqueTextList(details.length ? details : extractCanvasDetailFallback(lines)).slice(0, 6);
  }

  function extractCanvasDetailFallback(lines) {
    return uniqueTextList(
      lines
        .map(cleanCanvasDetailLine)
        .filter((line) => /max\s+one\s+page|one-page|reflection|please\s+add|pictures?|photos?|images?/i.test(line))
        .filter((line) => !isCanvasInterfaceLine(line))
        .filter((line) => !/\bpoints?\s+possible\b/i.test(line))
    ).slice(0, 6);
  }

  function cleanCanvasDetailLine(line) {
    const value = normalizeText(line);
    const maxPageMatch = value.match(/\b(max\s+one\s+page.+)$/i);
    if (maxPageMatch) return normalizeText(maxPageMatch[1]);
    return value;
  }

  function extractCanvasSubmissionTypes(lines) {
    const start = lines.findIndex((line) => /^choose a submission type$/i.test(line));
    if (start < 0) return [];

    const types = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = normalizeText(lines[index]);
      if (!isCanvasSubmissionType(line)) break;
      types.push(line);
    }
    return uniqueTextList(types);
  }

  function isCanvasSubmissionType(line) {
    return /^(text|web url|media|upload|studio|more)$/i.test(normalizeText(line));
  }

  function isCanvasInterfaceLine(line) {
    const value = normalizeText(line);
    return (
      /^(account|dashboard|courses|calendar|inbox|history|help|home|announcements|assignments|discussions|grades|people|pages|files|syllabus|modules|attendance)$/i.test(value) ||
      /^(previous|next|add comment|submit assignment|immersive reader|attempt|choose a submission type|details)$/i.test(value) ||
      /chrome|safari|firefox|gemini|sfbu\.instructure\.com|module_item_id|resources\s*\|\s*san francisco/i.test(value) ||
      />\s*assignments?\s*>/i.test(value) ||
      /^summer\s+\d{4}$/i.test(value) ||
      isCanvasSubmissionType(value)
    );
  }

  function inferCoursePlan(lines, analysis, topicsText, sourceType) {
    const deadlines = Array.isArray(analysis.deadlines) ? analysis.deadlines : [];
    const exams = deadlines.filter((deadline) => deadline.type === "exam");
    const weeklyGuide = extractWeeklyGuide(lines);
    const grading = extractGradingPolicy(lines);
    const policies = extractCoursePolicies(lines);
    const weeklyTopics = weeklyGuide.map((week) => week.topic).filter(Boolean);
    const courseRequirements = lines
      .filter((line) => /^(attendance|grading policy|office hours|textbook|course outcomes?|learning outcomes?|participation)\b/i.test(line))
      .slice(0, 8);

    return {
      syllabusUploaded: sourceType === "Syllabus or schedule",
      sourceType,
      term: getLabeledValue(lines, "Semester and Year"),
      professor: getLabeledValue(lines, "Professor"),
      credits: getLabeledValue(lines, "Credits"),
      section: getLabeledValue(lines, "Section Number"),
      modality: getLabeledValue(lines, "Modality"),
      meetingLocation: getLabeledValue(lines, "Meeting Location"),
      officeHours: getLabeledValue(lines, "Office Hours"),
      email: getLabeledValue(lines, "Email"),
      deadlines,
      exams,
      grading,
      weeklyGuide,
      policies,
      topics: uniqueTextList([...weeklyTopics, ...splitList(topicsText)]).slice(0, 12),
      courseRequirements: uniqueTextList(courseRequirements)
    };
  }

  function getLabeledValue(lines, label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapedLabel}\\s*:\\s*(.+)$`, "i");
    const line = lines.find((item) => pattern.test(item));
    return normalizeText(line?.match(pattern)?.[1] || "");
  }

  function extractGradingPolicy(lines) {
    const section = linesBetweenHeadings(lines, /^course grading policy$/i, [
      /^teaching strategies$/i,
      /^weekly course guide$/i,
      /^late submission policy$/i
    ]);
    return section
      .map((line) => line.match(/^(.+?)\s+(\d+(?:\.\d+)?%)$/))
      .filter(Boolean)
      .map((match) => ({
        label: normalizeText(match[1]),
        weight: match[2]
      }))
      .filter((item) => !/^(assignments|percentage|total)$/i.test(item.label))
      .slice(0, 10);
  }

  function extractWeeklyGuide(lines) {
    const weekRows = [];
    let current = null;
    let mode = "";

    const pushCurrent = () => {
      if (!current) return;
      current.assignments = uniqueTextList(
        current.assignments
          .flatMap(splitWeeklyAssignmentList)
          .map(cleanWeeklyAssignmentTitle)
      );
      current.resources = uniqueTextList(current.resources);
      current.activities = uniqueTextList(current.activities);
      weekRows.push(current);
    };

    lines.forEach((line) => {
      const weekMatch = line.match(/^Week\s+(\d+)\s+(.+)$/i);
      if (weekMatch) {
        pushCurrent();
        current = {
          week: `Week ${weekMatch[1]}`,
          topic: normalizeText(weekMatch[2].replace(/in-class learning activities:?$/i, "")),
          activities: [],
          assignments: [],
          resources: []
        };
        mode = "";
        return;
      }

      if (!current) return;
      if (/^in-class learning activities:?$/i.test(line)) {
        mode = "activities";
        return;
      }
      if (/^assignments:?$/i.test(line)) {
        mode = "assignments";
        return;
      }
      if (/^assigned readings? & learning resources:?$/i.test(line)) {
        mode = "resources";
        return;
      }
      if (/^(late submission policy|ai policy|academic integrity|attendance policy|course grading policy|teaching strategies)$/i.test(line)) {
        pushCurrent();
        current = null;
        mode = "";
        return;
      }
      if (!mode) return;
      current[mode].push(line);
    });

    pushCurrent();
    return weekRows.slice(0, 20);
  }

  function splitWeeklyAssignmentList(value) {
    const line = normalizeText(value);
    if (!line) return [];
    if (/\bdue\b/i.test(line)) return [line];
    return splitList(line);
  }

  function cleanWeeklyAssignmentTitle(value) {
    const line = normalizeText(value);
    const dueMatch = line.match(/^(.*?)(?:\s+\bdue\b\s+|\s+\bdeadline\b\s+|\s+\bby\b\s+).+$/i);
    return cleanDeadlineLabel(dueMatch?.[1] || line);
  }

  function extractCoursePolicies(lines) {
    const policies = [
      ["Late policy", /^late submission policy$/i],
      ["AI policy", /^ai policy$/i],
      ["Attendance policy", /^attendance policy$/i],
      ["Academic integrity", /^academic integrity$/i]
    ];

    return policies
      .map(([label, heading]) => {
        const text = linesBetweenHeadings(lines, heading, [
          /^late submission policy$/i,
          /^ai policy$/i,
          /^academic integrity$/i,
          /^attendance policy$/i,
          /^diversity statement$/i,
          /^disability and accessibility services$/i
        ])
          .slice(0, label === "Academic integrity" ? 4 : 6)
          .join(" ");
        return text ? { label, text: normalizeText(text) } : null;
      })
      .filter(Boolean);
  }

  function linesBetweenHeadings(lines, startPattern, endPatterns = []) {
    const start = lines.findIndex((line) => startPattern.test(line));
    if (start < 0) return [];
    const results = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (endPatterns.some((pattern) => pattern.test(line))) break;
      results.push(line);
    }
    return results.filter(Boolean);
  }

  function uniqueTextList(items = []) {
    const seen = new Set();
    const result = [];
    items.forEach((item) => {
      const value = normalizeText(item);
      const key = normalizeComparable(value);
      if (!value || seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });
    return result;
  }

  function sectionLines(lines, headingPattern) {
    const start = lines.findIndex((line) => headingPattern.test(line));
    if (start < 0) return [];
    const results = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (isSectionHeading(lines[index])) break;
      results.push(lines[index]);
    }
    return results;
  }

  function sectionText(lines, headingPattern) {
    return sectionLines(lines, headingPattern).join(" ");
  }

  function isSectionHeading(line) {
    return /^(assignment overview|required reading|core assignment tasks|task\s+\d+:|deliverables|main report|ai collaboration appendix|evaluation rubric|success indicators|excellent work will:|inadequate work will:|submission requirements)$/i.test(
      normalizeText(line)
    );
  }

  function extractCoreTaskSections(lines) {
    const tasks = [];
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^Task\s+(\d+):\s*(.+?)(?:\s+\(([^)]+)\))?$/i);
      if (!match) continue;
      const task = {
        label: `Task ${match[1]}`,
        title: normalizeText(match[2]),
        weight: normalizeText(match[3] || ""),
        requirements: []
      };
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^Task\s+\d+:/i.test(lines[cursor]) || /^(deliverables|evaluation rubric|success indicators|submission requirements)$/i.test(lines[cursor])) break;
        if (!isSectionHeading(lines[cursor])) task.requirements.push(lines[cursor]);
      }
      tasks.push(task);
    }
    return tasks;
  }

  function extractDeliverables(lines) {
    const deliverableLines = sectionLines(lines, /^deliverables$/i);
    const deliverables = [];
    deliverableLines.forEach((line) => {
      if (/^main report/i.test(line)) deliverables.push(line);
      if (/^ai collaboration appendix/i.test(line)) deliverables.push(line);
      if (/screenshots|transcripts|bibliography|interview notes|survey data|supporting materials/i.test(line)) deliverables.push(line);
    });

    lines.forEach((line) => {
      if (/main report\s*\(4-5 pages\)/i.test(line)) deliverables.push("Main Report (4-5 pages)");
      if (/ai collaboration appendix\s*\(1-2 pages\)/i.test(line)) deliverables.push("AI Collaboration Appendix (1-2 pages)");
      if (/screenshots or transcripts/i.test(line)) deliverables.push("Screenshots or transcripts of key AI interactions");
      if (/bibliography of ai tools/i.test(line)) deliverables.push("Bibliography of AI tools used");
      if (/interview notes|survey data/i.test(line)) deliverables.push("Interview notes, survey data, and AI interaction records");
    });

    return [...new Set(deliverables)].slice(0, 8);
  }

  function extractRubric(lines) {
    return lines
      .map((line) => {
        const match = line.match(/^(.+?)\s+\((\d+%)\):\s*(.+)$/);
        if (!match) return null;
        return {
          label: normalizeText(match[1]),
          weight: match[2],
          description: normalizeText(match[3])
        };
      })
      .filter(Boolean);
  }

  function extractSuccessCriteria(lines) {
    const criteria = [];
    const successStart = lines.findIndex((line) => /^excellent work will:?$/i.test(line));
    if (successStart >= 0) {
      for (let index = successStart + 1; index < lines.length; index += 1) {
        if (/^inadequate work will:?$/i.test(lines[index]) || /^submission requirements$/i.test(lines[index])) break;
        criteria.push(lines[index]);
      }
    }
    return criteria.filter(Boolean).slice(0, 6);
  }

  function buildAssignmentRequirements({
    primaryDeadline,
    metadata,
    status,
    requiredReading,
    coreTasks,
    deliverables,
    rubric,
    lines,
    detailLines = [],
    submissionTypes = []
  }) {
    const requirements = [];
    if (primaryDeadline?.date) requirements.push(`Due ${primaryDeadline.date}`);
    if (metadata.points) requirements.push(metadata.points);
    if (status.progress) requirements.push(status.progress);
    if (status.late) requirements.push("Canvas marks this submission as late.");
    detailLines
      .filter((line) => !/^https?:\/\//i.test(line))
      .forEach((line) => requirements.push(line));
    if (submissionTypes.length > 0) requirements.push(`Submission types: ${submissionTypes.join(", ")}`);
    deliverables.forEach((item) => requirements.push(item));
    requiredReading.forEach((item) => requirements.push(`Read: ${item}`));
    coreTasks.forEach((task) => requirements.push(`${task.label}: ${task.title}${task.weight ? ` (${task.weight})` : ""}`));
    if (lines.some((line) => /interview one professional/i.test(line))) requirements.push("Interview one finance or technology professional.");
    if (lines.some((line) => /at least 3 real individuals/i.test(line))) requirements.push("Interview or survey at least 3 people from different stakeholder groups.");
    if (lines.some((line) => /clearly distinguishing between AI-assisted research and your original insights/i.test(line))) {
      requirements.push("Clearly distinguish AI-assisted research from original insights.");
    }
    rubric.forEach((item) => requirements.push(`${item.label}: ${item.weight}`));
    return [...new Set(requirements)].slice(0, 18);
  }

  function buildAssignmentCompletionSteps({
    primaryDeadline,
    metadata,
    requiredReading,
    coreTasks,
    deliverables,
    lines,
    detailLines = [],
    sourceType = "Course material"
  }) {
    const steps = [];
    const relevantLines = detailLines.length > 0 ? detailLines : lines.filter((line) => !isCanvasInterfaceLine(line));
    const relevantText = relevantLines.join(" ");
    const assignmentTitle = normalizeText(primaryDeadline?.label);
    const assignmentContext = `${assignmentTitle} ${relevantText}`;

    if (sourceType === "Canvas assignment page") {
      buildCanvasAssignmentSteps(assignmentContext).forEach((step) => steps.push(step));
    }

    if (requiredReading.length > 0) steps.push("Read the required source and capture claims, assumptions, and questions.");
    if (coreTasks.length > 0) steps.push("Create a section outline for each required task before drafting.");
    if (hasAiCollaborationRequirement(relevantLines)) steps.push("Use AI for background research, then mark which insights you accept, reject, or refine.");
    if (lines.some((line) => /interview|survey|primary research/i.test(line))) steps.push("Complete the required interviews or surveys and summarize evidence from real people.");
    if (deliverables.some((item) => /main report/i.test(item))) steps.push("Draft the main report with headings matching the assignment tasks.");
    if (deliverables.some((item) => /appendix/i.test(item))) steps.push("Prepare the AI collaboration appendix with prompts, screenshots, and reflection.");
    if (metadata.points || primaryDeadline?.date) steps.push("Review the submission against the instructions, point value, and due date.");
    if (steps.length === 0) steps.push("Read the prompt, list deliverables, draft, revise, and submit.");
    return uniqueTextList(steps).slice(0, 8);
  }

  function buildCanvasAssignmentSteps(context) {
    const text = normalizeText(context);
    const steps = [];
    if (/\battend\b.*\bseminar\b|\bseminar\b.*\battend/i.test(text)) {
      steps.push("Attend a seminar and capture notes you can reflect on.");
    }
    if (/\breflection\b/i.test(text)) {
      steps.push(/\b(max\s+)?one\s+page\b|\b1\s+page\b/i.test(text) ? "Write a one-page reflection about what you attended." : "Write the required reflection.");
    }
    if (/\b(pictures?|photos?|images?)\b/i.test(text)) {
      steps.push("Add pictures to support the reflection.");
    }
    return steps;
  }

  function hasAiCollaborationRequirement(lines) {
    return lines.some((line) => {
      const value = normalizeText(line);
      if (!/\bAI\b|artificial intelligence|AI-assisted|AI tools?/i.test(value)) return false;
      if (/^\w+\s*\d{2,4}/i.test(value) && value.length < 80) return false;
      if (/>\s*assignments?\s*>/i.test(value)) return false;
      return true;
    });
  }

  function inferSmartTaskText(lines, deadlines = [], metadata = {}, assignment = "", sourceType = "Course material", status = {}) {
    const tasks = [];
    const addTask = (task) => {
      const clean = cleanTaskLine(task);
      if (!clean) return;
      const key = normalizeComparable(clean);
      if (!key || tasks.some((item) => normalizeComparable(item) === key)) return;
      tasks.push(clean);
    };
    const taskText = inferTaskText(lines, deadlines);
    const assignmentText = normalizeText(assignment);
    const assignmentKey = normalizeComparable(assignmentText);
    const lowerContext = `${assignmentText} ${(metadata.links || []).join(" ")} ${lines.join(" ")}`.toLowerCase();
    const canvasDetailLines = sourceType === "Canvas assignment page" ? extractCanvasDetails(lines) : [];
    const canvasDetailKeys = new Set(canvasDetailLines.map((line) => normalizeComparable(line)));
    const canvasPlanSteps = sourceType === "Canvas assignment page" ? buildCanvasAssignmentSteps(`${assignmentText} ${canvasDetailLines.join(" ")}`) : [];

    if (/watch|video|youtube|youtu\.be/.test(lowerContext)) {
      addTask("Watch the linked video");
    }

    if (sourceType === "Canvas assignment page") {
      canvasPlanSteps.forEach(addTask);
    }

    splitLines(taskText).forEach((task) => {
      if (normalizeComparable(task) === assignmentKey) return;
      if (sourceType === "Canvas assignment page" && isNoisyCanvasTask(task)) return;
      if (
        canvasPlanSteps.length > 0 &&
        (canvasDetailKeys.has(normalizeComparable(task)) || canvasDetailKeys.has(normalizeComparable(cleanCanvasDetailLine(task))))
      ) {
        return;
      }
      if (sourceType === "Canvas assignment page" && /^submit assignment$/i.test(task)) return;
      addTask(task);
    });

    if (sourceType === "Canvas assignment page" && /submit assignment|choose a submission type/i.test(lines.join(" "))) {
      addTask("Submit the assignment in Canvas");
    }

    if (sourceType === "Canvas submitted assignment") {
      if (/review feedback/i.test(status.nextUp || "")) addTask("Review instructor feedback");
      if (
        (
          Object.prototype.hasOwnProperty.call(status, "score") &&
          !hasMeaningfulScore(status.score)
        ) ||
        /ungraded/i.test(status.grading || "")
      ) {
        addTask("Watch for grading because the score is not available yet");
      }
      if (status.late) addTask("Note the late submission status");
    }

    if ((metadata.links || []).length > 0 && !/watch|video|youtube|youtu\.be/.test(lowerContext)) {
      addTask("Open the linked resource and take notes");
    }

    if (metadata.points) {
      addTask("Check the final response against the point value and instructions");
    }

    if (tasks.length === 0 && assignmentText && assignmentText !== "Next assignment") {
      addTask(`Clarify the deliverable for ${assignmentText}`);
      addTask("Break the prompt into submission steps");
    }

    return tasks.slice(0, 7).join("\n");
  }

  function inferTaskText(lines, deadlines = []) {
    const actionWords = /(add|attend|read|review|finish|complete|submit|prepare|draft|study|practice|write|create|watch|solve|revise|meet|email|ask)/i;
    const deadlineLabels = new Set(deadlines.map((deadline) => cleanDeadlineLabel(deadline.label).toLowerCase()));
    const tasks = lines
      .filter((line) => !deadlineLabels.has(cleanDeadlineLabel(line).toLowerCase()))
      .filter((line) => !isAssignmentStatusLine(line))
      .filter((line) => !isCanvasInterfaceLine(line))
      .filter((line) => !/^https?:\/\//i.test(line))
      .filter((line) => actionWords.test(line))
      .map(cleanTaskLine)
      .filter(Boolean)
      .slice(0, 8);

    return tasks.join("\n");
  }

  function cleanTaskLine(line) {
    return normalizeText(line)
      .replace(/^(task|todo|to do)\s*:\s*/i, "")
      .replace(/^next\s+up\s*:?\s*/i, "")
      .replace(/^(?:\w+\s+)?pages\s+/i, "")
      .replace(/^details\s*:?\s*/i, "");
  }

  function isNoisyCanvasTask(line) {
    const value = normalizeText(line);
    return (
      /\bpoints?\s+possible\b/i.test(value) ||
      /^attendance\b/i.test(value) ||
      /previous.*submit assignment.*next/i.test(value) ||
      /account home|immersive reader|sfbu\.instructure\.com|resources\s*\|\s*san francisco|chrome|gemini/i.test(value)
    );
  }

  function isAssignmentStatusLine(line) {
    return /^(late|missing|submitted on|attempt(?:\s+\d+)?(?:\s+score)?|n\/a|ungraded|graded|unlimited attempts allowed|next up)\b/i.test(
      normalizeText(line)
    );
  }

  function inferMaterialMetadata(lines) {
    const pointsLine = normalizeText(lines.find((line) => /\b\d+(?:\.\d+)?\s+points?\s+possible\b/i.test(line)) || "");
    const points = normalizeText(pointsLine.match(/\b\d+(?:\.\d+)?\s+points?\s+possible\b/i)?.[0] || "");
    const submissionTypes = extractCanvasSubmissionTypes(lines);
    const links = lines
      .flatMap((line) => line.match(/https?:\/\/\S+/gi) || [])
      .map((link) => link.replace(/[),.]+$/g, ""));

    return {
      points,
      links: [...new Set(links)],
      submissionTypes
    };
  }

  function inferAssignmentStatus(lines, dateContext = {}) {
    const status = {};
    const submittedLine = lines.find((line) => /^submitted on\b/i.test(line));
    const nextUpLine = lines.find((line) => /^next up\s*:/i.test(line));
    const gradingLine = lines.find((line) => /\b(ungraded|graded)\b/i.test(line));
    const attemptLine = lines.find((line) => /^attempt\s+\d+\b/i.test(line));
    const scoreIndex = lines.findIndex((line) => /^attempt\s+\d+\s+score\s*:/i.test(line));
    const attemptsAllowedLine = lines.find((line) => /attempts allowed/i.test(line));
    const progressLine = lines.find((line) => /^(in progress|not submitted|submitted|missing)$/i.test(line));

    if (lines.some((line) => /^late$/i.test(line))) status.late = true;
    if (progressLine && !/^submitted$/i.test(progressLine)) {
      status.progress = capitalizeStatus(progressLine);
    }
    if (gradingLine) {
      const gradingMatch = gradingLine.match(/\b(ungraded|graded)\b/i);
      if (gradingMatch) status.grading = capitalizeStatus(gradingMatch[1]);
    }
    if (submittedLine) {
      status.submittedAt = formatDeadlineDate(
        submittedLine.replace(/^submitted on\s*/i, ""),
        dateContext
      );
    }
    if (nextUpLine) {
      status.nextUp = normalizeText(nextUpLine.replace(/^next up\s*:?\s*/i, ""));
    }
    if (attemptLine) {
      status.attempt = normalizeText(attemptLine.match(/^attempt\s+\d+/i)?.[0] || attemptLine);
    }
    if (scoreIndex >= 0) {
      const inlineScore = normalizeText(lines[scoreIndex].replace(/^attempt\s+\d+\s+score\s*:?\s*/i, ""));
      status.score = inlineScore || normalizeText(lines[scoreIndex + 1] || "");
    }
    if (attemptsAllowedLine) {
      status.attemptsAllowed = normalizeText(attemptsAllowedLine.match(/\b(?:unlimited|\d+)\s+attempts?\s+allowed\b/i)?.[0] || attemptsAllowedLine);
    }

    return status;
  }

  function capitalizeStatus(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized
      ? normalized
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
      : "";
  }

  function buildDraftWarnings({ identity, primaryDeadline, tasksText, sourceType, lines }) {
    const warnings = [];
    const isCourseLevelMaterial = sourceType === "Syllabus or schedule";
    if (!normalizeText(identity.code)) warnings.push("Course code was not found clearly.");
    if (!normalizeText(identity.name)) warnings.push("Course name was not found clearly.");
    if (!isCourseLevelMaterial && (!normalizeText(primaryDeadline.label) || primaryDeadline.label === "Next assignment")) {
      warnings.push("Assignment title needs review.");
    }
    if (!isCourseLevelMaterial && !normalizeText(primaryDeadline.date)) warnings.push("Due date was not found.");
    if (!isCourseLevelMaterial && !normalizeText(tasksText)) warnings.push("No concrete next tasks were detected.");
    if (sourceType === "Canvas assignment page" && !lines.some((line) => /assignments?\s*(>|›|»|\/)/i.test(line))) {
      warnings.push("Canvas breadcrumb was not readable, so course identity may need correction.");
    }
    return warnings;
  }

  function buildScheduleDateWarnings(issues = []) {
    return issues.map((issue) => {
      const label = normalizeText(issue.label) || "course deadline";
      const value = normalizeText(issue.value);
      if (issue.kind === "ambiguous") {
        return `Syllabus date ${value} for ${label} is ambiguous. Use a month name and four-digit year, then re-import before replacing this schedule.`;
      }
      return `Syllabus date ${value} for ${label} is invalid. Correct the month and day, then re-import before replacing this schedule.`;
    });
  }

  function buildExtractionEvidence({ identity, primaryDeadline, metadata, status = {}, sourceType, lines }) {
    const evidence = [];
    const addEvidence = (label, value, source) => {
      const cleanValue = normalizeText(value);
      if (!cleanValue) return;
      evidence.push({
        label,
        value: cleanValue,
        source: normalizeText(source || findEvidenceLine(lines, cleanValue) || "Inferred from imported text")
      });
    };

    addEvidence("Material type", sourceType, sourceType.startsWith("Canvas") ? "Canvas keywords detected" : "Text pattern detected");
    addEvidence("Course", identity.name, findEvidenceLine(lines, identity.name));
    addEvidence("Course code", identity.code, findEvidenceLine(lines, identity.code));
    addEvidence("Assignment", primaryDeadline.label, findEvidenceLine(lines, primaryDeadline.label));
    addEvidence("Due", primaryDeadline.date, findDateEvidenceLine(lines));
    addEvidence("Points", metadata.points, findEvidenceLine(lines, metadata.points));
    addEvidence("Submitted", status.submittedAt, findEvidenceLine(lines, "Submitted on"));
    addEvidence("Status", status.late ? "Late" : "", findEvidenceLine(lines, "Late"));
    addEvidence("Progress", status.progress, findEvidenceLine(lines, status.progress));
    addEvidence("Grading", status.grading, findEvidenceLine(lines, status.grading));
    addEvidence("Attempt", status.attempt, findEvidenceLine(lines, status.attempt));
    addEvidence("Score", status.score, findEvidenceLine(lines, status.score));
    addEvidence("Next up", status.nextUp, findEvidenceLine(lines, status.nextUp));
    addEvidence("Attempts allowed", status.attemptsAllowed, findEvidenceLine(lines, status.attemptsAllowed));
    if (metadata.submissionTypes?.length) {
      addEvidence("Submission types", metadata.submissionTypes.join(", "), findEvidenceLine(lines, "Choose a submission type"));
    }
    if (metadata.links?.length) addEvidence("Link", metadata.links[0], findEvidenceLine(lines, metadata.links[0]));
    return evidence.slice(0, 14);
  }

  function findEvidenceLine(lines, value) {
    const target = normalizeComparable(value);
    if (!target) return "";
    return lines.find((line) => normalizeComparable(line).includes(target) || target.includes(normalizeComparable(line))) || "";
  }

  function findDateEvidenceLine(lines) {
    return lines.find((line) => /\b(due|deadline|available until|until|by)\b/i.test(line)) || "";
  }

  function scoreDraftConfidence({ identity, primaryDeadline, tasksText, metadata, status = {}, sourceType, evidence, warnings }) {
    let score = 12;
    if (sourceType !== "Course material") score += 12;
    if (sourceType === "Syllabus or schedule") score += 28;
    if (normalizeText(identity.code)) score += 16;
    if (normalizeText(identity.name)) score += 16;
    if (normalizeText(primaryDeadline.label) && primaryDeadline.label !== "Next assignment") score += 18;
    if (normalizeText(primaryDeadline.date)) score += 18;
    if (normalizeText(tasksText)) score += 10;
    if (metadata.points || metadata.links?.length) score += 6;
    if (status.submittedAt || status.nextUp || status.attempt) score += 10;
    score += Math.min(8, evidence.length);
    score -= warnings.length * 12;
    return Math.max(0, Math.min(99, score));
  }

  function confidenceLabel(score) {
    if (score >= 86) return "High confidence";
    if (score >= 65) return "Needs quick review";
    return "Needs correction";
  }

  function buildActionPlan(primaryDeadline, metadata = {}, tasksText = "", sourceType = "Course material", status = {}) {
    const tasks = splitLines(tasksText);
    const plan = [];
    if (tasks[0]) plan.push(`Start: ${tasks[0]}.`);
    if (status.progress) plan.push(`Canvas status: ${status.progress}.`);
    if (status.submittedAt) plan.push(`Submitted on ${status.submittedAt}.`);
    if (status.nextUp) plan.push(`Next up: ${status.nextUp}.`);
    if (status.late) plan.push("Flagged late in Canvas.");
    if (metadata.links?.length) plan.push("Use the detected link as the primary source.");
    if (metadata.points) plan.push(`Check quality against ${metadata.points}.`);
    if (primaryDeadline?.date) plan.push(`Submit before ${primaryDeadline.date}.`);
    if (sourceType === "Canvas assignment page") plan.push("Confirm the Canvas submission type before turning it in.");
    return [...new Set(plan)].slice(0, 5);
  }

  function buildImportNotes(analysis, course, metadata) {
    const parts = [
      analysis.deadlines.length > 0
        ? `Imported from course material. ClassPilot found ${analysis.deadlines.length} deadlines and ${course.tasks.length} tasks.`
        : `Imported from course material. ClassPilot found ${course.tasks.length} tasks. Paste text with a due date or deadline to add checkpoints.`
    ];

    if (metadata.points) {
      parts.push(`Points: ${metadata.points}.`);
    }

    if (metadata.links.length > 0) {
      parts.push(`Links: ${metadata.links.join(", ")}.`);
    }

    return parts.join(" ");
  }

  function buildDraftNotes(course, points, links, draft = {}) {
    const confidence = Number(draft.confidence) || 0;
    const sourceType = draft.sourceType || "Course material";
    const parts = [
      `Smart import: ${sourceType}${confidence ? `, ${confidence}% confidence` : ""}. ClassPilot found ${course.deadlines.length} deadlines and ${course.tasks.length} tasks.`
    ];

    if (points) {
      parts.push(`Points: ${points}.`);
    }

    if (links.length > 0) {
      parts.push(`Links: ${links.join(", ")}.`);
    }

    if (draft.status?.submittedAt) {
      parts.push(`Submitted: ${draft.status.submittedAt}.`);
    }

    if (draft.status?.late) {
      parts.push("Status: Late.");
    }

    if (draft.status?.progress) {
      parts.push(`Progress: ${draft.status.progress}.`);
    }

    if (draft.status?.nextUp) {
      parts.push(`Next up: ${draft.status.nextUp}.`);
    }

    if (draft.status?.score) {
      parts.push(`Score: ${draft.status.score}.`);
    }

    if (Array.isArray(draft.actionPlan) && draft.actionPlan.length > 0) {
      parts.push(`Next: ${draft.actionPlan[0]}`);
    }

    if (Array.isArray(draft.warnings) && draft.warnings.length > 0) {
      parts.push(`Review needed: ${draft.warnings.join(" ")}`);
    }

    return parts.join(" ");
  }

  function createAssignmentFromDraft(draft = {}, courseId = "") {
    const title = normalizeText(draft.assignment) || "Imported assignment";
    const assignmentId = slugify(`${courseId || draft.code || "course"}-${title}-${draft.dueDate || "no-date"}`) || `assignment-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const taskScope = importedTaskScope(title, draft.dueDate);
    const taskIdentityCounts = new Map();
    const tasks = splitLines(draft.tasksText).map((taskTitle) => {
      const identity = importedTaskSemanticBase(taskTitle);
      const occurrence = (taskIdentityCounts.get(identity) || 0) + 1;
      taskIdentityCounts.set(identity, occurrence);
      const semanticKey = identity +
        (occurrence > 1 ? `-${occurrence}` : "");
      return {
        id: importedTaskIdentity(taskScope, semanticKey),
        semanticKey,
        semanticOccurrence: occurrence,
        title: taskTitle,
        done: false,
        assignmentId
      };
    });
    const assignment = {
      id: assignmentId,
      title,
      dueDate: normalizeText(draft.dueDate) || "No date",
      points: normalizeText(draft.points),
      sourceType: draft.sourceType || "Course material",
      confidence: Number(draft.confidence) || 0,
      confidenceLabel: draft.confidenceLabel || confidenceLabel(Number(draft.confidence) || 0),
      status: draft.status || {},
      evidence: Array.isArray(draft.evidence) ? clone(draft.evidence) : [],
      warnings: Array.isArray(draft.warnings) ? clone(draft.warnings) : [],
      actionPlan: Array.isArray(draft.actionPlan) ? draft.actionPlan.slice() : [],
      details: draft.assignmentDetails || {},
      links: splitLines(draft.linksText),
      source: buildAssignmentSource(draft),
      createdAt: timestamp,
      updatedAt: timestamp,
      tasks
    };

    return {
      ...assignment,
      category: categorizeAssignment(assignment)
    };
  }

  function normalizedTaskIdentityContent(value) {
    return normalizeText(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stableTaskIdentityHash(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  function importedTaskSemanticBase(title) {
    const content = normalizedTaskIdentityContent(title) || "task";
    const label = slugify(content).slice(0, 36) || "task";
    return `${label}-${stableTaskIdentityHash(content)}`;
  }

  function importedTaskScope(title, dueDate) {
    const timestamp = Date.parse(normalizeText(dueDate));
    const dueIdentity = Number.isFinite(timestamp)
      ? String(timestamp)
      : normalizeComparable(dueDate);
    return stableTaskIdentityHash(
      `${normalizedTaskIdentityContent(title)}|${dueIdentity}`
    );
  }

  function importedTaskIdentity(scope, semanticKey) {
    return `imported-task-semantic-${scope}-${semanticKey}`;
  }

  function taskSemanticOccurrence(task) {
    const occurrence = Number(task.semanticOccurrence);
    return Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
  }

  function taskMatchesSemanticKey(candidate, task) {
    const semanticKey = normalizeText(task.semanticKey);
    if (!semanticKey) return false;
    if (normalizeText(candidate.semanticKey) === semanticKey) return true;
    const candidateId = normalizeText(candidate.id);
    return candidateId.includes("-task-semantic-") &&
      candidateId.endsWith("-" + semanticKey);
  }

  function taskTitleMatchesSemanticKey(candidate, task) {
    const occurrence = taskSemanticOccurrence(task);
    const expected = importedTaskSemanticBase(candidate.title) +
      (occurrence > 1 ? `-${occurrence}` : "");
    return expected === normalizeText(task.semanticKey);
  }

  function buildAssignmentSource(draft = {}) {
    return {
      fileName: normalizeText(draft.filename),
      sourceType: normalizeText(draft.sourceType || "Course material"),
      importedAt: new Date().toISOString(),
      confidence: Number(draft.confidence) || 0,
      warnings: clone(draft.warnings || []),
      evidence: clone(draft.evidence || [])
    };
  }

  function preserveMatchingTaskState(existing = {}, incoming = {}) {
    const existingTasks = Array.isArray(existing.tasks) ? existing.tasks : [];
    const usedIndexes = new Set();
    const findMatchIndex = (task) => {
      if (normalizeText(task.semanticKey)) {
        const idIndex = existingTasks.findIndex((candidate, index) =>
          !usedIndexes.has(index) &&
          taskMatchesSemanticKey(candidate, task)
        );
        if (idIndex >= 0) return idIndex;
      }

      const incomingTitle = normalizeComparable(task.title);
      if (!incomingTitle) return -1;
      return existingTasks.findIndex((candidate, index) =>
        !usedIndexes.has(index) &&
        normalizeComparable(candidate.title) === incomingTitle
      );
    };

    const assignmentId = existing.id || incoming.id;
    return {
      ...incoming,
      id: assignmentId,
      createdAt: existing.createdAt || incoming.createdAt,
      links: [...new Set([
        ...(Array.isArray(existing.links) ? existing.links : []),
        ...(Array.isArray(incoming.links) ? incoming.links : [])
      ])],
      tasks: (incoming.tasks || []).map((task) => {
        const matchIndex = findMatchIndex(task);
        const matchingTask = matchIndex >= 0 ? existingTasks[matchIndex] : null;
        const preserveLocalTitle = matchingTask &&
          normalizeText(task.semanticKey) &&
          !taskTitleMatchesSemanticKey(matchingTask, task);
        if (matchIndex >= 0) usedIndexes.add(matchIndex);
        return {
          ...(matchingTask || {}),
          ...task,
          assignmentId,
          title: preserveLocalTitle ? matchingTask.title : task.title,
          done: matchingTask ? Boolean(matchingTask.done) : Boolean(task.done)
        };
      })
    };
  }

  function categorizeAssignment(assignment = {}) {
    const status = assignment.status || {};
    const nextUp = normalizeText(status.nextUp).toLowerCase();

    if (hasMeaningfulScore(status.score)) return "Graded";
    if (nextUp.includes("review feedback")) return "Feedback";
    if (status.submittedAt && status.late) return "Submitted late";
    if (status.submittedAt) return "Submitted";
    if (status.late) return "Late";
    if (assignment.dueDate && assignment.dueDate !== "No date") return "To submit";
    return "Needs review";
  }

  function groupAssignmentsByCategory(assignments = []) {
    const order = ["To submit", "Feedback", "Submitted late", "Submitted", "Late", "Graded", "Needs review"];
    const groups = [];
    const assignmentList = Array.isArray(assignments) ? assignments : [];

    order.forEach((label) => {
      const matches = assignmentList.filter((assignment) => categorizeAssignment(assignment) === label);
      if (matches.length > 0) {
        groups.push({
          label,
          assignments: matches
        });
      }
    });

    assignmentList.forEach((assignment) => {
      const label = categorizeAssignment(assignment);
      if (order.includes(label)) return;
      const existing = groups.find((group) => group.label === label);
      if (existing) {
        existing.assignments.push(assignment);
      } else {
        groups.push({ label, assignments: [assignment] });
      }
    });

    return groups;
  }

  function courseGroupingKey(value = {}) {
    const code = normalizeText(value.code).toUpperCase();
    const name = normalizeComparable(value.name);
    if (code && code !== "ASSIGNMENT" && code !== "COURSE") return `code:${code}`;
    if (name && name !== normalizeComparable(value.assignment)) return `name:${name}`;
    return "";
  }

  function assignmentIdentityKey(assignment = {}) {
    const dueDate = normalizeText(assignment.dueDate);
    const timestamp = Date.parse(dueDate);
    const normalizedDueDate = Number.isFinite(timestamp)
      ? String(timestamp)
      : normalizeComparable(dueDate);
    return `${normalizeComparable(assignment.title)}|${normalizedDueDate}`;
  }

  function normalizeCourseAssignments(course = {}) {
    if (Array.isArray(course.assignments)) {
      return {
        ...clone(course),
        assignments: course.assignments.map((assignment) => ({
          ...assignment,
          category: categorizeAssignment(assignment),
          tasks: Array.isArray(assignment.tasks) ? assignment.tasks : []
        }))
      };
    }

    const fallbackAssignment = {
      id: `${course.id || "course"}-imported-assignment`,
      title: normalizeText(course.nextDue) || "Imported assignment",
      dueDate: normalizeText(course.dueDate) || "No date",
      points: "",
      sourceType: course.sourceType || "Course material",
      confidence: Number(course.confidence) || 0,
      confidenceLabel: course.confidenceLabel || "",
      status: course.status || {},
      details: course.assignmentDetails || {},
      evidence: Array.isArray(course.evidence) ? clone(course.evidence) : [],
      warnings: Array.isArray(course.warnings) ? clone(course.warnings) : [],
      actionPlan: Array.isArray(course.actionPlan) ? course.actionPlan.slice() : [],
      tasks: Array.isArray(course.tasks) ? clone(course.tasks) : []
    };

    return {
      ...clone(course),
      assignments: [
        {
          ...fallbackAssignment,
          category: categorizeAssignment(fallbackAssignment)
        }
      ],
      coursePlan: course.coursePlan || inferCoursePlan([], { deadlines: course.deadlines || [] }, "", course.sourceType || "Course material")
    };
  }

  function applyCourseContextToDraft(draft = {}, course = {}) {
    const isCourseLevel = draft.sourceType === "Syllabus or schedule";
    const contextCourse = course?.id || course?.code || course?.name ? normalizeCourseAssignments(course) : null;
    if (!contextCourse || isCourseLevel || (normalizeText(draft.code) && normalizeText(draft.name))) {
      return clone(draft);
    }

    const warnings = (draft.warnings || []).filter(
      (warning) =>
        !warning.includes("Course code") &&
        !warning.includes("Course name") &&
        !warning.includes("course identity")
    );
    const hasAssignmentFields = Boolean(normalizeText(draft.assignment) && normalizeText(draft.dueDate));
    const canUseHighConfidence = hasAssignmentFields && warnings.length === 0;

    return {
      ...clone(draft),
      code: contextCourse.code,
      name: contextCourse.name,
      confidence: canUseHighConfidence ? Math.max(Number(draft.confidence) || 0, 88) : Number(draft.confidence) || 0,
      confidenceLabel: canUseHighConfidence ? "High confidence" : draft.confidenceLabel,
      warnings,
      evidence: [
        ...(Array.isArray(draft.evidence) ? clone(draft.evidence) : []),
        {
          label: "Course context",
          value: `${contextCourse.code}: ${contextCourse.name}`,
          source: "Selected course"
        }
      ]
    };
  }

  function bindDraftToCourse(draft = {}, course = {}) {
    const contextCourse = course?.id || course?.code || course?.name ? normalizeCourseAssignments(course) : null;
    if (!contextCourse) return clone(draft);

    const code = normalizeText(contextCourse.code);
    const name = normalizeText(contextCourse.name);
    if (!code || !name) return clone(draft);

    const warnings = (draft.warnings || []).filter(
      (warning) =>
        !warning.includes("Course code") &&
        !warning.includes("Course name") &&
        !warning.includes("course identity")
    );
    const isCourseLevel = draft.sourceType === "Syllabus or schedule";
    const hasAssignmentFields = Boolean(normalizeText(draft.assignment) && normalizeText(draft.dueDate));
    const canTrustCourseBinding = isCourseLevel
      ? warnings.length === 0
      : hasAssignmentFields && warnings.length === 0;
    const confidence = canTrustCourseBinding ? Math.max(Number(draft.confidence) || 0, 88) : Number(draft.confidence) || 0;

    return {
      ...clone(draft),
      code,
      name,
      confidence,
      confidenceLabel: confidence >= 86 ? "High confidence" : draft.confidenceLabel,
      warnings,
      evidence: [
        ...(Array.isArray(draft.evidence) ? clone(draft.evidence) : []),
        {
          label: "Course directory",
          value: `${code}: ${name}`,
          source: "Selected course upload"
        }
      ]
    };
  }

  function refreshCourseFromAssignments(course = {}) {
    const assignments = Array.isArray(course.assignments) ? course.assignments : [];
    const tasks = assignments.flatMap((assignment) =>
      (assignment.tasks || []).map((task) => ({
        ...task,
        assignmentId: assignment.id
      }))
    );
    const assignmentDeadlines = assignments
      .filter((assignment) => assignment.title && assignment.dueDate && assignment.dueDate !== "No date")
      .map((assignment) => ({
        label: assignment.title,
        date: assignment.dueDate,
        type: inferDeadlineType(assignment.title)
      }));
    const coursePlan = course.coursePlan || {};
    const planDeadlines = Array.isArray(coursePlan.deadlines) ? coursePlan.deadlines : [];
    const deadlines = mergeDeadlineLists(planDeadlines, assignmentDeadlines);

    return {
      ...course,
      tasks,
      deadlines,
      coursePlan,
      nextDue: assignmentDeadlines[0]?.label || planDeadlines[0]?.label || course.nextDue || "Next assignment",
      dueDate: assignmentDeadlines[0]?.date || planDeadlines[0]?.date || course.dueDate || "No date",
      notes: `${assignments.length} imported assignment${assignments.length === 1 ? "" : "s"} grouped under ${course.code}: ${course.name}.${coursePlan.syllabusUploaded ? " Syllabus uploaded for course-level planning." : ""}`
    };
  }

  function mergeDeadlineLists(primary = [], secondary = []) {
    const seen = new Set();
    const result = [];
    [...primary, ...secondary].forEach((deadline) => {
      const label = normalizeText(deadline.label);
      const date = normalizeText(deadline.date);
      if (!label || !date) return;
      const key = `${label.toLowerCase()}|${date.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        label,
        date,
        type: deadline.type || inferDeadlineType(label)
      });
    });
    return result;
  }

  function mergeAssignmentIntoCourse(course, assignment) {
    const updated = normalizeCourseAssignments(course);
    const nextAssignment = {
      ...assignment,
      category: categorizeAssignment(assignment)
    };
    const nextKey = assignmentIdentityKey(nextAssignment);
    const existingIndex = updated.assignments.findIndex((item) => assignmentIdentityKey(item) === nextKey);

    if (existingIndex >= 0) {
      updated.assignments[existingIndex] = preserveMatchingTaskState(
        updated.assignments[existingIndex],
        nextAssignment
      );
    } else {
      updated.assignments.push(nextAssignment);
    }

    updated.confidence = Math.max(Number(updated.confidence) || 0, Number(nextAssignment.confidence) || 0);
    updated.warnings = [...new Set([...(updated.warnings || []), ...(nextAssignment.warnings || [])])];
    updated.actionPlan = [...new Set([...(updated.actionPlan || []), ...(nextAssignment.actionPlan || [])])].slice(0, 6);

    return refreshCourseFromAssignments(updated);
  }

  function upsertCourseFromDraft(courseList = [], draft = {}, activeCourseId = "") {
    const key = courseGroupingKey(draft);
    const assignment = createAssignmentFromDraft(draft, key || "pending-course");
    const courses = Array.isArray(courseList) ? clone(courseList).map(normalizeCourseAssignments) : [];
    const coursePlan = draft.coursePlan || {};
    const courseLevelOnly = isCourseLevelDraft(draft);
    const scheduleDateIssues = Array.isArray(draft.scheduleDateIssues)
      ? draft.scheduleDateIssues
      : [];

    if (courseLevelOnly && scheduleDateIssues.length > 0) {
      return {
        courses,
        activeCourseId,
        course: null,
        assignment,
        action: "needs-date-review",
        message: "Correct the syllabus date or re-import the material before replacing this course schedule."
      };
    }

    if (!key) {
      return {
        courses,
        activeCourseId,
        course: null,
        assignment,
        action: "needs-course",
        message: "Course identity is missing. Review the course code and course name before saving."
      };
    }

    const course = createCourseFromDraft(draft);
    const existingIndex = courses.findIndex((item) => courseGroupingKey(item) === key);
    if (existingIndex >= 0) {
      const baseCourse = {
        ...courses[existingIndex],
        source: courseLevelOnly ? course.source : courses[existingIndex].source,
        coursePlan: courseLevelOnly ? mergeCoursePlan(courses[existingIndex].coursePlan, coursePlan) : courses[existingIndex].coursePlan
      };
      const merged = courseLevelOnly ? refreshCourseFromAssignments(baseCourse) : mergeAssignmentIntoCourse(baseCourse, assignment);
      courses[existingIndex] = merged;
      return {
        courses,
        activeCourseId: merged.id,
        course: merged,
        assignment,
        action: courseLevelOnly ? "course-updated" : "merged"
      };
    }

    const created = refreshCourseFromAssignments({
      ...course,
      assignments: courseLevelOnly ? [] : [assignment],
      coursePlan: courseLevelOnly ? coursePlan : course.coursePlan
    });

    return {
      courses: [created, ...courses],
      activeCourseId: created.id,
      course: created,
      assignment,
      action: courseLevelOnly ? "course-created" : "created"
    };
  }

  function isCourseLevelDraft(draft = {}) {
    return draft.sourceType === "Syllabus or schedule";
  }

  function mergeCoursePlan(existing = {}, incoming = {}) {
    return {
      syllabusUploaded: Boolean(existing.syllabusUploaded || incoming.syllabusUploaded),
      sourceType: incoming.sourceType || existing.sourceType || "Course material",
      term: incoming.term || existing.term || "",
      professor: incoming.professor || existing.professor || "",
      credits: incoming.credits || existing.credits || "",
      section: incoming.section || existing.section || "",
      modality: incoming.modality || existing.modality || "",
      meetingLocation: incoming.meetingLocation || existing.meetingLocation || "",
      officeHours: incoming.officeHours || existing.officeHours || "",
      email: incoming.email || existing.email || "",
      deadlines: mergeDeadlineLists([], incoming.deadlines || []),
      exams: mergeDeadlineLists([], incoming.exams || []),
      grading: mergeLabelValueList(existing.grading || [], incoming.grading || []),
      weeklyGuide: mergeWeeklyGuide(existing.weeklyGuide || [], incoming.weeklyGuide || []),
      policies: mergePolicyList(existing.policies || [], incoming.policies || []),
      topics: [...new Set([...(existing.topics || []), ...(incoming.topics || [])])].slice(0, 12),
      courseRequirements: [...new Set([...(existing.courseRequirements || []), ...(incoming.courseRequirements || [])])].slice(0, 12)
    };
  }

  function mergeLabelValueList(existing = [], incoming = []) {
    const map = new Map();
    [...existing, ...incoming].forEach((item) => {
      const label = normalizeText(item.label);
      const weight = normalizeText(item.weight || item.value);
      if (!label || !weight) return;
      map.set(normalizeComparable(label), { label, weight });
    });
    return [...map.values()].slice(0, 12);
  }

  function mergeWeeklyGuide(existing = [], incoming = []) {
    const map = new Map();
    [...existing, ...incoming].forEach((week) => {
      const key = normalizeComparable(week.week || week.topic);
      if (!key) return;
      const previous = map.get(key) || {};
      map.set(key, {
        week: normalizeText(week.week || previous.week),
        topic: normalizeText(week.topic || previous.topic),
        activities: uniqueTextList([...(previous.activities || []), ...(week.activities || [])]).slice(0, 8),
        assignments: uniqueTextList([...(previous.assignments || []), ...(week.assignments || [])]).slice(0, 8),
        resources: uniqueTextList([...(previous.resources || []), ...(week.resources || [])]).slice(0, 8)
      });
    });
    return [...map.values()].slice(0, 20);
  }

  function mergePolicyList(existing = [], incoming = []) {
    const map = new Map();
    [...existing, ...incoming].forEach((policy) => {
      const label = normalizeText(policy.label);
      const text = normalizeText(policy.text);
      if (!label || !text) return;
      map.set(normalizeComparable(label), { label, text });
    });
    return [...map.values()].slice(0, 8);
  }

  function addTaskToCourse(course, title) {
    const nextTitle = normalizeText(title);
    if (!nextTitle) return clone(course);

    const updated = clone(course);
    const nextIndex = updated.tasks.length + 1;
    updated.tasks.push({
      id: `${updated.id}-task-${nextIndex}`,
      title: nextTitle,
      done: false
    });
    updated.notes = `ClassPilot is tracking ${updated.tasks.length} tasks for ${updated.name}.`;
    return updated;
  }

  function mergeCourseDeadlines(course, deadlines) {
    const updated = clone(course);
    const existingKeys = new Set(
      updated.deadlines.map((deadline) => `${deadline.label.toLowerCase()}|${deadline.date.toLowerCase()}`)
    );

    deadlines.forEach((deadline) => {
      const label = normalizeText(deadline.label);
      const date = normalizeText(deadline.date);
      if (!label || !date) return;
      const key = `${label.toLowerCase()}|${date.toLowerCase()}`;
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      updated.deadlines.push({
        label,
        date,
        type: deadline.type || inferDeadlineType(label)
      });
    });

    return updated;
  }

  function removeCourseById(courseList, courseId, activeCourseId = "") {
    const coursesAfterRemoval = clone(courseList).filter((course) => course.id !== courseId);
    const activeCourseStillExists = coursesAfterRemoval.some((course) => course.id === activeCourseId);

    return {
      courses: coursesAfterRemoval,
      activeCourseId: activeCourseStillExists ? activeCourseId : coursesAfterRemoval[0]?.id || ""
    };
  }

  function getActionAvailability(input = {}) {
    const hasCourse = Boolean(input.hasCourse);
    const hasMaterial = Boolean(normalizeText(input.material));
    const hasTaskTitle = Boolean(normalizeText(input.taskTitle));
    const deadlineCount = Number(input.deadlineCount) || 0;
    const courseCount = Number(input.courseCount) || 0;

    return {
      buildCourse: {
        enabled: hasMaterial,
        message: hasMaterial
          ? "Build a dashboard from the pasted course material."
          : "Paste course material first, then build the course dashboard."
      },
      addTask: {
        enabled: hasCourse && hasTaskTitle,
        message: !hasCourse
          ? "Import a course first, then add a task."
          : hasTaskTitle
            ? "Add this task to the selected course."
            : "Type a task name before adding it."
      },
      addDeadlines: {
        enabled: hasCourse && deadlineCount > 0,
        message:
          deadlineCount > 0 && hasCourse
            ? "Add the extracted deadlines to the selected course."
            : "Analyze class text with due dates before adding deadlines to a course."
      },
      deleteCourse: {
        enabled: hasCourse,
        message: hasCourse ? "Delete the selected course." : "Import a course before deleting one."
      },
      clearData: {
        enabled: courseCount > 0,
        message: courseCount > 0 ? "Clear all saved course data." : "No saved course data to clear."
      }
    };
  }

  function getCourseImportFileKind(file = {}) {
    const type = normalizeText(file.type).toLowerCase();
    const name = normalizeText(file.name).toLowerCase();

    if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(name)) {
      return "image";
    }

    if (type.startsWith("text/") || /\.(txt|md|csv)$/.test(name)) {
      return "text";
    }

    return "unsupported";
  }

  function calculateProgress(tasks) {
    const total = tasks.length;
    const completed = tasks.filter((task) => Boolean(task.done)).length;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

    return { completed, total, percent };
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hasMeaningfulScore(value) {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "string") return false;
    const score = value.replace(/\s+/g, " ").trim().toLowerCase();
    if (!score) return false;
    return ![
      "n/a",
      "na",
      "pending",
      "ungraded",
      "not graded",
      "--"
    ].includes(score);
  }

  function splitLines(value) {
    return String(value || "")
      .split(/\n|;/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  function splitList(value) {
    return String(value || "")
      .split(/,|\n|;/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function formatDisplayDate(value) {
    const source = normalizeText(value);
    if (!source) return "";
    const date = new Date(`${source}T12:00:00`);
    if (Number.isNaN(date.getTime())) return source;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function cleanDeadlineLabel(rawLabel) {
    const canvasTitle = extractCanvasAssignmentTitle(rawLabel);
    if (canvasTitle) return canvasTitle;

    return rawLabel
      .replace(/(?:week|module|unit)\s+\d+\s*:?\s*/i, "")
      .replace(/(?:final project proposal)$/i, "Final project proposal")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.:,-]+$/g, "");
  }

  function validNow(value) {
    const date = new Date(value ?? Date.now());
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  function academicDateContext(lines = [], options = {}) {
    const sourceOptions = options instanceof Date ? { now: options } : options;
    const now = validNow(sourceOptions.now);
    let academicYear = Number(sourceOptions.academicYear) || 0;
    let academicYearStart =
      Number(sourceOptions.academicYearStart) || 0;
    let academicYearEnd =
      Number(sourceOptions.academicYearEnd) || 0;
    let term = normalizeText(sourceOptions.term).toLowerCase();
    if (academicYearEnd !== academicYearStart + 1) {
      academicYearStart = 0;
      academicYearEnd = 0;
    }

    if (!academicYear && !academicYearStart) {
      for (const line of lines) {
        const normalizedLine = normalizeText(line);
        const termMatch = normalizedLine.match(
          /\b(spring|summer|fall|autumn|winter)\b/i
        );
        if (!term && termMatch) {
          term = termMatch[1].toLowerCase();
        }
        if (academicYearStart) continue;
        const academicYearLabel = normalizedLine.match(
          /\bacademic\s+year\b(.{0,60})/i
        );
        if (academicYearLabel) {
          const labeledYears = [
            ...academicYearLabel[1].matchAll(/\b20\d{2}\b/g)
          ].map((match) => Number(match[0]));
          const range = normalizedLine.match(
            /\bacademic\s+year\b[^0-9]{0,24}(20\d{2})(?:\s*[-\u2010-\u2015]\s*|\s+)(20\d{2})\b/i
          );
          if (
            range &&
            Number(range[2]) === Number(range[1]) + 1
          ) {
            academicYearStart = Number(range[1]);
            academicYearEnd = Number(range[2]);
            continue;
          }
          if (labeledYears.length === 1) {
            academicYear = labeledYears[0];
            break;
          }
          if (labeledYears.length > 1) continue;
        }
        const season = normalizedLine.match(
          /\b(spring|summer|fall|autumn|winter)\b[^0-9]{0,18}\b(20\d{2})\b/i
        );
        if (season) {
          term = season[1].toLowerCase();
          academicYear = Number(season[2]);
          break;
        }
        const labeledYear = normalizedLine.match(
          /\b(?:semester(?:\s+and\s+year)?|term|academic\s+year)\b[^0-9]{0,24}\b(20\d{2})\b/i
        );
        if (labeledYear) {
          academicYear = Number(labeledYear[1]);
          break;
        }
      }
    }

    return {
      now,
      academicYear,
      academicYearStart,
      academicYearEnd,
      term
    };
  }

  function localCalendarDate(year, month, day, hour = 0, minute = 0) {
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minute, 0, 0);
    return date;
  }

  function contextualDeadlineYear(month, day, options = {}) {
    const context = academicDateContext([], options);
    if (context.academicYearStart && context.academicYearEnd) {
      if (["spring", "summer"].includes(context.term)) {
        return context.academicYearEnd;
      }
      return month <= 6
        ? context.academicYearEnd
        : context.academicYearStart;
    }
    if (context.academicYear) {
      if (
        ["fall", "autumn"].includes(context.term) &&
        month <= 6
      ) {
        return context.academicYear + 1;
      }
      return context.academicYear;
    }

    const currentYear = context.now.getFullYear();
    const currentMonth = context.now.getMonth() + 1;
    return currentMonth >= 7 && month <= 6
      ? currentYear + 1
      : currentYear;
  }

  function looksLikeStructuredEnglishDate(value) {
    const source = normalizeText(value);
    const separator = "[\\s,./-]+";
    const monthFirst = new RegExp(
      `(?:^|\\b)${monthPattern}${separator}\\d{1,2}(?!\\d)`,
      "i"
    );
    const dayFirst = new RegExp(
      `(?:^|\\D)\\d{1,2}(?!\\d)${separator}${monthPattern}(?=$|[\\s,./-])`,
      "i"
    );
    const yearFirst = new RegExp(
      `(?:^|\\D)\\d{4}${separator}${monthPattern}${separator}\\d{1,2}(?!\\d)`,
      "i"
    );
    return monthFirst.test(source) ||
      dayFirst.test(source) ||
      yearFirst.test(source);
  }

  function parseStructuredEnglishDate(value, options = {}) {
    const source = normalizeText(value).replace(/,$/, "");
    if (!source) return { matched: false, valid: false };
    const dateTime = splitDeadlineDateTime(source);
    const weekdayNames = {
      mon: "Mon",
      monday: "Mon",
      tue: "Tue",
      tuesday: "Tue",
      wed: "Wed",
      wednesday: "Wed",
      thu: "Thu",
      thursday: "Thu",
      fri: "Fri",
      friday: "Fri",
      sat: "Sat",
      saturday: "Sat",
      sun: "Sun",
      sunday: "Sun"
    };
    const weekdayMatch = dateTime.date.match(
      /^(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+(.+)$/i
    );
    const weekday = weekdayMatch
      ? weekdayNames[weekdayMatch[1].toLowerCase()]
      : "";
    const datePart = weekdayMatch ? weekdayMatch[2] : dateTime.date;
    const monthFirst =
      datePart.match(
        /^([A-Za-z]+\.?)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/
      ) ||
      datePart.match(
        /^([A-Za-z]+)[./-](\d{1,2})[./-](\d{4})$/
      );
    const dayFirst =
      datePart.match(
        /^(\d{1,2})\s+([A-Za-z]+\.?)(?:,?\s+(\d{4}))?$/
      ) ||
      datePart.match(
        /^(\d{1,2})[./-]([A-Za-z]+)[./-](\d{4})$/
      );
    if (!monthFirst && !dayFirst) {
      return {
        matched: looksLikeStructuredEnglishDate(datePart),
        valid: false
      };
    }
    const monthToken = monthFirst ? monthFirst[1] : dayFirst[2];
    const monthName = deadlineMonthNames[
      monthToken.toLowerCase().replace(/\.$/, "")
    ];
    if (!monthName) {
      return {
        matched: looksLikeStructuredEnglishDate(datePart),
        valid: false
      };
    }

    const month = deadlineMonthNumbers[monthName];
    const day = Number(monthFirst ? monthFirst[2] : dayFirst[1]);
    const yearToken = monthFirst ? monthFirst[3] : dayFirst[3];
    const explicitYear = yearToken ? Number(yearToken) : 0;
    const year = explicitYear ||
      contextualDeadlineYear(month, day, options);
    if (
      dateTime.invalidTime ||
      !isValidCalendarDate(year, month, day)
    ) {
      return { matched: true, valid: false };
    }

    let hour = 0;
    let minute = 0;
    if (dateTime.time) {
      const amPm = dateTime.time.match(
        /^(\d{1,2}):(\d{2})\s+(AM|PM)$/
      );
      const twentyFourHour = dateTime.time.match(/^(\d{2}):(\d{2})$/);
      if (amPm) {
        hour = Number(amPm[1]) % 12 +
          (amPm[3] === "PM" ? 12 : 0);
        minute = Number(amPm[2]);
      } else if (twentyFourHour) {
        hour = Number(twentyFourHour[1]);
        minute = Number(twentyFourHour[2]);
      }
    }

    const date = localCalendarDate(year, month, day, hour, minute);
    return {
      matched: true,
      valid: true,
      inferredYear: !explicitYear,
      year,
      month,
      day,
      dueAt: date.toISOString(),
      formatted: appendDeadlineTime(
        formatDeadlineDatePart(
          monthName,
          day,
          String(year),
          weekday
        ),
        dateTime.time
      )
    };
  }

  function formatDeadlineDate(rawDate, options = {}) {
    const source = normalizeText(rawDate).replace(/,$/, "");
    const structuredEnglish = parseStructuredEnglishDate(source, options);
    if (structuredEnglish.matched) {
      return structuredEnglish.valid ? structuredEnglish.formatted : "";
    }
    const dateTime = splitDeadlineDateTime(source);
    if (dateTime.invalidTime) return "";
    const weekdayNames = {
      mon: "Mon",
      monday: "Mon",
      tue: "Tue",
      tuesday: "Tue",
      wed: "Wed",
      wednesday: "Wed",
      thu: "Thu",
      thursday: "Thu",
      fri: "Fri",
      friday: "Fri",
      sat: "Sat",
      saturday: "Sat",
      sun: "Sun",
      sunday: "Sun"
    };
    const weekdayMatch = dateTime.date.match(
      /^(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+(.+)$/i
    );
    const weekday = weekdayMatch ? weekdayNames[weekdayMatch[1].toLowerCase()] : "";
    const datePart = weekdayMatch ? weekdayMatch[2] : dateTime.date;

    const numericMatch = datePart.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
    if (numericMatch) {
      const monthNumber = Number(numericMatch[1]);
      const day = Number(numericMatch[2]);
      const normalizedYear = normalizeDeadlineYear(numericMatch[3]);
      const year = Number(normalizedYear || 2026);
      if (!isValidCalendarDate(year, monthNumber, day)) return "";
      const month = Object.keys(deadlineMonthNumbers)
        .find((name) => deadlineMonthNumbers[name] === monthNumber);
      return appendDeadlineTime(
        formatDeadlineDatePart(month, day, normalizedYear, weekday),
        dateTime.time
      );
    }

    const isoMatch = datePart.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const monthNumber = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      if (!isValidCalendarDate(year, monthNumber, day)) return "";
      const month = Object.keys(deadlineMonthNumbers)
        .find((name) => deadlineMonthNumbers[name] === monthNumber);
      return appendDeadlineTime(
        formatDeadlineDatePart(month, day, isoMatch[1], weekday),
        dateTime.time
      );
    }

    return appendDeadlineTime(dateTime.date || source, dateTime.time);
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

  function normalizeDeadlineYear(year) {
    if (!year) return "";
    return year.length === 2 ? `20${year}` : year;
  }

  function formatDeadlineDatePart(month, day, year, weekday = "") {
    if (!month || !day) return "";
    const normalizedYear = normalizeDeadlineYear(year);
    const date = `${month} ${Number(day)}${normalizedYear ? `, ${normalizedYear}` : ""}`;
    return weekday ? `${weekday} ${date}` : date;
  }

  function splitDeadlineDateTime(source) {
    const normalized = normalizeText(source);
    const match = normalized.match(
      /\s+(?:at\s+)?(?:(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?|(\d{1,2}):(\d{2}))$/i
    );
    if (!match) {
      return {
        date: source,
        time: "",
        invalidTime: ""
      };
    }

    const amPm = Boolean(match[3]);
    const hour = Number(amPm ? match[1] : match[4]);
    const minuteValue = Number(
      amPm ? match[2] || "00" : match[5]
    );
    const validHour = amPm
      ? hour >= 1 && hour <= 12
      : hour >= 0 && hour <= 23;
    const validTime = validHour &&
      minuteValue >= 0 && minuteValue <= 59;
    const period = amPm
      ? match[3].toUpperCase() === "A" ? "AM" : "PM"
      : "";
    const minutes = String(minuteValue).padStart(2, "0");
    return {
      date: normalized.slice(0, match.index)
        .replace(/\bat\s*$/i, "")
        .replace(/,$/, "")
        .trim(),
      time: validTime
        ? amPm
          ? `${hour}:${minutes} ${period}`
          : `${String(hour).padStart(2, "0")}:${minutes}`
        : "",
      invalidTime: validTime
        ? ""
        : normalized.slice(match.index).trim()
    };
  }

  function appendDeadlineTime(date, time) {
    return time ? `${date}, ${time}` : date;
  }

  function inferDeadlineLabel(prefix, lines, index) {
    const cleanedPrefix = cleanDeadlineLabel(prefix.replace(/\b(due\s*date|due|deadline)\b\s*:?\s*$/i, ""));
    if (cleanedPrefix && !/^(due|due date|deadline)$/i.test(cleanedPrefix)) {
      return cleanedPrefix;
    }

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = cleanDeadlineLabel(lines[cursor]);
      const canvasTitle = extractCanvasAssignmentTitle(lines[cursor]);
      if (canvasTitle) {
        return canvasTitle;
      }
      if (
        candidate &&
        !/^(topics?|units?|chapters?)\s*:/i.test(candidate) &&
        !/\b(due\s*date|due|deadline|available until|until)\b/i.test(candidate)
      ) {
        return candidate;
      }
    }

    return "Course deadline";
  }

  function analyzeSyllabus(text, options = {}) {
    const source = String(text || "").trim();
    const protectedSource = source.replace(
      new RegExp(
        `\\b(${monthNamePattern})\\.(?=\\s+\\d{1,4}\\b)`,
        "gi"
      ),
      "$1\u0000"
    );
    const lines = protectedSource
      .split(/\r?\n|(?<=\.)\s+/)
      .map((line) => normalizeText(
        line.replace(/\u0000/g, ".").replace(/^\s*[-*•]\s*/, "")
      ))
      .filter(Boolean);
    const dateContext = academicDateContext(lines, options);
    const expression = new RegExp(
      `([A-Za-z0-9][A-Za-z0-9 /'-]{1,70}?)(?:\\s+(?:due|on|by)\\s+)(${monthPattern}\\s+\\d{1,2})`,
      "gi"
    );
    const timePattern = "(?:\\s+(?:at\\s+)?(?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}:\\d{2}))?";
    const dateValuePattern = `(?:${monthPattern}\\s+\\d{1,2}(?:,?\\s+\\d{4})?${timePattern}|\\d{1,2}\\s+${monthPattern}(?:,?\\s+\\d{4})?${timePattern}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?${timePattern}|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}${timePattern})`;
    const datePattern = `(${dateValuePattern})`;
    const weekdayPattern = "(?:(?:Mon|Monday|Tue|Tuesday|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday),?\\s+)?";
    const dueLineExpression = new RegExp(
      `^(.*?)(?:\\b(?:due\\s*date|due|deadline|available\\s+until|until|by)\\b\\s*:?\\s*)(${weekdayPattern}${dateValuePattern})`,
      "i"
    );
    const deadlines = [];
    const dateIssues = [];
    const seen = new Set();
    const seenIssues = new Set();
    const addDeadline = (label, date, type, sourceLine = "") => {
      const cleanLabel = cleanDeadlineLabel(label);
      const cleanDate = normalizeText(date);
      const canonicalDate = formatDeadlineDate(cleanDate, dateContext);
      const issueKind = isAmbiguousNumericDeadlineDate(cleanDate)
        ? "ambiguous"
        : canonicalDate
          ? ""
          : "invalid";
      if (issueKind) {
        const issueKey = `${issueKind}|${normalizeComparable(cleanLabel)}|${cleanDate.toLowerCase()}`;
        if (!seenIssues.has(issueKey)) {
          seenIssues.add(issueKey);
          dateIssues.push({
            kind: issueKind,
            label: cleanLabel || "Course deadline",
            value: cleanDate,
            source: normalizeText(sourceLine) || `${cleanLabel} due ${cleanDate}`
          });
        }
        return;
      }
      const labelKey = normalizeComparable(cleanLabel);
      const dateBaseKey = deadlineDateBaseKey(canonicalDate);
      const existingIndex = deadlines.findIndex(
        (deadline) => normalizeComparable(deadline.label) === labelKey && deadlineDateBaseKey(deadline.date) === dateBaseKey
      );
      if (existingIndex >= 0) {
        if (deadlineSpecificity(canonicalDate) > deadlineSpecificity(deadlines[existingIndex].date)) {
          deadlines[existingIndex] = {
            label: cleanLabel,
            date: canonicalDate,
            type: type || inferDeadlineType(cleanLabel)
          };
        }
        return;
      }
      const key = `${cleanLabel.toLowerCase()}|${canonicalDate.toLowerCase()}`;
      if (/^(submitted|submission|turned in)$/i.test(cleanLabel)) return;
      if (!cleanLabel || !cleanDate || seen.has(key)) return;
      seen.add(key);
      deadlines.push({
        label: cleanLabel,
        date: canonicalDate,
        type: type || inferDeadlineType(cleanLabel)
      });
    };
    let match;

    while ((match = expression.exec(source)) !== null) {
      const label = cleanDeadlineLabel(match[1]);
      if (label) {
        const sourceLine = lines.find((line) =>
          normalizeComparable(line).includes(normalizeComparable(match[2]))
        ) || match[0];
        addDeadline(label, match[2], inferDeadlineType(label), sourceLine);
      }
    }

    lines.forEach((line, index) => {
      const dueMatch = line.match(dueLineExpression);
      if (!dueMatch) return;
      const label = inferDeadlineLabel(dueMatch[1], lines, index);
      addDeadline(label, dueMatch[2], inferDeadlineType(label), line);
    });

    const summary =
      deadlines.length === 0
        ? "No dated academic checkpoints were found. Try text like 'Due Date: July 28, 2026' or 'Homework due Aug 12'."
        : `Found ${deadlines.length} academic checkpoints and converted them into course actions.`;

    return {
      summary,
      deadlines: deadlines.slice(0, 6),
      dateIssues,
      nextAction:
        deadlines.length > 0
          ? `Start with ${deadlines[0].label} because it is the first visible deadline.`
          : "Paste copied class text with assignment names and due dates."
    };
  }

  function isAmbiguousNumericDeadlineDate(value) {
    const dateTime = splitDeadlineDateTime(normalizeText(value));
    const datePart = dateTime.date.replace(
      /^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+/i,
      ""
    );
    return /^\d{1,2}[/-]\d{1,2}$/.test(datePart);
  }

  function refineCanvasDeadlines(deadlines = [], lines = [], sourceType = "Course material") {
    if (!sourceType.startsWith("Canvas")) return deadlines;
    const assignmentTitle = extractBestCanvasAssignmentTitle(lines);
    if (!assignmentTitle) return deadlines;

    return deadlines.map((deadline, index) => {
      const label = normalizeText(deadline.label);
      if (index > 0 && !isWeakCanvasAssignmentTitle(label)) return deadline;
      if (!isWeakCanvasAssignmentTitle(label) && normalizeComparable(label) === normalizeComparable(assignmentTitle)) {
        return deadline;
      }
      return {
        ...deadline,
        label: assignmentTitle,
        type: inferDeadlineType(assignmentTitle)
      };
    });
  }

  function deadlineDateBaseKey(date) {
    const match = normalizeText(date).match(/^([A-Za-z]+)\s+(\d{1,2})/);
    return match ? `${match[1].toLowerCase()}-${Number(match[2])}` : normalizeComparable(date);
  }

  function deadlineSpecificity(date) {
    const value = normalizeText(date);
    let score = value.length;
    if (/\b\d{4}\b/.test(value)) score += 20;
    if (/\b\d{1,2}:\d{2}(?:\s*(AM|PM))?\b/i.test(value)) score += 20;
    return score;
  }

  function inferDeadlineType(label) {
    const lowered = label.toLowerCase();
    if (/\b(final|midterm)\s+exam\b/.test(lowered) || /\bexam\b/.test(lowered) || /\bmidterm\b/.test(lowered) || /^finals?$/.test(lowered)) {
      return "exam";
    }
    if (lowered.includes("presentation") || lowered.includes("slides")) return "presentation";
    if (lowered.includes("project")) return "project";
    if (lowered.includes("quiz")) return "quiz";
    if (lowered.includes("essay") || lowered.includes("memo") || lowered.includes("report")) return "paper";
    return "assignment";
  }

  function buildAssignmentBreakdown(prompt) {
    const text = String(prompt || "").toLowerCase();
    const checklist = [
      "Restate the assignment goal in one sentence",
      "Identify the grading rubric requirements",
      "Collect source-based evidence before drafting"
    ];

    if (text.includes("research")) checklist.push("Define a focused research question and supporting evidence");
    if (text.includes("presentation") || text.includes("slide")) checklist.push("Create slide titles that match the assignment steps");
    if (text.includes("citation") || text.includes("source")) checklist.push("Add citation reminders beside every evidence-based claim");
    if (text.includes("recommendation")) checklist.push("End with a recommendation connected to your findings");
    if (text.includes("feedback") || text.includes("survey")) checklist.push("Group feedback into themes before writing conclusions");

    const timeline = [
      "Day 1: Understand the prompt and mark rubric keywords",
      "Day 2: Gather notes, sources, and examples",
      "Day 3: Draft the main answer or slide structure",
      "Day 4: Check rubric fit, citations, and final submission details"
    ];

    const rubricTips = [
      "Evidence: connect every claim to notes, data, or class material",
      "Organization: make each section answer one part of the prompt",
      "Academic integrity: use AI for planning and checking, not for replacing your own work"
    ];

    return {
      title: prompt ? "Generated assignment action plan" : "Assignment action plan",
      checklist,
      timeline,
      rubricTips
    };
  }

  function buildAssignmentCoach(course = {}, assignment = {}, language = "en") {
    const currentCourse = normalizeCourseAssignments(course || {});
    const currentAssignment = {
      ...assignment,
      category: categorizeAssignment(assignment)
    };
    const lang = coachLanguage(language);
    const title = normalizeText(currentAssignment.title) || "Current assignment";
    const detailText = assignmentCoachText(currentAssignment);
    const mustDo = assignmentMustDoItems(currentAssignment, lang);
    const nextSteps = assignmentNextSteps(currentAssignment, detailText, lang);

    return {
      title,
      summary: assignmentCoachSummary(currentAssignment, detailText, lang),
      mustDo,
      nextSteps,
      scoreStrategy: assignmentScoreStrategy(currentCourse, currentAssignment, detailText, lang),
      writingHelp: assignmentWritingHelp(currentAssignment, detailText, lang),
      riskFlags: assignmentRiskFlags(currentAssignment, detailText, lang)
    };
  }

  function buildCourseCoach(course = {}, language = "en") {
    const currentCourse = normalizeCourseAssignments(course || {});
    const lang = coachLanguage(language);
    const plan = currentCourse.coursePlan || {};
    const code = normalizeText(currentCourse.code) || "Course";
    const name = normalizeText(currentCourse.name) || "Unnamed course";
    const grading = Array.isArray(plan.grading) ? plan.grading : [];
    const policies = Array.isArray(plan.policies) ? plan.policies : [];
    const weeklyGuide = Array.isArray(plan.weeklyGuide) ? plan.weeklyGuide : [];
    const exams = Array.isArray(plan.exams) ? plan.exams : [];

    const priorities = grading.length
      ? grading
          .map((item) => {
            const label = normalizeText(item.label);
            const weight = normalizeText(item.weight);
            if (!label || !weight) return "";
            return lang === "zh"
              ? `${label} ${weight}: 这是总评里的明确权重，优先安排时间。`
              : `${label} ${weight}: this is an explicit grading weight, so protect time for it.`;
          })
          .filter(Boolean)
          .slice(0, 5)
      : [
          lang === "zh"
            ? "上传这门课自己的 syllabus 后，ClassPilot 会列出 grading 权重。"
            : "Upload this course's own syllabus to see grading weights."
        ];

    const policyNotes = policies.length
      ? policies
          .map((policy) => {
            const label = normalizeText(policy.label);
            const text = normalizeText(policy.text);
            if (!label || !text) return "";
            return `${label}: ${text}`;
          })
          .filter(Boolean)
          .slice(0, 5)
      : [
          lang === "zh"
            ? "还没有读取到课程 policy。每门课需要分别上传 syllabus。"
            : "No course policy detected yet. Each course needs its own syllabus upload."
        ];

    const studyFocus = uniqueTextList([
      ...weeklyGuide.map((week) => {
        const weekLabel = normalizeText(week.week);
        const topic = normalizeText(week.topic);
        const assignments = Array.isArray(week.assignments) ? week.assignments.map(normalizeText).filter(Boolean).join(", ") : "";
        if (!weekLabel && !topic && !assignments) return "";
        return [weekLabel, topic, assignments].filter(Boolean).join(": ");
      }),
      ...exams.map((exam) => {
        const label = normalizeText(exam.label);
        const date = normalizeText(exam.date);
        if (!label) return "";
        return date ? `${label}: ${date}` : label;
      })
    ])
      .filter(Boolean)
      .slice(0, 6);

    return {
      title: code,
      summary:
        lang === "zh"
          ? `${code} 是 ${name}。课程级 coach 会根据这门课单独上传的 syllabus 抓住 grading、policy、weekly guide 和 exam。`
          : `${code} is ${name}. The course coach uses this course's own syllabus for grading, policies, weekly guide, and exams.`,
      priorities,
      policyNotes,
      studyFocus:
        studyFocus.length > 0
          ? studyFocus
          : [
              lang === "zh"
                ? "上传 syllabus 后，这里会出现 week-by-week 的作业和考试重点。"
                : "Upload a syllabus to show week-by-week assignments and exam focus."
            ]
    };
  }

  function coachLanguage(language) {
    return String(language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function assignmentCoachText(assignment = {}) {
    const details = assignment.details || {};
    const taskTitles = Array.isArray(assignment.tasks) ? assignment.tasks.map((task) => task.title) : [];
    const requirementText = Array.isArray(details.requirements) ? details.requirements : [];
    const deliverableText = Array.isArray(details.deliverables) ? details.deliverables : [];
    const stepText = Array.isArray(details.steps) ? details.steps : [];
    const rubricText = Array.isArray(details.rubric)
      ? details.rubric.map((item) => [item.label, item.weight, item.description].filter(Boolean).join(" "))
      : [];

    return uniqueTextList([
      assignment.title,
      assignment.dueDate,
      assignment.points,
      details.overview,
      ...requirementText,
      ...deliverableText,
      ...stepText,
      ...taskTitles,
      ...rubricText
    ]).join(" ");
  }

  function assignmentMustDoItems(assignment = {}, lang = "en") {
    const details = assignment.details || {};
    const status = assignment.status || {};
    const items = [];
    if (assignment.dueDate && assignment.dueDate !== "No date") {
      items.push(lang === "zh" ? `截止时间: ${assignment.dueDate}` : `Due: ${assignment.dueDate}`);
    }
    if (assignment.points) items.push(assignment.points);
    if (status.nextUp) items.push(lang === "zh" ? `Canvas 下一步: ${status.nextUp}` : `Canvas next up: ${status.nextUp}`);
    if (status.attempt) items.push(status.attempt);
    if (status.attemptsAllowed) items.push(status.attemptsAllowed);
    (Array.isArray(details.requirements) ? details.requirements : []).forEach((item) => items.push(item));
    (Array.isArray(details.deliverables) ? details.deliverables : []).forEach((item) =>
      items.push(lang === "zh" ? `交付物: ${item}` : `Deliverable: ${item}`)
    );
    (Array.isArray(details.submissionTypes) ? details.submissionTypes : []).forEach((item) =>
      items.push(lang === "zh" ? `提交方式: ${item}` : `Submission type: ${item}`)
    );
    return uniqueTextList(items).slice(0, 8);
  }

  function assignmentNextSteps(assignment = {}, text = "", lang = "en") {
    const details = assignment.details || {};
    const lower = text.toLowerCase();
    const items = [];

    if (/seminar/.test(lower)) {
      items.push(lang === "zh" ? "参加 seminar，并记录可以写进 reflection 的重点。" : "Attend the seminar and capture notes you can reflect on.");
    }
    if (/one\s*page|max one page|1\s*page|reflection/.test(lower)) {
      items.push(lang === "zh" ? "写一页以内的 reflection，说明你参加后的收获。" : "Write a one-page reflection about what you learned.");
    }
    if (/picture|photo|image/.test(lower)) {
      items.push(lang === "zh" ? "加入图片，并让图片支持 reflection 里的观点。" : "Add pictures that support the reflection, not just decoration.");
    }

    (Array.isArray(details.steps) ? details.steps : []).forEach((item) => items.push(coachStepText(item, lang)));
    (Array.isArray(assignment.tasks) ? assignment.tasks : []).forEach((task) => items.push(coachStepText(task.title, lang)));
    if (assignment.status?.nextUp) {
      items.push(lang === "zh" ? `最后在 Canvas 完成: ${assignment.status.nextUp}` : `Finish the Canvas action: ${assignment.status.nextUp}.`);
    }
    if (assignment.dueDate && assignment.dueDate !== "No date") {
      items.push(lang === "zh" ? `提交前再次检查截止时间: ${assignment.dueDate}` : `Before submitting, check the due date again: ${assignment.dueDate}.`);
    }

    return uniqueTextList(items).slice(0, 7);
  }

  function coachStepText(step, lang = "en") {
    const value = normalizeText(step);
    const lower = value.toLowerCase();
    if (lang !== "zh") return value;
    if (/attend a seminar/.test(lower)) return "参加 seminar，并记录可以写进 reflection 的重点。";
    if (/one-page reflection|one page reflection|reflection/.test(lower)) return "写一页以内的 reflection，说明你参加后的收获。";
    if (/pictures|photos|images/.test(lower)) return "加入图片，并让图片支持 reflection 里的观点。";
    if (/submit assignment|canvas/.test(lower)) return "在 Canvas 按允许的提交方式提交。";
    if (/check final response|check.+due|points/.test(lower)) return "提交前检查 due date、points 和老师要求。";
    return value;
  }

  function assignmentScoreStrategy(course = {}, assignment = {}, text = "", lang = "en") {
    const details = assignment.details || {};
    const lower = text.toLowerCase();
    const grading = Array.isArray(course.coursePlan?.grading) ? course.coursePlan.grading : [];
    const title = normalizeComparable(assignment.title);
    const matchedGrade = grading.find((item) => {
      const label = normalizeComparable(item.label);
      return label && (title.includes(label) || label.includes(title) || (title.includes("seminar") && label.includes("seminar")));
    });
    const items = [];
    const courseLabel = [course.code, course.name].map(normalizeText).filter(Boolean).join(" ");

    if (matchedGrade) {
      items.push(
        lang === "zh"
          ? `这项作业对应 ${normalizeText(course.code) || "这门课程"} 里的 ${matchedGrade.label} ${matchedGrade.weight}，内容要和课程主题连起来。`
          : `This assignment connects to ${matchedGrade.label} ${matchedGrade.weight} in ${normalizeText(course.code) || "this class"}, so tie the work back to class themes.`
      );
    } else if (courseLabel) {
      items.push(
        lang === "zh"
          ? `把答案和 ${courseLabel} 的课程主题联系起来，不要只完成表面要求。`
          : `Tie the answer back to ${courseLabel} instead of only completing the surface requirement.`
      );
    }

    if (assignment.points) {
      items.push(
        lang === "zh"
          ? `${assignment.points} 表示它会影响成绩；提交前用老师要求逐项检查。`
          : `${assignment.points} means quality matters; check the instructor requirements before submitting.`
      );
    }
    if (/one\s*page|max one page|1\s*page/.test(lower)) {
      items.push(
        lang === "zh"
          ? "一页限制下，先写最重要的观点，再删掉流水账。"
          : "With a one-page limit, lead with the strongest insight and remove diary-style filler."
      );
    }
    if (/picture|photo|image/.test(lower)) {
      items.push(
        lang === "zh"
          ? "图片要服务于你的 reflection：每张图旁边最好能对应一个具体观察。"
          : "Use each picture as evidence for a specific observation in the reflection."
      );
    }
    (Array.isArray(details.rubric) ? details.rubric : []).slice(0, 2).forEach((item) => {
      items.push(
        lang === "zh"
          ? `Rubric 重点: ${item.label} ${item.weight || ""}${item.description ? ` - ${item.description}` : ""}`
          : `Rubric signal: ${item.label} ${item.weight || ""}${item.description ? ` - ${item.description}` : ""}`
      );
    });

    return uniqueTextList(items).slice(0, 5);
  }

  function assignmentWritingHelp(assignment = {}, text = "", lang = "en") {
    const lower = text.toLowerCase();
    if (/seminar/.test(lower)) {
      return lang === "zh"
        ? [
            "This seminar helped me understand ...（把 seminar 和课程主题连接起来。）",
            "One point from the speaker that changed my thinking was ...",
            "The picture I included shows ... because ..."
          ]
        : [
            "This seminar helped me understand ...",
            "One point from the speaker that changed my thinking was ...",
            "The picture I included shows ... because ..."
          ];
    }
    if (/report|paper|analysis|essay/.test(lower)) {
      return lang === "zh"
        ? [
            "My main argument is ...",
            "The strongest evidence for this claim is ...",
            "Compared with the AI-assisted research, my own judgment is ..."
          ]
        : [
            "My main argument is ...",
            "The strongest evidence for this claim is ...",
            "Compared with the AI-assisted research, my own judgment is ..."
          ];
    }
    return lang === "zh"
      ? ["The assignment asks me to ...", "The evidence I need is ...", "Before submitting, I will check ..."]
      : ["The assignment asks me to ...", "The evidence I need is ...", "Before submitting, I will check ..."];
  }

  function assignmentRiskFlags(assignment = {}, text = "", lang = "en") {
    const lower = text.toLowerCase();
    const status = assignment.status || {};
    const items = [];
    if (assignment.dueDate && assignment.dueDate !== "No date") {
      items.push(lang === "zh" ? `截止/due: ${assignment.dueDate}` : `Due risk: ${assignment.dueDate}.`);
    }
    if (status.late) items.push(lang === "zh" ? "Canvas 已标记 Late，需要优先处理反馈或补交要求。" : "Canvas marks this late; check feedback or resubmission rules.");
    if (status.submittedAt) items.push(lang === "zh" ? `已提交: ${status.submittedAt}，下一步看 Canvas 状态。` : `Submitted on ${status.submittedAt}; check the next Canvas status.`);
    if (status.nextUp) items.push(lang === "zh" ? `Canvas 下一步是 ${status.nextUp}。` : `Canvas next step is ${status.nextUp}.`);
    if (/one\s*page|max one page|1\s*page/.test(lower)) {
      items.push(lang === "zh" ? "一页限制容易超字数，完成后压缩到重点。" : "The one-page limit makes concision important.");
    }
    if (/picture|photo|image/.test(lower)) {
      items.push(lang === "zh" ? "不要忘记图片要求；缺图片可能直接丢分。" : "Do not miss the picture requirement.");
    }
    return uniqueTextList(items).slice(0, 5);
  }

  function assignmentCoachSummary(assignment = {}, text = "", lang = "en") {
    const title = normalizeText(assignment.title) || "This assignment";
    const lower = text.toLowerCase();
    if (lang === "zh") {
      if (/seminar/.test(lower) && /reflection/.test(lower)) {
        return `${title} 要你参加 seminar，并写一页以内的 reflection；如果材料要求 pictures，也要把图片作为证据放进去。`;
      }
      if (/paper|report|analysis|essay/.test(lower)) {
        return `${title} 的重点是按 prompt 完成分析、证据和交付物，并把自己的判断写清楚。`;
      }
      return `${title} 的重点是把上传材料里的要求转成可提交的作业。`;
    }
    if (/seminar/.test(lower) && /reflection/.test(lower)) {
      return `${title} asks you to attend a seminar, write a one-page reflection, and include pictures when required.`;
    }
    if (/paper|report|analysis|essay/.test(lower)) {
      return `${title} is mainly about turning the prompt into clear analysis, evidence, and deliverables.`;
    }
    return `${title} is ready to turn into a checklist, draft, and final submission.`;
  }

  function parseLocalDate(dateValue) {
    if (dateValue instanceof Date) return dateValue;
    return new Date(`${dateValue}T12:00:00`);
  }

  function buildStudyPlan({ examDate, difficulty = "medium", now = new Date() }) {
    if (!normalizeText(examDate)) {
      return {
        daysUntilExam: 0,
        sessions: [],
        summary: "Choose an exam date to generate a study plan."
      };
    }

    const target = parseLocalDate(examDate);
    const current = now instanceof Date ? now : parseLocalDate(now);
    if (Number.isNaN(target.getTime())) {
      return {
        daysUntilExam: 0,
        sessions: [],
        summary: "Choose an exam date to generate a study plan."
      };
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const daysUntilExam = Math.max(0, Math.ceil((target.getTime() - current.getTime()) / dayMs));
    const difficultyMap = {
      easy: 3,
      medium: 4,
      hard: 5
    };
    const sessionCount = difficultyMap[difficulty] || difficultyMap.medium;
    const sessions = Array.from({ length: sessionCount }, (_, index) => {
      const dayOffset = Math.max(1, Math.round(((index + 1) / (sessionCount + 1)) * Math.max(daysUntilExam, 1)));
      return {
        day: `T-${Math.max(daysUntilExam - dayOffset, 0)}`,
        focus: studyFocusFor(index),
        output: studyOutputFor(index)
      };
    });

    return {
      daysUntilExam,
      sessions,
      summary: `Exam is ${daysUntilExam} days away. Plan ${sessions.length} focused sessions before the final review.`
    };
  }

  function studyFocusFor(index) {
    const focuses = [
      "Collect materials and mark weak topics",
      "Review core concepts with beginner-friendly explanations",
      "Practice quiz questions and explain wrong answers",
      "Create flashcards for terms, formulas, and examples",
      "Run a final source-check and confidence review"
    ];
    return focuses[index] || focuses[focuses.length - 1];
  }

  function studyOutputFor(index) {
    const outputs = [
      "organized note list",
      "one-page summary",
      "practice quiz score",
      "flashcard set",
      "final checklist"
    ];
    return outputs[index] || outputs[outputs.length - 1];
  }

  function getBilingualExplanation(topic, language) {
    const key = String(topic || "default").toLowerCase();
    const entry = explanationBank[key] || explanationBank.default;
    return language === "zh" ? entry.zh : entry.en;
  }

  const api = {
    addTaskToCourse,
    analyzeSyllabus,
    buildAssignmentBreakdown,
    buildAssignmentCoach,
    buildCourseCoach,
    buildStudyPlan,
    calculateProgress,
    applyCourseContextToDraft,
    bindDraftToCourse,
    createCourseDraftFromMaterial,
    createCourseFromDraft,
    createCourseFromMaterial,
    createCourseFromInput,
    createAssignmentFromDraft,
    groupAssignmentsByCategory,
    hasMeaningfulScore,
    getActionAvailability,
    getCourseImportFileKind,
    mergeCourseDeadlines,
    normalizeCourseAssignments,
    parseStructuredEnglishDate,
    removeCourseById,
    upsertCourseFromDraft,
    getBilingualExplanation
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.ClassPilotLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
