const {
  addTaskToCourse,
  applyCourseContextToDraft,
  bindDraftToCourse,
  buildAssignmentCoach,
  buildCourseCoach,
  calculateProgress,
  createCourseDraftFromMaterial,
  groupAssignmentsByCategory,
  getActionAvailability,
  getCourseImportFileKind,
  normalizeCourseAssignments,
  removeCourseById,
  upsertCourseFromDraft,
} = window.ClassPilotLogic;

const colorMap = {
  teal: { color: "#1f7a78", soft: "#d7eeea" },
  coral: { color: "#df5b49", soft: "#f9ddd7" },
  gold: { color: "#efbd45", soft: "#f8edc8" }
};

const storageKey = "classpilot-user-courses-v6";

let courses = loadSavedCourses();
let activeCourseId = courses[0]?.id || "";
let explanationLanguage = "en";
let importIsBusy = false;
let pendingImportDraft = null;
let screenshotPreviewUrl = "";

const elements = {
  addTaskButton: document.querySelector("#addTaskButton"),
  appStatus: document.querySelector("#appStatus"),
  breakdownResult: document.querySelector("#breakdownResult"),
  buildCourseButton: document.querySelector("#buildCourseButton"),
  clearCourses: document.querySelector("#clearCourses"),
  coachOutput: document.querySelector("#coachOutput"),
  completedCount: document.querySelector("#completedCount"),
  confidencePill: document.querySelector("#confidencePill"),
  courseFile: document.querySelector("#courseFile"),
  courseImportForm: document.querySelector("#courseImportForm"),
  courseList: document.querySelector("#courseList"),
  courseMaterial: document.querySelector("#courseMaterial"),
  courseNotes: document.querySelector("#courseNotes"),
  courseSubtitle: document.querySelector("#courseSubtitle"),
  deleteCourse: document.querySelector("#deleteCourse"),
  courseTitle: document.querySelector("#courseTitle"),
  miniMap: document.querySelector("#miniMap"),
  progressOrb: document.querySelector("#progressOrb"),
  railNote: document.querySelector("#railNote"),
  discardReviewCourse: document.querySelector("#discardReviewCourse"),
  importReviewCard: document.querySelector("#importReviewCard"),
  reviewAssignment: document.querySelector("#reviewAssignment"),
  reviewCourseCode: document.querySelector("#reviewCourseCode"),
  reviewCourseName: document.querySelector("#reviewCourseName"),
  reviewDueDate: document.querySelector("#reviewDueDate"),
  reviewLinks: document.querySelector("#reviewLinks"),
  reviewPoints: document.querySelector("#reviewPoints"),
  reviewRawText: document.querySelector("#reviewRawText"),
  reviewSmartReadout: document.querySelector("#reviewSmartReadout"),
  reviewTasks: document.querySelector("#reviewTasks"),
  saveReviewCourse: document.querySelector("#saveReviewCourse"),
  sourceCheckText: document.querySelector("#sourceCheckText"),
  screenshotOcrProgress: document.querySelector("#screenshotOcrProgress"),
  screenshotPreview: document.querySelector("#screenshotPreview"),
  screenshotPreviewCard: document.querySelector("#screenshotPreviewCard"),
  screenshotPreviewMeta: document.querySelector("#screenshotPreviewMeta"),
  studyPlan: document.querySelector("#studyPlan"),
  syllabusResult: document.querySelector("#syllabusResult"),
  taskForm: document.querySelector("#taskForm"),
  taskList: document.querySelector("#taskList"),
  taskTitle: document.querySelector("#taskTitle"),
  upcomingCount: document.querySelector("#upcomingCount"),
  weekRail: document.querySelector("#weekRail")
};

function loadSavedCourses() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved).map(normalizeCourseAssignments) : [];
  } catch (error) {
    return [];
  }
}

function saveCourses() {
  window.localStorage.setItem(storageKey, JSON.stringify(courses));
}

function getActiveCourse() {
  return courses.find((course) => course.id === activeCourseId) || courses[0] || null;
}

function setCourseTheme(course) {
  const theme = colorMap[course?.accent] || colorMap.teal;
  document.documentElement.style.setProperty("--course-color", theme.color);
  document.documentElement.style.setProperty("--course-soft", theme.soft);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeUniqueCourseId(course) {
  let id = course.id;
  let suffix = 2;
  while (courses.some((item) => item.id === id)) {
    id = `${course.id}-${suffix}`;
    suffix += 1;
  }
  return { ...course, id };
}

function renderCourses() {
  if (courses.length === 0) {
    elements.courseList.innerHTML = `<div class="empty-state">Paste or upload course material to build your dashboard.</div>`;
    return;
  }

  elements.courseList.innerHTML = courses
    .map((course) => {
      const normalizedCourse = normalizeCourseAssignments(course);
      const progress = calculateProgress(normalizedCourse.tasks);
      const theme = colorMap[course.accent] || colorMap.teal;
      const assignmentCount = normalizedCourse.assignments.length;
      const syllabusLabel = normalizedCourse.coursePlan?.syllabusUploaded ? "syllabus saved" : "needs syllabus";
      return `
        <div class="course-entry ${course.id === activeCourseId ? "active" : ""}" style="--course-color: ${theme.color}">
          <button class="course-button ${course.id === activeCourseId ? "active" : ""}" type="button" data-course-id="${course.id}">
            <span class="course-code">${escapeHtml(course.code)}</span>
            <span>${escapeHtml(course.name)}</span>
            <span class="course-meta">${escapeHtml(syllabusLabel)} · ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"} · ${progress.percent}% complete</span>
          </button>
          <button class="course-delete" type="button" data-delete-course-id="${course.id}" aria-label="Delete ${escapeHtml(course.code)}" title="Delete ${escapeHtml(course.code)}">×</button>
        </div>
      `;
    })
    .join("");
}

function renderTermPulse() {
  const allTasks = courses.flatMap((course) => course.tasks);
  const progress = calculateProgress(allTasks);
  const upcoming = courses.reduce((sum, course) => sum + course.deadlines.length, 0);
  elements.upcomingCount.textContent = String(upcoming);
  elements.completedCount.textContent = `${progress.completed}/${progress.total}`;
  elements.miniMap.innerHTML = courses
    .flatMap((course) =>
      course.deadlines.map((deadline, index) => {
        const className = index === 0 ? "is-hot" : index === 1 ? "is-mid" : "is-calm";
        return `<span class="mini-cell ${className}" title="${escapeHtml(course.code)}: ${escapeHtml(deadline.label)}"></span>`;
      })
    )
    .join("");
}

function renderCourseHeader(course) {
  if (!course) {
    elements.courseTitle.textContent = "Create your first course";
    elements.courseSubtitle.textContent = "Paste course material, a schedule, or an assignment page on the left. ClassPilot will extract deadlines, tasks, and topics.";
    elements.courseNotes.textContent = "Your imported course details will appear here.";
    return;
  }

  const normalizedCourse = normalizeCourseAssignments(course);
  const assignmentCount = normalizedCourse.assignments.length;
  const syllabusStatus = normalizedCourse.coursePlan?.syllabusUploaded ? "syllabus saved" : "upload this course's syllabus";
  elements.courseTitle.textContent = `${course.code}: ${course.name}`;
  elements.courseSubtitle.textContent = `${capitalize(syllabusStatus)}. ${assignmentCount} imported assignment${assignmentCount === 1 ? "" : "s"} grouped only in this course. Next deadline: ${course.nextDue} on ${course.dueDate}.`;
  elements.courseNotes.textContent = course.notes;
}

function renderWeekRail(course) {
  if (!course) {
    elements.railNote.textContent = "0 checkpoints";
    elements.weekRail.innerHTML = `<li class="rail-item empty-rail"><span class="rail-title">No deadlines yet</span><span class="rail-type">add course</span></li>`;
    return;
  }

  elements.railNote.textContent = `${course.deadlines.length} checkpoints`;
  elements.weekRail.innerHTML = course.deadlines
    .map(
      (deadline) => `
        <li class="rail-item">
          <span class="rail-date">${escapeHtml(deadline.date)}</span>
          <span class="rail-title">${escapeHtml(deadline.label)}</span>
          <span class="rail-type">${escapeHtml(deadline.type)}</span>
        </li>
      `
    )
    .join("");
}

function renderTasks(course) {
  if (!course) {
    elements.progressOrb.textContent = "0%";
    elements.progressOrb.setAttribute("aria-label", "No tasks yet");
    elements.taskList.innerHTML = `<div class="empty-state light">Tasks extracted from your course material will appear here.</div>`;
    return;
  }

  const normalizedCourse = normalizeCourseAssignments(course);
  const groups = groupAssignmentsByCategory(normalizedCourse.assignments);
  const progress = calculateProgress(normalizedCourse.tasks);
  elements.progressOrb.textContent = `${progress.percent}%`;
  elements.progressOrb.setAttribute(
    "aria-label",
    `${progress.completed} of ${progress.total} tasks completed`
  );

  if (groups.length === 0) {
    elements.taskList.innerHTML = `<div class="empty-state light">This course has syllabus-level information saved. Upload an assignment page once to create assignment tasks under this course.</div>`;
    return;
  }

  elements.taskList.innerHTML = groups
    .map(
      (group) => `
        <section class="assignment-group">
          <h4>${escapeHtml(group.label)}</h4>
          ${group.assignments
            .map(
              (assignment) => `
                <article class="assignment-card">
                  <header>
                    <span class="assignment-kicker">${escapeHtml(assignment.sourceType || "Imported")}</span>
                    <h5>${escapeHtml(assignment.title)}</h5>
                    <p>${escapeHtml(assignment.dueDate || "No date")}${assignment.points ? ` · ${escapeHtml(assignment.points)}` : ""}${assignment.status?.submittedAt ? ` · Submitted ${escapeHtml(assignment.status.submittedAt)}` : ""}</p>
                  </header>
                  ${renderAssignmentInlineSummary(assignment)}
                  <div class="assignment-task-list">
                    ${(assignment.tasks || [])
                      .map(
                        (task) => `
                          <label class="task-row ${task.done ? "is-done" : ""}">
                            <input type="checkbox" data-task-id="${task.id}" ${task.done ? "checked" : ""}>
                            <span>${escapeHtml(task.title)}</span>
                          </label>
                        `
                      )
                      .join("")}
                  </div>
                </article>
              `
            )
            .join("")}
        </section>
      `
    )
    .join("");
}

function renderAssignmentInlineSummary(assignment) {
  const details = assignment.details || {};
  const requirements = details.requirements?.length ? details.requirements.slice(0, 3) : buildFallbackRequirements(assignment).slice(0, 3);
  const steps = details.steps?.length ? details.steps.slice(0, 3) : buildFallbackSteps(assignment).slice(0, 3);

  return `
    <div class="assignment-intel">
      <div>
        <strong>Must include</strong>
        <span>${escapeHtml(requirements.join(" · "))}</span>
      </div>
      <div>
        <strong>Plan</strong>
        <span>${escapeHtml(steps.join(" · "))}</span>
      </div>
    </div>
  `;
}

function renderSourceCheck(course) {
  if (!course) {
    elements.confidencePill.textContent = "Waiting";
    elements.sourceCheckText.textContent = "Import a course first, then ClassPilot can compare tasks, deadlines, and rubric notes.";
    document.querySelector(".source-meter span").style.setProperty("--value", "0%");
    return;
  }

  const openTasks = course.tasks.filter((task) => !task.done).length;
  const priorityTopic = course.weakTopics[0] || "rubric";
  const confidence = Number(course.confidence) || (openTasks <= 1 ? 82 : 68);
  const warnings = Array.isArray(course.warnings) ? course.warnings : [];
  const actionPlan = Array.isArray(course.actionPlan) ? course.actionPlan : [];
  document.querySelector(".source-meter span").style.setProperty("--value", `${Math.max(0, Math.min(99, confidence))}%`);
  elements.confidencePill.textContent = confidence >= 86 ? `High ${confidence}%` : confidence >= 65 ? `Review ${confidence}%` : `Fix ${confidence}%`;
  elements.sourceCheckText.textContent =
    warnings.length > 0
      ? `Needs review: ${warnings.join(" ")} Current risk: ${priorityTopic}.`
      : `Source type: ${course.sourceType || "Course material"}. ${actionPlan[0] || "ClassPilot checked the visible task, deadline, and source fields."}`;
}

function getCoachLabels() {
  if (explanationLanguage === "zh") {
    return {
      assignmentFocus: "当前作业",
      courseFocus: "课程重点",
      mustDo: "必须包含",
      nextSteps: "下一步",
      scoreStrategy: "得分策略",
      writingHelp: "写作开头",
      riskFlags: "风险提醒",
      priorities: "评分权重",
      policyNotes: "课程规则",
      studyFocus: "周计划重点",
      noCourseTitle: "先上传一门课",
      noCourseBody: "上传 syllabus 或作业截图后，ClassPilot 会自动生成作业和课程 coach。",
      noAssignmentTitle: "还没有作业",
      noAssignmentBody: "上传这门课的 Canvas 作业截图或复制文本，coach 会自动拆分要求。"
    };
  }
  return {
    assignmentFocus: "Current Assignment",
    courseFocus: "Course Focus",
    mustDo: "Must include",
    nextSteps: "Next steps",
    scoreStrategy: "Score strategy",
    writingHelp: "Writing starts",
    riskFlags: "Risk checks",
    priorities: "Grade weights",
    policyNotes: "Course rules",
    studyFocus: "Weekly focus",
    noCourseTitle: "Upload a course first",
    noCourseBody: "After a syllabus or assignment screenshot is uploaded, ClassPilot builds the assignment and course coach automatically.",
    noAssignmentTitle: "No assignment yet",
    noAssignmentBody: "Upload this course's Canvas assignment screenshot or copied text to generate requirements and steps."
  };
}

function chooseCoachAssignment(course) {
  const assignments = normalizeCourseAssignments(course).assignments || [];
  return (
    assignments.find((assignment) => assignment.category === "To submit") ||
    assignments.find((assignment) => assignment.category === "Late") ||
    assignments.find((assignment) => assignment.category === "Needs review") ||
    assignments.find((assignment) => assignment.category === "Feedback") ||
    assignments[0] ||
    null
  );
}

function renderCoach(course = getActiveCourse()) {
  const labels = getCoachLabels();
  if (!course) {
    elements.coachOutput.innerHTML = `
      <section class="coach-empty">
        <strong>${escapeHtml(labels.noCourseTitle)}</strong>
        <span>${escapeHtml(labels.noCourseBody)}</span>
      </section>
    `;
    return;
  }

  const normalizedCourse = normalizeCourseAssignments(course);
  const focusAssignment = chooseCoachAssignment(normalizedCourse);
  const courseCoach = buildCourseCoach(normalizedCourse, explanationLanguage);
  const assignmentCoach = focusAssignment ? buildAssignmentCoach(normalizedCourse, focusAssignment, explanationLanguage) : null;

  elements.coachOutput.innerHTML = `
    ${
      assignmentCoach
        ? renderAssignmentCoach(assignmentCoach, labels)
        : `<section class="coach-empty"><strong>${escapeHtml(labels.noAssignmentTitle)}</strong><span>${escapeHtml(labels.noAssignmentBody)}</span></section>`
    }
    ${renderCourseCoach(courseCoach, labels)}
  `;
}

function renderAssignmentCoach(coach, labels) {
  return `
    <section class="coach-section coach-section-primary">
      <header>
        <span>${escapeHtml(labels.assignmentFocus)}</span>
        <h4>${escapeHtml(coach.title)}</h4>
        <p>${escapeHtml(coach.summary)}</p>
      </header>
      <div class="coach-grid">
        ${renderCoachList(labels.mustDo, coach.mustDo)}
        ${renderCoachList(labels.nextSteps, coach.nextSteps, "ol")}
        ${renderCoachList(labels.scoreStrategy, coach.scoreStrategy)}
        ${renderCoachList(labels.writingHelp, coach.writingHelp)}
        ${renderCoachList(labels.riskFlags, coach.riskFlags)}
      </div>
    </section>
  `;
}

function renderCourseCoach(coach, labels) {
  return `
    <section class="coach-section">
      <header>
        <span>${escapeHtml(labels.courseFocus)}</span>
        <h4>${escapeHtml(coach.title)}</h4>
        <p>${escapeHtml(coach.summary)}</p>
      </header>
      <div class="coach-grid">
        ${renderCoachList(labels.priorities, coach.priorities)}
        ${renderCoachList(labels.policyNotes, coach.policyNotes)}
        ${renderCoachList(labels.studyFocus, coach.studyFocus)}
      </div>
    </section>
  `;
}

function renderCoachList(title, items, listTag = "ul") {
  const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 6) : [];
  const tag = listTag === "ol" ? "ol" : "ul";
  return `
    <section class="coach-list-block">
      <h5>${escapeHtml(title)}</h5>
      ${
        values.length
          ? `<${tag}>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`
          : `<p>${escapeHtml(explanationLanguage === "zh" ? "还没有识别到这一项。" : "Nothing detected yet.")}</p>`
      }
    </section>
  `;
}

function renderCourseDirectory(course) {
  if (!course) {
    elements.syllabusResult.innerHTML = `
      <div class="directory-empty">
        <strong>Upload each course syllabus separately.</strong>
        <span>Every course gets its own directory for instructor details, grading, policies, weekly guide, exams, and deadlines.</span>
      </div>
    `;
    return;
  }

  const normalizedCourse = normalizeCourseAssignments(course);
  const plan = normalizedCourse.coursePlan || {};
  const deadlines = Array.isArray(plan.deadlines) && plan.deadlines.length ? plan.deadlines : normalizedCourse.deadlines;
  const exams = Array.isArray(plan.exams) ? plan.exams : [];
  const topics = Array.isArray(plan.topics) ? plan.topics : [];
  const grading = Array.isArray(plan.grading) ? plan.grading : [];
  const weeklyGuide = Array.isArray(plan.weeklyGuide) ? plan.weeklyGuide : [];
  const policies = Array.isArray(plan.policies) ? plan.policies : [];
  const requirements = Array.isArray(plan.courseRequirements) ? plan.courseRequirements : [];
  const syllabusStatus = plan.syllabusUploaded ? "Syllabus uploaded" : "Syllabus needed";

  elements.syllabusResult.innerHTML = `
    <div class="directory-summary ${plan.syllabusUploaded ? "is-ready" : "is-needed"}">
      <strong>${escapeHtml(syllabusStatus)} for ${escapeHtml(normalizedCourse.code)}</strong>
      <span>${escapeHtml(
        plan.syllabusUploaded
          ? "This syllabus belongs only to the selected course. Other courses need their own syllabus upload."
          : "Upload this course's syllabus once to unlock course-level planning."
      )}</span>
    </div>
    ${renderCourseInfoPanel(plan)}
    ${renderCourseDirectoryUpload(normalizedCourse)}
    <div class="directory-grid">
      ${renderDirectoryBlock("Course deadlines", deadlines, (item) => `${item.label} · ${item.date} · ${item.type}`)}
      ${renderDirectoryBlock("Exams", exams, (item) => `${item.label} · ${item.date}`)}
      ${renderDirectoryBlock("Topics", topics)}
      ${renderDirectoryBlock("Course requirements", requirements)}
      ${renderGradingBlock(grading)}
      ${renderPolicyBlock(policies)}
    </div>
    ${renderWeeklyGuide(weeklyGuide)}
  `;
}

function renderCourseDirectoryUpload(course) {
  return `
    <form class="directory-upload" id="directoryImportForm">
      <div class="directory-upload-head">
        <div>
          <strong>Upload into ${escapeHtml(course.code)}</strong>
          <span>Files added here stay inside ${escapeHtml(course.name)} even if Canvas text is incomplete or noisy.</span>
        </div>
      </div>
      <label>
        Paste this course's syllabus or assignment text
        <textarea id="directoryMaterial" rows="4" placeholder="Paste a syllabus update, Canvas assignment page, copied due-date text, or OCR text for ${escapeHtml(course.code)}."></textarea>
      </label>
      <div class="directory-upload-actions">
        <label class="directory-file-action">
          Choose file or screenshot
          <input type="file" id="directoryFile" accept=".txt,.md,.csv,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp">
        </label>
        <button type="submit" class="secondary-action">Upload to ${escapeHtml(course.code)}</button>
      </div>
    </form>
  `;
}

function renderCourseInfoPanel(plan) {
  const fields = [
    ["Term", plan.term],
    ["Professor", plan.professor],
    ["Credits", plan.credits],
    ["Section", plan.section],
    ["Modality", plan.modality],
    ["Meeting", plan.meetingLocation],
    ["Office hours", plan.officeHours],
    ["Email", plan.email]
  ].filter(([, value]) => value);

  if (fields.length === 0) {
    return `
      <div class="course-info-grid">
        <div class="course-info-item">
          <span>Course profile</span>
          <strong>Waiting for syllabus details</strong>
        </div>
      </div>
    `;
  }

  return `
    <div class="course-info-grid">
      ${fields
        .map(
          ([label, value]) => `
            <div class="course-info-item">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDirectoryBlock(title, items, formatter = (item) => item) {
  const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 6) : [];
  return `
    <section class="directory-block">
      <h4>${escapeHtml(title)}</h4>
      ${
        values.length
          ? `<ul>${values.map((item) => `<li>${escapeHtml(formatter(item))}</li>`).join("")}</ul>`
          : `<p>No ${escapeHtml(title.toLowerCase())} found yet.</p>`
      }
    </section>
  `;
}

function renderGradingBlock(items) {
  const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
  return `
    <section class="directory-block">
      <h4>Grading weights</h4>
      ${
        values.length
          ? `<ul>${values.map((item) => `<li>${escapeHtml(item.label)} · ${escapeHtml(item.weight)}</li>`).join("")}</ul>`
          : `<p>No grading weights found yet.</p>`
      }
    </section>
  `;
}

function renderPolicyBlock(items) {
  const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 4) : [];
  return `
    <section class="directory-block">
      <h4>Policies</h4>
      ${
        values.length
          ? `<ul>${values.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.text)}</li>`).join("")}</ul>`
          : `<p>No course policies found yet.</p>`
      }
    </section>
  `;
}

function renderWeeklyGuide(items) {
  const weeks = Array.isArray(items) ? items.filter(Boolean).slice(0, 16) : [];
  if (weeks.length === 0) return "";

  return `
    <section class="weekly-guide">
      <div class="weekly-guide-head">
        <span class="section-label">Weekly Guide</span>
        <strong>${weeks.length} weeks from this syllabus</strong>
      </div>
      <div class="weekly-grid">
        ${weeks
          .map(
            (week) => `
              <article class="week-card">
                <span>${escapeHtml(week.week)}</span>
                <h4>${escapeHtml(week.topic || "Course work")}</h4>
                ${renderInlineChips("Assignments", week.assignments)}
                ${renderInlineChips("Resources", week.resources)}
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderInlineChips(label, values = []) {
  const items = Array.isArray(values) ? values.filter(Boolean).slice(0, 4) : [];
  if (items.length === 0) return "";
  return `
    <div class="inline-chip-group">
      <strong>${escapeHtml(label)}</strong>
      <div>${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </div>
  `;
}

function renderAssignmentWorkplans(course) {
  if (!course) {
    elements.breakdownResult.innerHTML = `
      <div class="workplan-empty">
        <strong>Upload an assignment page or prompt.</strong>
        <span>ClassPilot will extract requirements, deliverables, rubric signals, and a step-by-step plan from that single upload.</span>
      </div>
    `;
    return;
  }

  const assignments = normalizeCourseAssignments(course).assignments || [];
  if (assignments.length === 0) {
    elements.breakdownResult.innerHTML = `
      <div class="workplan-empty">
        <strong>No assignments in this course yet.</strong>
        <span>The syllabus is saved in the course directory. Upload each assignment page once when you receive it.</span>
      </div>
    `;
    return;
  }

  elements.breakdownResult.innerHTML = assignments
    .map((assignment) => renderAssignmentWorkplanCard(assignment))
    .join("");
}

function renderAssignmentWorkplanCard(assignment) {
  const details = assignment.details || {};
  const requirements = details.requirements?.length ? details.requirements : buildFallbackRequirements(assignment);
  const steps = details.steps?.length ? details.steps : buildFallbackSteps(assignment);
  const deliverables = details.deliverables || [];
  const rubric = details.rubric || [];
  const overview = details.overview || "ClassPilot built this plan from the uploaded assignment material.";

  return `
    <article class="workplan-card">
      <header>
        <span>${escapeHtml(assignment.sourceType || "Assignment")}</span>
        <h4>${escapeHtml(assignment.title)}</h4>
        <p>${escapeHtml(overview)}</p>
      </header>
      <div class="workplan-columns">
        ${renderWorkplanList("Must include", requirements)}
        ${renderWorkplanList("How to finish", steps, "ol")}
        ${renderWorkplanList("Deliverables", deliverables)}
        ${renderRubricList(rubric)}
      </div>
    </article>
  `;
}

function renderWorkplanList(title, items, listTag = "ul") {
  const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
  const tag = listTag === "ol" ? "ol" : "ul";
  return `
    <section class="workplan-block">
      <h5>${escapeHtml(title)}</h5>
      ${
        values.length
          ? `<${tag}>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`
          : `<p>Nothing specific found yet.</p>`
      }
    </section>
  `;
}

function renderRubricList(rubric) {
  const values = Array.isArray(rubric) ? rubric.filter(Boolean).slice(0, 6) : [];
  return `
    <section class="workplan-block">
      <h5>Rubric signals</h5>
      ${
        values.length
          ? `<ul>${values
              .map((item) => `<li><strong>${escapeHtml(item.label)} ${escapeHtml(item.weight || "")}</strong>${item.description ? `: ${escapeHtml(item.description)}` : ""}</li>`)
              .join("")}</ul>`
          : `<p>No explicit rubric detected.</p>`
      }
    </section>
  `;
}

function buildFallbackRequirements(assignment) {
  const requirements = [];
  if (assignment.dueDate && assignment.dueDate !== "No date") requirements.push(`Due ${assignment.dueDate}`);
  if (assignment.points) requirements.push(assignment.points);
  if (assignment.status?.submittedAt) requirements.push(`Submitted on ${assignment.status.submittedAt}`);
  if (assignment.status?.nextUp) requirements.push(`Next up: ${assignment.status.nextUp}`);
  return requirements.length ? requirements : ["Review the uploaded prompt and confirm the final submission format."];
}

function buildFallbackSteps(assignment) {
  const taskTitles = (assignment.tasks || []).map((task) => task.title).filter(Boolean);
  if (taskTitles.length) return taskTitles;
  return ["Read the prompt", "Identify deliverables", "Draft the response", "Check the rubric before submitting"];
}

function renderExamPlanner(course) {
  if (!course) {
    elements.studyPlan.innerHTML = `
      <div class="planner-empty">
        <strong>No course selected.</strong>
        <span>Upload one syllabus for each course. Exam planning appears only inside that course.</span>
      </div>
    `;
    return;
  }

  const plan = normalizeCourseAssignments(course).coursePlan || {};
  const exams = Array.isArray(plan.exams) ? plan.exams : [];
  if (!plan.syllabusUploaded) {
    elements.studyPlan.innerHTML = `
      <div class="planner-empty">
        <strong>Upload this course's syllabus for exam planning.</strong>
        <span>Exam dates are course-level information, so they stay separate for every course.</span>
      </div>
    `;
    return;
  }

  if (exams.length === 0) {
    elements.studyPlan.innerHTML = `
      <div class="planner-empty">
        <strong>No exams found in this course's syllabus.</strong>
        <span>Course-level deadlines and weekly work still appear in the directory above.</span>
      </div>
    `;
    return;
  }

  elements.studyPlan.innerHTML = exams
    .map(
      (exam) => `
        <article class="exam-plan">
          <header>
            <strong>${escapeHtml(exam.label)}</strong>
            <span>${escapeHtml(exam.date)}</span>
          </header>
          <ol>
            <li>Collect lecture topics and weak areas for this exam.</li>
            <li>Build one review sheet from syllabus topics and class notes.</li>
            <li>Practice problems or sample questions before the exam date.</li>
          </ol>
        </article>
      `
    )
    .join("");
}

function capitalize(value) {
  return String(value)
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function showStatus(message, tone = "info") {
  elements.appStatus.textContent = message;
  elements.appStatus.className = `app-status is-${tone}`;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown size";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCurrentActionAvailability() {
  return getActionAvailability({
    hasCourse: Boolean(getActiveCourse()),
    material: elements.courseMaterial.value,
    deadlineCount: 0,
    taskTitle: elements.taskTitle.value,
    courseCount: courses.length
  });
}

function setButtonState(button, state) {
  button.disabled = !state.enabled;
  button.setAttribute("aria-disabled", String(!state.enabled));
  button.title = state.message;
}

function refreshActionStates() {
  const state = getCurrentActionAvailability();
  setButtonState(
    elements.buildCourseButton,
    importIsBusy ? { enabled: false, message: "Reading the uploaded file." } : state.buildCourse
  );
  setButtonState(elements.addTaskButton, state.addTask);
  setButtonState(elements.deleteCourse, state.deleteCourse);
  setButtonState(elements.clearCourses, state.clearData);
  elements.courseFile.disabled = importIsBusy;
  elements.buildCourseButton.textContent = pendingImportDraft ? "Save reviewed course" : "Build course";
}

function setImportBusy(isBusy) {
  importIsBusy = isBusy;
  refreshActionStates();
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("File could not be read.")));
    reader.readAsText(file);
  });
}

function showScreenshotPreview(file) {
  if (screenshotPreviewUrl) {
    URL.revokeObjectURL(screenshotPreviewUrl);
  }
  screenshotPreviewUrl = URL.createObjectURL(file);
  elements.screenshotPreview.src = screenshotPreviewUrl;
  elements.screenshotPreviewCard.hidden = false;
  elements.screenshotPreviewMeta.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  elements.screenshotOcrProgress.textContent = "Queued";
}

function updateScreenshotProgress(message) {
  elements.screenshotOcrProgress.textContent = message;
}

function waitForScreenshotOcr(timeoutMs = 8000) {
  if (window.Tesseract?.recognize) return Promise.resolve(true);
  const script = document.querySelector("[data-ocr-script]");
  if (!script) return Promise.resolve(false);
  updateScreenshotProgress("Loading OCR engine");

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Boolean(window.Tesseract?.recognize));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

function getOcrAssetUrl(filename = "") {
  return new URL(`vendor/tesseract/${filename}`, window.location.href).href;
}

function getOcrLangPath() {
  return new URL("vendor/tesseract", window.location.href).href;
}

function renderSmartReadout(draft) {
  const evidence = Array.isArray(draft.evidence) ? draft.evidence : [];
  const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  const actionPlan = Array.isArray(draft.actionPlan) ? draft.actionPlan : [];
  const confidence = Number(draft.confidence) || 0;
  const tone = confidence >= 86 ? "high" : confidence >= 65 ? "mid" : "low";
  const evidenceMarkup = evidence.length
    ? evidence
        .map(
          (item) => `
            <span class="evidence-chip" title="${escapeHtml(item.source)}">
              <strong>${escapeHtml(item.label)}</strong>
              ${escapeHtml(item.value)}
            </span>
          `
        )
        .join("")
    : `<span class="review-warning">No strong evidence found yet.</span>`;
  const warningMarkup = warnings.length
    ? `<ul class="review-warnings">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : `<p class="review-ok">No obvious missing fields detected.</p>`;
  const planMarkup = actionPlan.length
    ? `<ol class="review-plan">${actionPlan.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
    : "";

  elements.reviewSmartReadout.innerHTML = `
    <div class="smart-score is-${tone}">
      <span>${escapeHtml(draft.sourceType || "Course material")}</span>
      <strong>${confidence}%</strong>
      <span>${escapeHtml(draft.confidenceLabel || "Needs review")}</span>
    </div>
    <div class="evidence-list">${evidenceMarkup}</div>
    ${warningMarkup}
    ${planMarkup}
  `;
}

function renderImportReview(draft) {
  pendingImportDraft = draft;
  elements.importReviewCard.hidden = false;
  renderSmartReadout(draft);
  elements.reviewCourseCode.value = draft.code || "";
  elements.reviewCourseName.value = draft.name || "";
  elements.reviewAssignment.value = draft.assignment || "";
  elements.reviewDueDate.value = draft.dueDate || "";
  elements.reviewPoints.value = draft.points || "";
  elements.reviewLinks.value = draft.linksText || "";
  elements.reviewTasks.value = draft.tasksText || "";
  elements.reviewRawText.value = draft.rawText || "";
  elements.importReviewCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  refreshActionStates();
}

function clearImportReview() {
  pendingImportDraft = null;
  elements.importReviewCard.hidden = true;
  elements.reviewCourseCode.value = "";
  elements.reviewCourseName.value = "";
  elements.reviewAssignment.value = "";
  elements.reviewDueDate.value = "";
  elements.reviewPoints.value = "";
  elements.reviewLinks.value = "";
  elements.reviewTasks.value = "";
  elements.reviewRawText.value = "";
  elements.reviewSmartReadout.innerHTML = "";
  refreshActionStates();
}

function getReviewDraft() {
  const code = elements.reviewCourseCode.value;
  const name = elements.reviewCourseName.value;
  const warnings = (pendingImportDraft?.warnings || []).filter((warning) => {
    if (code.trim() && warning.includes("Course code")) return false;
    if (name.trim() && warning.includes("Course name")) return false;
    return true;
  });

  return {
    ...(pendingImportDraft || {}),
    code,
    name,
    assignment: elements.reviewAssignment.value,
    dueDate: elements.reviewDueDate.value,
    points: elements.reviewPoints.value,
    linksText: elements.reviewLinks.value,
    tasksText: elements.reviewTasks.value,
    rawText: elements.reviewRawText.value,
    warnings
  };
}

async function readScreenshotText(file) {
  showScreenshotPreview(file);

  const ocrReady = await waitForScreenshotOcr();
  if (!ocrReady) {
    throw new Error("Screenshot OCR is not available. Check your internet connection, then reload the page and try again.");
  }

  const result = await window.Tesseract.recognize(
    file,
    "eng",
    {
      workerPath: getOcrAssetUrl("worker.min.js"),
      corePath: getOcrAssetUrl("tesseract-core.wasm.js"),
      langPath: getOcrLangPath(),
      logger(event) {
        if (!event.status) return;
        const percent = typeof event.progress === "number" ? ` ${Math.round(event.progress * 100)}%` : "";
        updateScreenshotProgress(`${capitalize(event.status)}${percent}`);
      }
    }
  );

  return String(result?.data?.text || "").trim();
}

async function importScreenshotFile(file, options = {}) {
  setImportBusy(true);
  showStatus(`Reading screenshot ${file.name}. This can take a moment the first time.`, "info");

  try {
    const text = await readScreenshotText(file);
    if (!text) {
      showStatus("No readable text was found in that screenshot. Try a clearer crop or paste the text manually.", "warn");
      updateScreenshotProgress("No readable text found");
      return;
    }

    elements.courseMaterial.value = text;
    const draft = draftFromImportSource(text, file.name, options);
    if (shouldAutoSaveDraft(draft)) {
      saveCourseFromDraft(draft);
      updateScreenshotProgress(`${draft.sourceType} · auto-saved`);
      return;
    }

    renderImportReview(draft);
    updateScreenshotProgress(`${draft.sourceType} · ${draft.confidence}% confidence`);
    showStatus(
      draft.warnings?.length
        ? "Screenshot text extracted, but some fields need correction before saving."
        : options.bindToActiveCourse
          ? `Screenshot text extracted for ${draft.code}. Review once, then save.`
          : "Screenshot text extracted with high confidence. Review once, then save.",
      draft.warnings?.length ? "warn" : "success"
    );
  } catch (error) {
    updateScreenshotProgress("OCR unavailable");
    showStatus(error.message, "warn");
  } finally {
    setImportBusy(false);
  }
}

function renderAll() {
  const course = getActiveCourse();
  setCourseTheme(course);
  renderCourses();
  renderTermPulse();
  renderCourseHeader(course);
  renderWeekRail(course);
  renderTasks(course);
  renderSourceCheck(course);
  renderCourseDirectory(course);
  renderAssignmentWorkplans(course);
  renderExamPlanner(course);
  renderCoach(course);
  refreshActionStates();
}

function draftHasRequiredFields(draft) {
  if (draft.sourceType === "Syllabus or schedule") {
    return Boolean(draft.code?.trim() && draft.name?.trim());
  }
  return Boolean(draft.code?.trim() && draft.name?.trim() && draft.assignment?.trim() && draft.dueDate?.trim());
}

function shouldAutoSaveDraft(draft) {
  return draftHasRequiredFields(draft) && Number(draft.confidence) >= 86 && (!draft.warnings || draft.warnings.length === 0);
}

function saveCourseFromDraft(draft, message = "") {
  const result = upsertCourseFromDraft(courses, draft, activeCourseId);
  if (result.action === "needs-course") {
    showStatus(result.message, "warn");
    renderImportReview(draft);
    return null;
  }

  courses = result.courses;
  activeCourseId = result.activeCourseId;
  saveCourses();
  elements.courseImportForm.reset();
  clearImportReview();
  renderAll();
  const actionMessage =
    result.action === "course-created" || result.action === "course-updated"
      ? `Course directory saved for ${result.course.code}: ${result.course.name}.`
      : `${result.action === "merged" ? "Added to" : "Created"} ${result.course.code}: ${result.course.name} · ${result.assignment.title}.`;
  showStatus(message || actionMessage, "success");
  return result.course;
}

function draftFromImportSource(source, filename = "", options = {}) {
  const rawDraft = createCourseDraftFromMaterial(source, filename);
  if (options.bindToActiveCourse) {
    return bindDraftToCourse(rawDraft, getActiveCourse());
  }
  return applyCourseContextToDraft(rawDraft, getActiveCourse());
}

function importCourseFromMaterial(material, filename = "", options = {}) {
  const source = String(material || "").trim();
  if (!source) {
    showStatus(
      options.bindToActiveCourse
        ? "Paste text or choose a file inside this course directory first."
        : getCurrentActionAvailability().buildCourse.message,
      "warn"
    );
    refreshActionStates();
    return null;
  }

  const draft = draftFromImportSource(source, filename, options);
  if (shouldAutoSaveDraft(draft)) {
    return saveCourseFromDraft(draft);
  }

  renderImportReview(draft);
  showStatus(
    options.bindToActiveCourse
      ? `ClassPilot prepared this upload for ${draft.code}. Review once before saving.`
      : "ClassPilot prepared a smart extraction, but it needs review before saving.",
    "warn"
  );
  return null;
}

function importCourseFromReviewedDraft() {
  if (!pendingImportDraft) return importCourseFromMaterial(elements.courseMaterial.value);

  const draft = getReviewDraft();
  const isCourseLevel = draft.sourceType === "Syllabus or schedule";
  if (!draft.code.trim() || !draft.name.trim() || (!isCourseLevel && (!draft.assignment.trim() || !draft.dueDate.trim()))) {
    showStatus(
      isCourseLevel
        ? "Review the course code and course name before saving the syllabus."
        : "Review the course code, course name, assignment, and due date before saving.",
      "warn"
    );
    return null;
  }

  return saveCourseFromDraft(
    draft,
    isCourseLevel ? `Saved syllabus directory: ${draft.code}: ${draft.name}.` : `Saved reviewed assignment: ${draft.code}: ${draft.name} · ${draft.assignment}.`
  );
}

function addTaskFromForm() {
  const course = getActiveCourse();
  const state = getCurrentActionAvailability();
  if (!state.addTask.enabled) {
    showStatus(state.addTask.message, "warn");
    refreshActionStates();
    return;
  }

  const updatedCourse = addTaskToCourse(course, elements.taskTitle.value);
  courses = courses.map((item) => (item.id === updatedCourse.id ? updatedCourse : item));
  saveCourses();
  elements.taskForm.reset();
  renderAll();
  showStatus("Task added to the selected course.", "success");
}

function deleteActiveCourse() {
  const course = getActiveCourse();
  const state = getCurrentActionAvailability();
  if (!course || !state.deleteCourse.enabled) {
    showStatus(state.deleteCourse.message, "warn");
    refreshActionStates();
    return;
  }

  deleteCourseById(course.id);
}

function deleteCourseById(courseId) {
  const course = courses.find((item) => item.id === courseId);
  if (!course) {
    showStatus("That course was already removed.", "warn");
    renderAll();
    return;
  }

  const result = removeCourseById(courses, course.id, activeCourseId);
  courses = result.courses;
  activeCourseId = result.activeCourseId;
  saveCourses();
  renderAll();
  showStatus(`${course.code}: ${course.name} was deleted.`, "success");
}

elements.courseList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-course-id]");
  if (deleteButton) {
    deleteCourseById(deleteButton.dataset.deleteCourseId);
    return;
  }

  const button = event.target.closest("[data-course-id]");
  if (!button) return;
  activeCourseId = button.dataset.courseId;
  renderAll();
  const course = getActiveCourse();
  if (course) {
    showStatus(`Viewing ${course.code}: ${course.name}.`, "info");
  }
});

elements.taskList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-task-id]");
  if (!checkbox) return;
  const course = getActiveCourse();
  if (!course) return;
  const task = course.tasks.find((item) => item.id === checkbox.dataset.taskId);
  if (task) {
    task.done = checkbox.checked;
    (course.assignments || []).forEach((assignment) => {
      (assignment.tasks || []).forEach((assignmentTask) => {
        if (assignmentTask.id === checkbox.dataset.taskId) {
          assignmentTask.done = checkbox.checked;
        }
      });
    });
    saveCourses();
    renderTasks(course);
    renderCourses();
    renderTermPulse();
    renderSourceCheck(course);
  }
});

elements.courseImportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  importCourseFromReviewedDraft();
});

elements.courseMaterial.addEventListener("input", refreshActionStates);

elements.syllabusResult.addEventListener("submit", (event) => {
  const form = event.target.closest("#directoryImportForm");
  if (!form) return;
  event.preventDefault();
  const material = form.querySelector("#directoryMaterial")?.value || "";
  importCourseFromMaterial(material, "", { bindToActiveCourse: true });
});

elements.syllabusResult.addEventListener("change", async (event) => {
  const input = event.target.closest("#directoryFile");
  if (!input) return;
  const file = input.files?.[0];
  if (!file) return;
  const fileKind = getCourseImportFileKind(file);
  showStatus(`Selected ${file.name} for ${getActiveCourse()?.code || "this course"}. Reading it now.`, "info");

  try {
    if (fileKind === "image") {
      await importScreenshotFile(file, { bindToActiveCourse: true });
      return;
    }

    if (fileKind !== "text") {
      showStatus("Unsupported file. Upload a .txt, .md, .csv, .png, .jpg, or .webp file.", "warn");
      return;
    }

    try {
      setImportBusy(true);
      const text = await readFileAsText(file);
      const material = input.closest("#directoryImportForm")?.querySelector("#directoryMaterial");
      if (material) material.value = text;
      showStatus(`Read ${file.name}. Saving it inside ${getActiveCourse()?.code || "the selected course"}.`, "info");
      importCourseFromMaterial(text, file.name, { bindToActiveCourse: true });
    } catch (error) {
      showStatus(error.message, "warn");
    } finally {
      setImportBusy(false);
    }
  } finally {
    input.value = "";
  }
});

elements.courseFile.addEventListener("change", async () => {
  const file = elements.courseFile.files?.[0];
  if (!file) return;
  const fileKind = getCourseImportFileKind(file);
  showStatus(`Selected ${file.name}. Reading it now.`, "info");

  try {
    if (fileKind === "image") {
      await importScreenshotFile(file);
      return;
    }

    if (fileKind !== "text") {
      showStatus("Unsupported file. Upload a .txt, .md, .csv, .png, .jpg, or .webp file.", "warn");
      return;
    }

    try {
      setImportBusy(true);
      const text = await readFileAsText(file);
      elements.courseMaterial.value = text;
      showStatus(`Read ${file.name}. Extracting course and assignment details.`, "info");
      importCourseFromMaterial(text, file.name);
    } catch (error) {
      showStatus(error.message, "warn");
    } finally {
      setImportBusy(false);
    }
  } finally {
    elements.courseFile.value = "";
  }
});

elements.saveReviewCourse.addEventListener("click", () => {
  importCourseFromReviewedDraft();
});

elements.discardReviewCourse.addEventListener("click", () => {
  clearImportReview();
  showStatus("Screenshot review discarded. Upload another screenshot or paste text to continue.", "info");
});

elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addTaskFromForm();
});

elements.taskTitle.addEventListener("input", refreshActionStates);

document.querySelector(".segmented").addEventListener("click", (event) => {
  const button = event.target.closest("[data-language]");
  if (!button) return;
  explanationLanguage = button.dataset.language;
  document
    .querySelectorAll("[data-language]")
    .forEach((item) => item.classList.toggle("active", item === button));
  renderCoach(getActiveCourse());
});

elements.deleteCourse.addEventListener("click", () => {
  deleteActiveCourse();
});

elements.clearCourses.addEventListener("click", () => {
  const state = getCurrentActionAvailability();
  if (!state.clearData.enabled) {
    showStatus(state.clearData.message, "warn");
    refreshActionStates();
    return;
  }
  courses = [];
  activeCourseId = "";
  saveCourses();
  renderAll();
  showStatus("All saved course data was cleared.", "success");
});

renderAll();
