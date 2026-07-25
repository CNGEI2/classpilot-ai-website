const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addTaskToCourse,
  analyzeSyllabus,
  applyCourseContextToDraft,
  bindDraftToCourse,
  buildAssignmentBreakdown,
  buildAssignmentCoach,
  buildCourseCoach,
  buildStudyPlan,
  calculateProgress,
  createAssignmentFromDraft,
  createCourseDraftFromMaterial,
  createCourseFromDraft,
  createCourseFromMaterial,
  createCourseFromInput,
  groupAssignmentsByCategory,
  getCourseImportFileKind,
  hasMeaningfulScore,
  mergeCourseDeadlines,
  removeCourseById,
  upsertCourseFromDraft,
  getActionAvailability,
  getBilingualExplanation,
} = require("../logic.js");

test("calculateProgress returns completed and percent values", () => {
  const progress = calculateProgress([
    { done: true },
    { done: false },
    { done: true },
    { done: false }
  ]);

  assert.deepEqual(progress, { completed: 2, total: 4, percent: 50 });
});

test("analyzeSyllabus extracts dated deadlines from course text", () => {
  const result = analyzeSyllabus(
    "Week 3: Quiz 1 due Aug 12. Final project proposal due September 4. Final exam on Dec 10.",
    { now: new Date("2026-07-20T12:00:00-07:00") }
  );

  assert.equal(result.deadlines.length, 3);
  assert.equal(result.deadlines[0].label, "Quiz 1");
  assert.equal(result.deadlines[1].date, "Sep 4, 2026");
  assert.match(result.summary, /3 academic checkpoints/);
});

test("analyzeSyllabus extracts assignment page due-date labels from nearby title text", () => {
  const result = analyzeSyllabus(`
    Project 1: AI Study App Website
    Due Date: Sunday, July 28, 2026 at 11:59 PM
    Submit your website link and reflection.
  `);

  assert.equal(result.deadlines.length, 1);
  assert.equal(result.deadlines[0].label, "Project 1: AI Study App Website");
  assert.equal(result.deadlines[0].date, "Sun Jul 28, 2026, 11:59 PM");
});

test("analyzeSyllabus extracts numeric due dates", () => {
  const result = analyzeSyllabus(`
    Homework 4
    Due: 08/15/2026 11:59 PM
  `);

  assert.equal(result.deadlines.length, 1);
  assert.equal(result.deadlines[0].label, "Homework 4");
  assert.equal(result.deadlines[0].date, "Aug 15, 2026, 11:59 PM");
});

test("analyzeSyllabus rejects overflowing numeric dates and accepts leap day", () => {
  const analysis = analyzeSyllabus(`
    Impossible paper due 02/31/2026
    Invalid month project due 13/01/2026
    Leap day reflection due 02/29/2024
  `);

  assert.deepEqual(analysis.deadlines, [{
    label: "Leap day reflection",
    date: "Feb 29, 2024",
    type: "assignment"
  }]);
});

test("analyzeSyllabus reports invalid and ambiguous explicit date candidates", () => {
  const analysis = analyzeSyllabus(`
    Impossible paper due 02/31/2026
    Invalid month project due 13/01/2026
    Ambiguous final exam due 03/04
    Leap day reflection due 02/29/2024
  `);

  assert.deepEqual(analysis.deadlines, [{
    label: "Leap day reflection",
    date: "Feb 29, 2024",
    type: "assignment"
  }]);
  assert.deepEqual(
    analysis.dateIssues.map(({ kind, label, value }) => ({
      kind,
      label,
      value
    })),
    [
      {
        kind: "invalid",
        label: "Impossible paper",
        value: "02/31/2026"
      },
      {
        kind: "invalid",
        label: "Invalid month project",
        value: "13/01/2026"
      },
      {
        kind: "ambiguous",
        label: "Ambiguous final exam",
        value: "03/04"
      }
    ]
  );
});

test("analyzeSyllabus validates AM/PM and 24-hour deadline times", () => {
  const valid = analyzeSyllabus(`
    Midnight exam due Dec 10, 2026 at 12:00 AM
    Noon presentation due Dec 11, 2026 at 12:00 PM
    Night paper due Dec 12, 2026 at 23:59
  `);
  const validDates = Object.fromEntries(
    valid.deadlines.map((deadline) => [deadline.label, deadline.date])
  );

  assert.equal(validDates["Midnight exam"], "Dec 10, 2026, 12:00 AM");
  assert.equal(validDates["Noon presentation"], "Dec 11, 2026, 12:00 PM");
  assert.equal(validDates["Night paper"], "Dec 12, 2026, 23:59");
  assert.deepEqual(valid.dateIssues, []);

  for (const time of [
    "0:30 AM",
    "13:00 PM",
    "12:60 PM",
    "24:00",
    "23:60"
  ]) {
    const invalid = analyzeSyllabus(
      `Final exam due Dec 10, 2026 at ${time}`
    );
    assert.ok(
      invalid.dateIssues.some((issue) =>
        issue.kind === "invalid" && issue.value.includes(time)
      ),
      `Expected ${time} to require review.`
    );
  }
});

test("yearless English deadlines persist a course year or fixed current academic year", () => {
  const now = new Date("2026-07-20T12:00:00-07:00");
  const currentYearDraft = createCourseDraftFromMaterial(`
    CS777 Browser QA
    Literal Day
    Due: Jul 25 11:59 PM
    Read the prompt
  `, "browser-qa.txt", { now });
  const courseYearDraft = createCourseDraftFromMaterial(`
    FALL 2027 CS778 - A > Assignments > Future Lab
    Future Lab
    Due: Sep 10 8:30 AM
    Submit the lab
  `, "future-lab.txt", { now });
  const nextTermDraft = createCourseDraftFromMaterial(`
    CS779 Academic Year
    Winter checkpoint
    Due: Jan 25 9:00 AM
    Submit the checkpoint
  `, "winter-checkpoint.txt", { now });

  assert.equal(
    currentYearDraft.dueDate,
    "Jul 25, 2026, 11:59 PM"
  );
  assert.equal(
    createAssignmentFromDraft(currentYearDraft, "cs777").dueDate,
    "Jul 25, 2026, 11:59 PM"
  );
  assert.equal(courseYearDraft.dueDate, "Sep 10, 2027, 8:30 AM");
  assert.equal(nextTermDraft.dueDate, "Jan 25, 2027, 9:00 AM");
});

test("academic year ranges choose a controlled endpoint for yearless deadlines", () => {
  const now = new Date("2026-07-20T12:00:00-07:00");
  for (const separator of ["-", "–", "—", " "]) {
    const draft = createCourseDraftFromMaterial(`
      Academic Year 2026${separator}2027 CS779 > Assignments > Winter checkpoint
      Winter checkpoint
      Due: Jan 25 9:00 AM
      Submit the checkpoint
    `, "winter-checkpoint.txt", { now });
    assert.equal(
      draft.dueDate,
      "Jan 25, 2027, 9:00 AM",
      `separator ${JSON.stringify(separator)}`
    );
    assert.equal(
      createAssignmentFromDraft(draft, "cs779").dueDate,
      "Jan 25, 2027, 9:00 AM"
    );
  }

  const fallDraft = createCourseDraftFromMaterial(`
    Academic Year 2026-2027 CS779 > Assignments > Fall checkpoint
    Fall checkpoint
    Due: Sep 25 9:00 AM
    Submit the checkpoint
  `, "fall-checkpoint.txt", { now });
  const springDraft = createCourseDraftFromMaterial(`
    Spring Academic Year 2026-2027 CS779 > Assignments > Spring checkpoint
    Spring checkpoint
    Due: May 10 9:00 AM
    Submit the checkpoint
  `, "spring-checkpoint.txt", { now });
  const summerDraft = createCourseDraftFromMaterial(`
    Academic Year 2026-2027 CS779 > Assignments > July checkpoint
    Summer Session
    July checkpoint
    Due: Jul 10 9:00 AM
    Submit the checkpoint
  `, "summer-checkpoint.txt", { now });
  const unrelatedRange = createCourseDraftFromMaterial(`
    CS779 Catalog comparison 2030-2031
    Current checkpoint
    Due: Jan 25 9:00 AM
    Submit the checkpoint
  `, "catalog-checkpoint.txt", { now });

  assert.equal(fallDraft.dueDate, "Sep 25, 2026, 9:00 AM");
  assert.equal(springDraft.dueDate, "May 10, 2027, 9:00 AM");
  assert.equal(summerDraft.dueDate, "Jul 10, 2027, 9:00 AM");
  assert.equal(unrelatedRange.dueDate, "Jan 25, 2027, 9:00 AM");
});

test("syllabus parsing strictly handles common English month aliases and orders", () => {
  const now = new Date("2026-01-10T12:00:00-08:00");
  for (const dueDate of [
    "Sept 31, 2026",
    "Sep. 31, 2026",
    "31 Feb 2026"
  ]) {
    const result = analyzeSyllabus(
      `Final review\nDue: ${dueDate}`,
      { now }
    );
    assert.equal(result.deadlines.length, 0, dueDate);
    assert.ok(
      result.dateIssues.some((issue) =>
        issue.kind === "invalid" && issue.value === dueDate
      ),
      dueDate
    );
  }

  for (const [dueDate, expected] of [
    ["Sept 30, 2026", "Sep 30, 2026"],
    ["Sep. 30, 2026", "Sep 30, 2026"],
    ["29 Feb 2024", "Feb 29, 2024"]
  ]) {
    const result = analyzeSyllabus(
      `Final review\nDue: ${dueDate}`,
      { now }
    );
    assert.equal(result.dateIssues.length, 0, dueDate);
    assert.equal(result.deadlines[0]?.date, expected, dueDate);
  }
});

test("buildAssignmentBreakdown creates checklist, timeline, and rubric tips", () => {
  const breakdown = buildAssignmentBreakdown(
    "Create a research presentation with 6 slides, citations, and a final recommendation."
  );

  assert.ok(breakdown.checklist.some((item) => item.includes("research question")));
  assert.ok(breakdown.checklist.some((item) => item.includes("slide")));
  assert.equal(breakdown.timeline.length, 4);
  assert.ok(breakdown.rubricTips.some((item) => item.includes("Evidence")));
});

test("buildStudyPlan adapts plan length to exam distance and difficulty", () => {
  const plan = buildStudyPlan({
    examDate: "2026-07-20",
    difficulty: "hard",
    now: new Date("2026-07-05T12:00:00-07:00")
  });

  assert.equal(plan.daysUntilExam, 15);
  assert.equal(plan.sessions.length, 5);
  assert.match(plan.summary, /5 focused sessions/);
});

test("buildStudyPlan asks for an exam date when none is provided", () => {
  const plan = buildStudyPlan({
    examDate: "",
    difficulty: "medium",
    now: new Date("2026-07-05T12:00:00-07:00")
  });

  assert.equal(plan.daysUntilExam, 0);
  assert.deepEqual(plan.sessions, []);
  assert.match(plan.summary, /Choose an exam date/);
});

test("getBilingualExplanation returns English and Chinese support", () => {
  assert.match(getBilingualExplanation("rubric", "en"), /grading rubric/i);
  assert.match(getBilingualExplanation("rubric", "zh"), /评分标准/);
});

test("createCourseFromInput builds a user-entered course with deadlines and tasks", () => {
  const course = createCourseFromInput({
    code: "MATH208",
    name: "Probability",
    audience: "international students",
    deadlineLabel: "Midterm exam",
    dueDate: "2026-08-15",
    tasksText: "Read chapter 4\nFinish homework problems\nReview Bayes theorem",
    topicsText: "Bayes theorem, random variables"
  });

  assert.equal(course.id, "math208-probability");
  assert.equal(course.code, "MATH208");
  assert.equal(course.name, "Probability");
  assert.equal(course.nextDue, "Midterm exam");
  assert.equal(course.dueDate, "Aug 15");
  assert.equal(course.tasks.length, 3);
  assert.deepEqual(
    course.tasks.map((task) => task.title),
    ["Read chapter 4", "Finish homework problems", "Review Bayes theorem"]
  );
  assert.deepEqual(course.weakTopics, ["Bayes theorem", "random variables", "rubric"]);
  assert.equal(course.deadlines[0].type, "exam");
});

test("createCourseFromMaterial imports a course from pasted syllabus text", () => {
  const course = createCourseFromMaterial(`
    MATH208 Probability
    Topics: Bayes theorem, random variables, expected value
    Homework 1 due Aug 15.
    Midterm exam due Sep 10.
    - Read chapter 4
    - Finish probability worksheet
    - Review Bayes theorem examples
  `, "", { now: new Date("2026-07-20T12:00:00-07:00") });

  assert.equal(course.code, "MATH208");
  assert.equal(course.name, "Probability");
  assert.equal(course.nextDue, "Homework 1");
  assert.equal(course.dueDate, "Aug 15, 2026");
  assert.equal(course.deadlines.length, 2);
  assert.deepEqual(
    course.tasks.map((task) => task.title),
    ["Read chapter 4", "Finish probability worksheet", "Review Bayes theorem examples"]
  );
  assert.deepEqual(course.weakTopics, ["Bayes theorem", "random variables", "expected value", "rubric"]);
});

test("createCourseFromMaterial displays due dates copied from an assignment page", () => {
  const course = createCourseFromMaterial(`
    Project 1: AI Study App Website
    Due Date: Sunday, July 28, 2026 at 11:59 PM
    Submit your website link and reflection.
  `);

  assert.equal(course.nextDue, "Project 1: AI Study App Website");
  assert.equal(course.dueDate, "Sun Jul 28, 2026, 11:59 PM");
  assert.deepEqual(course.deadlines, [
    {
      label: "Project 1: AI Study App Website",
      date: "Sun Jul 28, 2026, 11:59 PM",
      type: "project"
    }
  ]);
});

test("createCourseFromMaterial reads Canvas assignment screenshot OCR text accurately", () => {
  const course = createCourseFromMaterial(
    `
      SUMMER 2026 CS450 - A > Assignments > Watch this video
      Summer 2026
      Home
      Assignments
      Watch this video
      Due: Sat Jul 11, 2026 9:00am
      10 Points Possible
      Attempt 1
      In Progress
      NEXT UP: Submit Assignment
      Unlimited Attempts Allowed
      Details
      https://www.youtube.com/watch?v=Z-k8Wm2uQmw
      write watched after you complete. focus on the eval and execution part
      Choose a submission type
    `,
    "canvas-assignment.png"
  );

  assert.equal(course.code, "CS450-A");
  assert.equal(course.name, "SUMMER 2026 CS450 - A");
  assert.equal(course.nextDue, "Watch this video");
  assert.equal(course.dueDate, "Sat Jul 11, 2026, 9:00 AM");
  assert.deepEqual(course.deadlines, [
    {
      label: "Watch this video",
      date: "Sat Jul 11, 2026, 9:00 AM",
      type: "assignment"
    }
  ]);
  assert.deepEqual(
    course.tasks.map((task) => task.title),
    [
      "Watch the linked video",
      "write watched after you complete. focus on the eval and execution part",
      "Submit the assignment in Canvas",
      "Check the final response against the point value and instructions"
    ]
  );
  assert.match(course.notes, /10 Points Possible/);
  assert.match(course.notes, /Canvas assignment page/);
  assert.match(course.notes, /youtube\.com\/watch\?v=Z-k8Wm2uQmw/);
});

test("createCourseDraftFromMaterial turns a seminar Canvas screenshot into a correct workplan", () => {
  const draft = createCourseDraftFromMaterial(
    `
      SUMMER 2026 CS450 - A > Assignments > Attend a seminar
      Summer 2026
      Home
      Assignments
      Attend a seminar
      Due: Tue Jul 28, 2026 11:59pm
      100 Points Possible
      Attempt 1
      In Progress
      NEXT UP: Submit Assignment
      Unlimited Attempts Allowed
      Details
      Max one page reflection on the seminar you attended. Please add pictures too
      Choose a submission type
      Text
      Web URL
      Media
      Upload
      Studio
      More
    `,
    "canvas-seminar.png"
  );

  assert.equal(draft.sourceType, "Canvas assignment page");
  assert.equal(draft.code, "CS450-A");
  assert.equal(draft.name, "SUMMER 2026 CS450 - A");
  assert.equal(draft.assignment, "Attend a seminar");
  assert.equal(draft.dueDate, "Tue Jul 28, 2026, 11:59 PM");
  assert.equal(draft.points, "100 Points Possible");
  assert.equal(draft.status.progress, "In Progress");
  assert.equal(draft.status.nextUp, "Submit Assignment");
  assert.equal(draft.status.attempt, "Attempt 1");
  assert.equal(draft.status.attemptsAllowed, "Unlimited Attempts Allowed");
  assert.match(draft.assignmentDetails.overview, /Max one page reflection/);
  assert.ok(draft.assignmentDetails.requirements.some((item) => /max one page reflection/i.test(item)));
  assert.ok(draft.assignmentDetails.requirements.some((item) => /pictures/i.test(item)));
  assert.ok(draft.assignmentDetails.requirements.some((item) => /Submission types: Text, Web URL, Media, Upload, Studio, More/i.test(item)));
  assert.ok(draft.assignmentDetails.steps.some((item) => /Attend a seminar/i.test(item)));
  assert.ok(draft.assignmentDetails.steps.some((item) => /one-page reflection/i.test(item)));
  assert.ok(draft.assignmentDetails.steps.some((item) => /Add pictures/i.test(item)));
  assert.match(draft.tasksText, /Attend a seminar/);
  assert.match(draft.tasksText, /one-page reflection/);
  assert.doesNotMatch(draft.assignmentDetails.steps.join("\n"), /AI for background research/i);
  assert.ok(draft.confidence >= 86);
});

test("createCourseDraftFromMaterial returns confidence, evidence, and action plan", () => {
  const draft = createCourseDraftFromMaterial(`
    SUMMER 2026 CS450 - A > Assignments > Watch this video
    Due: Sat Jul 11, 2026 9:00am
    10 Points Possible
    NEXT UP: Submit Assignment
    https://www.youtube.com/watch?v=Z-k8Wm2uQmw
    write watched after you complete. focus on the eval and execution part
  `);

  assert.equal(draft.sourceType, "Canvas assignment page");
  assert.equal(draft.confidenceLabel, "High confidence");
  assert.ok(draft.confidence >= 86);
  assert.deepEqual(draft.warnings, []);
  assert.ok(draft.evidence.some((item) => item.label === "Course" && item.value === "SUMMER 2026 CS450 - A"));
  assert.ok(draft.evidence.some((item) => item.label === "Due" && item.value === "Sat Jul 11, 2026, 9:00 AM"));
  assert.match(draft.tasksText, /Watch the linked video/);
  assert.ok(draft.actionPlan.some((item) => item.includes("Submit before Sat Jul 11, 2026, 9:00 AM")));
});

test("createCourseDraftFromMaterial flags low-confidence OCR instead of pretending it knows the course", () => {
  const draft = createCourseDraftFromMaterial(
    `
      Chrome file edit view history
      example.instructure.com courses assignments
      Watch this vide0
      Due: Sat Jul 11, 2026 9:00am
      10 Points Possible
      NEXT UP: Submit Assignment
    `,
    "canvas-assignment.png"
  );

  assert.equal(draft.sourceType, "Canvas assignment page");
  assert.equal(draft.assignment, "Watch this video");
  assert.equal(draft.code, "");
  assert.equal(draft.name, "");
  assert.ok(draft.confidence < 65);
  assert.ok(draft.warnings.some((warning) => warning.includes("Course code")));
  assert.ok(draft.warnings.some((warning) => warning.includes("Course name")));
  assert.match(draft.tasksText, /Submit the assignment in Canvas/);
});

test("createCourseDraftFromMaterial reads a submitted Canvas assignment status page", () => {
  const draft = createCourseDraftFromMaterial(`
    Research Paper
    **Due: Mon Jun 22, 2026 9:00am**Due: Mon Jun 22, 2026 9:00am
    Late
    Ungraded, 50 Possible Points
    50 Points Possible
    Attempt
    Attempt 1

    Submitted on Jul 5, 2026 12:51pmSubmitted on Jul 5, 2026 12:51pm
    **NEXT UP: Review Feedback**
    Attempt 1 Score:
    N/A

    **Unlimited Attempts Allowed**
  `);

  assert.equal(draft.sourceType, "Canvas submitted assignment");
  assert.equal(draft.code, "");
  assert.equal(draft.name, "");
  assert.equal(draft.assignment, "Research Paper");
  assert.equal(draft.dueDate, "Mon Jun 22, 2026, 9:00 AM");
  assert.equal(draft.points, "50 Points Possible");
  assert.deepEqual(draft.status, {
    late: true,
    grading: "Ungraded",
    submittedAt: "Jul 5, 2026, 12:51 PM",
    nextUp: "Review Feedback",
    attempt: "Attempt 1",
    score: "N/A",
    attemptsAllowed: "Unlimited Attempts Allowed"
  });
  assert.ok(draft.warnings.some((warning) => warning.includes("Course code")));
  assert.ok(draft.warnings.some((warning) => warning.includes("Course name")));
  assert.ok(draft.confidence < 86);
  assert.ok(draft.evidence.some((item) => item.label === "Submitted" && item.value === "Jul 5, 2026, 12:51 PM"));
  assert.ok(draft.evidence.some((item) => item.label === "Next up" && item.value === "Review Feedback"));
  assert.match(draft.tasksText, /Review instructor feedback/);
});

test("createCourseDraftFromMaterial recovers a complete graded assignment from noisy Canvas OCR", () => {
  const draft = createCourseDraftFromMaterial(`
    @ Chrome XX HE BF HLER PE PARR FET BHO HE 4+ © e3xvm = 6) Q 8 7A2BRAER TH925
    v Read and respond Contactle: X + [8]/8] Gemini
    & (¢] 25 example.instructure.com/courses/999/assignments/111?return_to=https%3A%2F%2Fexample.instructure.com%2Fcalendar%23.. LY % foe) Zr EfTEsEIT ER
    A Read and respond Future Care 20/20 Points
    School Home Due: Tue Jul 14, 2026 3:00pm
    ® Announcements Offline Score:
    Attempt 1 v O Review Feedback Ine score: EN Add Comment
    Account | Assignments 20/20
    _ Anonymous Grading: no
    fi) Discussions
    Didilireri Grades [0 Unlimited Attempts Allowed
    peop
    Courses eople v Details
    Pages No submission
    Callzmety Files Read Story Chapter Future care
    Eh Syllabus
    obox Modules
    https:/archive.org/details/future-care 202401
    © Attendance all class group
    History
    = one person is director, a prop manager, a producer and actors
    Studio Mini Play
    @ Create a short play that imagines life in 2041. Include at least:
    Help e One Al healthcare technology
    ¢ One ethical dilemma
    ¢ One emotional conflict
    e A possible solution
    Previous Next
    2 © 2]
  `, "canvas-graded-assignment.png");

  assert.equal(draft.sourceType, "Canvas assignment page");
  assert.equal(draft.assignment, "Read and respond Future Care");
  assert.equal(draft.dueDate, "Tue Jul 14, 2026, 3:00 PM");
  assert.equal(draft.points, "20 Points Possible");
  assert.deepEqual(draft.status, {
    grading: "Graded",
    nextUp: "Review Feedback",
    attempt: "Attempt 1",
    score: "20/20",
    attemptsAllowed: "Unlimited Attempts Allowed",
    submission: "No submission",
    anonymousGrading: "No"
  });
  assert.equal(
    draft.linksText,
    "https://archive.org/details/future-care_202401"
  );
  assert.ok(draft.assignmentDetails.requirements.some((item) =>
    /Read Story Chapter Future care/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.requirements.some((item) =>
    /one person is director, a prop manager, a producer and actors/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.requirements.some((item) =>
    /One AI healthcare technology/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.requirements.some((item) =>
    /One ethical dilemma/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.requirements.some((item) =>
    /One emotional conflict/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.requirements.some((item) =>
    /A possible solution/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.steps.includes(
    'Read "Future care" and take notes for the group.'
  ));
  assert.ok(draft.assignmentDetails.steps.some((item) =>
    /Assign.*director.*prop manager.*producer.*actors/i.test(item)
  ));
  assert.ok(draft.assignmentDetails.steps.some((item) =>
    /Draft.*mini play.*2041/i.test(item)
  ));
  assert.doesNotMatch(
    draft.assignmentDetails.steps.join("\n"),
    /AI for background research/i
  );
  assert.doesNotMatch(draft.tasksText, /20\/20 Points/i);
});

test("extraction treats only meaningful scores as Graded", () => {
  const cases = [
    [undefined, false],
    [null, false],
    ["", false],
    ["   ", false],
    ["N/A", false],
    ["n/a", false],
    ["Pending", false],
    ["Ungraded", false],
    ["Not graded", false],
    [0, true],
    ["0/100", true],
    ["85%", true],
    ["A", true],
    ["45/50", true]
  ];

  for (const [score, meaningful] of cases) {
    assert.equal(hasMeaningfulScore(score), meaningful);
    const assignment = createAssignmentFromDraft({
      assignment: "Score check",
      dueDate: "",
      status: { score },
      tasksText: "Review feedback"
    }, "course-1");
    assert.equal(assignment.category === "Graded", meaningful);
  }
});

test("course-bound assignments retain source metadata", () => {
  const draft = bindDraftToCourse(createCourseDraftFromMaterial(`
    Attend a seminar
    Due: Tue Jul 28, 2026 11:59pm
    100 Points Possible
    Max one page reflection. Add pictures.
  `, "seminar.txt"), {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: []
  });
  const result = upsertCourseFromDraft([], draft);

  assert.equal(result.assignment.source.fileName, "seminar.txt");
  assert.equal(result.assignment.source.sourceType, "Canvas assignment page");
  assert.ok(result.assignment.source.importedAt);
  assert.equal(result.assignment.source.confidence, draft.confidence);
  assert.deepEqual(result.assignment.source.warnings, draft.warnings);
  assert.deepEqual(result.assignment.source.evidence, draft.evidence);
  assert.ok(result.assignment.createdAt);
  assert.equal(result.assignment.updatedAt, result.assignment.createdAt);
});

test("re-importing an assignment preserves completed matching tasks", () => {
  const existing = createCourseFromInput({
    code: "CS450",
    name: "Technology and Society",
    deadlineLabel: "Research Paper",
    dueDate: "Jun 22, 2026, 9:00 AM",
    tasksText: "Read the white paper",
    topicsText: "Technology"
  });
  existing.assignments = [{
    id: "cs450-research-paper-jun-22-2026-9-00-am",
    title: "Research Paper",
    dueDate: "Jun 22, 2026, 9:00 AM",
    createdAt: "2026-06-01T12:00:00.000Z",
    links: ["https://example.com/research.pdf"],
    tasks: [{
      id: "read-task",
      title: "Read the white paper",
      done: true
    }]
  }];
  const draft = bindDraftToCourse(createCourseDraftFromMaterial(`
    Research Paper
    Due: Mon Jun 22, 2026 9:00am
    Read the white paper
    Draft the analysis
  `, "research.txt"), existing);
  const result = upsertCourseFromDraft([existing], draft, existing.id);
  assert.equal(result.course.assignments.length, 1);
  const mergedTask = result.course.assignments[0].tasks
    .find((task) => task.title === "Read the white paper");

  assert.equal(mergedTask.done, true);
  assert.equal(
    result.course.assignments[0].createdAt,
    "2026-06-01T12:00:00.000Z"
  );
  assert.deepEqual(
    result.course.assignments[0].links,
    ["https://example.com/research.pdf"]
  );
});

test("re-importing a renamed task preserves completion by stable task id", () => {
  const baseDraft = bindDraftToCourse({
    ...createCourseDraftFromMaterial(`
      Research Paper
      Due: Mon Jun 22, 2026 9:00am
    `, "research.txt"),
    tasksText: "Read the original paper\nDraft the analysis"
  }, {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: []
  });
  const initial = upsertCourseFromDraft([], baseDraft);
  const existing = initial.course;
  const readTask = existing.assignments[0].tasks.find(
    (task) => task.title === "Read the original paper"
  );
  assert.match(readTask.id, /-task-semantic-/);
  readTask.title = "Read the source paper in my own wording";
  readTask.done = true;
  readTask.localNote = "Keep this local state";

  const result = upsertCourseFromDraft([existing], {
    ...baseDraft,
    tasksText: "Draft the analysis\nRead the original paper"
  }, existing.id);
  const task = result.course.assignments[0].tasks.find(
    (item) => item.title === "Read the source paper in my own wording"
  );

  assert.equal(task.id, readTask.id);
  assert.equal(task.done, true);
  assert.equal(task.localNote, "Keep this local state");
  assert.equal(
    result.course.assignments[0].tasks.some(
      (item) => item.title === "Read the original paper"
    ),
    false
  );
});

test("imported task identities are stable across reorder and deterministic for duplicate titles", () => {
  const draft = {
    assignment: "Research Paper",
    dueDate: "Jun 22, 2026, 9:00 AM",
    sourceType: "Assignment brief",
    tasksText: "Read the paper\nDraft the analysis\nRead the paper"
  };
  const first = createAssignmentFromDraft(draft, "cs450");
  const reordered = createAssignmentFromDraft({
    ...draft,
    tasksText: "Read the paper\nRead the paper\nDraft the analysis"
  }, "cs450");
  const idsFor = (assignment, title) => assignment.tasks
    .filter((task) => task.title === title)
    .map((task) => task.id)
    .sort();

  assert.deepEqual(
    idsFor(first, "Read the paper"),
    idsFor(reordered, "Read the paper")
  );
  assert.equal(new Set(first.tasks.map((task) => task.id)).size, 3);
  assert.equal(
    first.tasks.find((task) => task.title === "Draft the analysis").id,
    reordered.tasks.find((task) => task.title === "Draft the analysis").id
  );
});

test("equivalent due formats preserve renamed duplicate task state with assignment-independent identities", () => {
  const course = {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: []
  };
  const firstDraft = bindDraftToCourse({
    assignment: "Research Paper",
    dueDate: "Jul 25, 2026, 11:59 PM",
    sourceType: "Assignment brief",
    tasksText: "Read the paper\nDraft the analysis\nRead the paper"
  }, course);
  const initial = upsertCourseFromDraft([], firstDraft);
  const existing = initial.course;
  const originalAssignmentId = existing.assignments[0].id;
  const duplicateReadTasks = existing.assignments[0].tasks.filter(
    (task) => task.title === "Read the paper"
  );
  duplicateReadTasks[1].title = "Read the source carefully in my own words";
  duplicateReadTasks[1].done = true;
  duplicateReadTasks[1].localNote = "Preserve my local wording";

  const result = upsertCourseFromDraft([existing], {
    ...firstDraft,
    dueDate: "2026-07-25 23:59",
    tasksText: "Draft the analysis\nRead the paper\nRead the paper"
  }, existing.id);
  const assignment = result.course.assignments[0];
  const renamed = assignment.tasks.find(
    (task) => task.title === "Read the source carefully in my own words"
  );

  assert.equal(result.course.assignments.length, 1);
  assert.equal(assignment.id, originalAssignmentId);
  assert.ok(renamed);
  assert.equal(renamed.done, true);
  assert.equal(renamed.localNote, "Preserve my local wording");
  assert.equal(
    assignment.tasks.filter((task) => task.title === "Read the paper").length,
    1
  );
  assert.equal(new Set(assignment.tasks.map((task) => task.id)).size, 3);
  assignment.tasks.forEach((task) => {
    assert.match(task.id, /^imported-task-semantic-/);
    assert.equal(task.assignmentId, originalAssignmentId);
  });
});

test("legacy positional task ids prefer title and never transfer done state after reorder", () => {
  const draft = bindDraftToCourse({
    ...createCourseDraftFromMaterial(`
      Research Paper
      Due: Mon Jun 22, 2026 9:00am
    `, "research.txt"),
    tasksText: "Draft the analysis\nRead the white paper"
  }, {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: []
  });
  const incoming = createAssignmentFromDraft(draft, "code:CS450");
  const assignmentId = incoming.id;
  const existing = {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: [{
      id: assignmentId,
      title: incoming.title,
      dueDate: incoming.dueDate,
      tasks: [
        {
          id: `${assignmentId}-task-1`,
          title: "Read the white paper",
          done: true
        },
        {
          id: `${assignmentId}-task-2`,
          title: "Draft the analysis",
          done: false
        }
      ]
    }]
  };

  const result = upsertCourseFromDraft([existing], draft, existing.id);
  const tasks = Object.fromEntries(
    result.course.assignments[0].tasks.map((task) => [task.title, task])
  );

  assert.equal(tasks["Read the white paper"].done, true);
  assert.equal(tasks["Draft the analysis"].done, false);
});

test("assignment imports persist extracted links", () => {
  const result = upsertCourseFromDraft([], bindDraftToCourse(
    createCourseDraftFromMaterial(`
      Research Paper
      Due: Mon Jun 22, 2026 9:00am
      Required reading: https://example.com/research.pdf
    `, "research.txt"),
    {
      id: "cs450",
      code: "CS450",
      name: "Technology and Society",
      assignments: []
    }
  ));

  assert.deepEqual(
    result.assignment.links,
    ["https://example.com/research.pdf"]
  );
  assert.deepEqual(
    result.course.assignments[0].links,
    ["https://example.com/research.pdf"]
  );
});

test("upsertCourseFromDraft groups multiple uploads under the same course and assignment subtitles", () => {
  const firstDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 CS450 - A > Assignments > Watch this video
    Due: Sat Jul 11, 2026 9:00am
    10 Points Possible
    NEXT UP: Submit Assignment
    https://www.youtube.com/watch?v=Z-k8Wm2uQmw
  `);
  const secondDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 CS450 - A > Assignments > Research Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    Ungraded, 50 Possible Points
    50 Points Possible
    Attempt 1
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
    Attempt 1 Score:
    N/A
    Unlimited Attempts Allowed
  `);

  const first = upsertCourseFromDraft([], firstDraft);
  const second = upsertCourseFromDraft(first.courses, secondDraft, first.activeCourseId);
  const [course] = second.courses;

  assert.equal(second.courses.length, 1);
  assert.equal(course.code, "CS450-A");
  assert.equal(course.name, "SUMMER 2026 CS450 - A");
  assert.deepEqual(
    course.assignments.map((assignment) => assignment.title),
    ["Watch this video", "Research Paper"]
  );
  assert.equal(course.assignments[0].category, "To submit");
  assert.equal(course.assignments[1].category, "Feedback");
  assert.equal(course.deadlines.length, 2);
  assert.ok(course.tasks.some((task) => task.title === "Review instructor feedback"));

  const grouped = groupAssignmentsByCategory(course.assignments);
  assert.deepEqual(
    grouped.map((group) => [group.label, group.assignments.map((assignment) => assignment.title)]),
    [
      ["To submit", ["Watch this video"]],
      ["Feedback", ["Research Paper"]]
    ]
  );
});

test("upsertCourseFromDraft refuses to group an assignment when course identity is missing", () => {
  const draft = createCourseDraftFromMaterial(`
    Research Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    50 Points Possible
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
  `);
  const result = upsertCourseFromDraft([], draft);

  assert.equal(result.action, "needs-course");
  assert.equal(result.courses.length, 0);
  assert.equal(result.assignment.title, "Research Paper");
  assert.match(result.message, /Course identity/);
});

test("upsertCourseFromDraft merges a reviewed assignment-only page into an existing course", () => {
  const existingDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 CS450 - A > Assignments > Watch this video
    Due: Sat Jul 11, 2026 9:00am
    10 Points Possible
    NEXT UP: Submit Assignment
  `);
  const assignmentOnlyDraft = createCourseDraftFromMaterial(`
    Research Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    50 Points Possible
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
  `);
  const first = upsertCourseFromDraft([], existingDraft);
  const reviewed = {
    ...assignmentOnlyDraft,
    code: "CS450-A",
    name: "SUMMER 2026 CS450 - A",
    warnings: []
  };
  const merged = upsertCourseFromDraft(first.courses, reviewed, first.activeCourseId);

  assert.equal(merged.action, "merged");
  assert.equal(merged.courses.length, 1);
  assert.deepEqual(
    merged.courses[0].assignments.map((assignment) => assignment.title),
    ["Watch this video", "Research Paper"]
  );
});

test("createCourseDraftFromMaterial turns a full assignment prompt into requirements and completion steps", () => {
  const draft = createCourseDraftFromMaterial(`
    Research Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    Ungraded, 50 Possible Points
    50 Points Possible
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
    https://www.zouantcha.com/blog/technology-whitepaper

    Assignment Overview
    Read Example Author's original research article "Technology: A Peer-to-Peer Electronic Cash System" (2008) and complete a strategic analysis that demonstrates your ability to synthesize AI insights with original critical thinking.

    Required Reading
    Nakamoto, S. (2008). Technology: A Peer-to-Peer Electronic Cash System. Available at: example.com/research.pdf
    Core Assignment Tasks
    Task 1: Contextualized Problem Analysis (20%) extra credit
    Interview one professional in finance/technology (or conduct primary research) to validate or challenge AI insights about market conditions
    Task 2: Competitive Intelligence Integration (25%)
    Use AI to identify Technology's competitors in 2008-2010 vs today
    Task 3: Stakeholder Impact Assessment (25%)
    Interview or survey at least 3 real individuals from different stakeholder groups
    Task 4: Future Scenario Planning (20%)
    Prompt AI to generate 3 scenarios for Technology's evolution over the next decade
    Task 5: AI Collaboration Reflection (10%)
    Document and analyze your AI usage
    Deliverables
    Main Report (4-5 pages)
    AI Collaboration Appendix (1-2 pages)
    Screenshots or transcripts of key AI interactions
    Bibliography of AI tools used
    Evaluation Rubric
    Strategic Insight Beyond AI (35%): Evidence of original thinking that builds on but transcends AI analysis
    Integration of Primary Research (25%): Quality of interviews/surveys and how they inform conclusions
    Critical Evaluation of AI Output (20%): Ability to assess, validate, and improve upon AI-generated content
  `);

  assert.equal(draft.assignment, "Research Paper");
  assert.equal(draft.dueDate, "Mon Jun 22, 2026, 9:00 AM");
  assert.ok(draft.assignmentDetails.deliverables.includes("Main Report (4-5 pages)"));
  assert.ok(draft.assignmentDetails.deliverables.includes("AI Collaboration Appendix (1-2 pages)"));
  assert.equal(draft.assignmentDetails.coreTasks.length, 5);
  assert.ok(draft.assignmentDetails.requirements.some((item) => item.includes("Interview one finance or technology professional")));
  assert.ok(draft.assignmentDetails.requirements.some((item) => item.includes("at least 3 people")));
  assert.ok(draft.assignmentDetails.rubric.some((item) => item.label === "Strategic Insight Beyond AI" && item.weight === "35%"));
  assert.ok(draft.assignmentDetails.steps.some((step) => step.includes("required interviews or surveys")));
  assert.ok(draft.assignmentDetails.steps.some((step) => step.includes("AI collaboration appendix")));
});

test("upsertCourseFromDraft stores syllabus uploads as course-level directory data", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    CS450 Technology Strategy
    Syllabus
    Topics: AI collaboration, market analysis, stakeholder interviews
    Midterm exam due Jul 30.
    Final project due Aug 20.
    Office hours: Wednesday 2pm
    Grading policy: projects and participation
  `);
  const assignmentDraft = createCourseDraftFromMaterial(`
    CS450 Technology Strategy > Assignments > Research Paper
    Due: Mon Jun 22, 2026 9:00am
    50 Points Possible
  `);
  const courseCreated = upsertCourseFromDraft([], syllabusDraft);
  const assignmentMerged = upsertCourseFromDraft(courseCreated.courses, assignmentDraft, courseCreated.activeCourseId);
  const course = assignmentMerged.courses[0];

  assert.equal(courseCreated.action, "course-created");
  assert.equal(course.coursePlan.syllabusUploaded, true);
  assert.ok(course.coursePlan.exams.some((exam) => exam.label === "Midterm exam"));
  assert.ok(course.coursePlan.topics.includes("AI collaboration"));
  assert.deepEqual(course.assignments.map((assignment) => assignment.title), ["Research Paper"]);
});

test("globally matched syllabus replacement removes stale deadlines and exams", () => {
  const existing = {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: [{
      id: "paper",
      title: "Research Paper",
      status: { completed: true },
      tasks: [{ id: "read", title: "Read", done: true }]
    }],
    coursePlan: {
      syllabusUploaded: true,
      deadlines: [
        { label: "Final Exam", date: "Dec 10, 2026", type: "exam" },
        { label: "Old Quiz", date: "Nov 1, 2026", type: "quiz" }
      ],
      exams: [{ label: "Final Exam", date: "Dec 10, 2026", type: "exam" }]
    }
  };
  const replacement = {
    code: "CS450",
    name: "Technology and Society",
    sourceType: "Syllabus or schedule",
    coursePlan: {
      syllabusUploaded: true,
      deadlines: [{ label: "Final Exam", date: "Dec 12, 2026", type: "exam" }],
      exams: [{ label: "Final Exam", date: "Dec 12, 2026", type: "exam" }]
    },
    deadlines: [{ label: "Final Exam", date: "Dec 12, 2026", type: "exam" }],
    warnings: [],
    evidence: []
  };

  const result = upsertCourseFromDraft([existing], replacement);
  const course = result.course;

  assert.deepEqual(course.coursePlan.deadlines, [
    { label: "Final Exam", date: "Dec 12, 2026", type: "exam" }
  ]);
  assert.deepEqual(course.coursePlan.exams, [
    { label: "Final Exam", date: "Dec 12, 2026", type: "exam" }
  ]);
  assert.equal(course.assignments[0].status.completed, true);
  assert.equal(course.assignments[0].tasks[0].done, true);
});

test("selected-course syllabus replacement is authoritative without changing assignments", () => {
  const existing = {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: [{
      id: "paper",
      title: "Research Paper",
      status: { submittedAt: "Submitted" },
      tasks: [{ id: "read", title: "Read", done: true }]
    }],
    coursePlan: {
      syllabusUploaded: true,
      deadlines: [
        { label: "Final Exam", date: "Dec 10, 2026", type: "exam" },
        { label: "Removed Presentation", date: "Nov 20, 2026", type: "presentation" }
      ],
      exams: [{ label: "Final Exam", date: "Dec 10, 2026", type: "exam" }]
    }
  };
  const rawReplacement = {
    code: "OCR450",
    name: "Wrong OCR name",
    sourceType: "Syllabus or schedule",
    coursePlan: {
      syllabusUploaded: true,
      deadlines: [{ label: "Final Exam", date: "Dec 12, 2026", type: "exam" }],
      exams: [{ label: "Final Exam", date: "Dec 12, 2026", type: "exam" }]
    },
    deadlines: [{ label: "Final Exam", date: "Dec 12, 2026", type: "exam" }],
    warnings: [],
    evidence: []
  };
  const bound = bindDraftToCourse(rawReplacement, existing);

  const result = upsertCourseFromDraft([existing], bound, existing.id);
  const course = result.course;

  assert.equal(result.courses.length, 1);
  assert.equal(course.id, "cs450");
  assert.deepEqual(course.coursePlan.deadlines.map((item) => item.date), [
    "Dec 12, 2026"
  ]);
  assert.deepEqual(course.coursePlan.exams.map((item) => item.date), [
    "Dec 12, 2026"
  ]);
  assert.equal(course.assignments[0].status.submittedAt, "Submitted");
  assert.equal(course.assignments[0].tasks[0].done, true);
});

test("invalid and ambiguous syllabus drafts cannot replace an existing schedule", () => {
  const existing = {
    id: "cs450",
    code: "CS450",
    name: "Technology and Society",
    assignments: [{
      id: "paper",
      title: "Research Paper",
      status: { completed: true },
      tasks: [{ id: "read", title: "Read", done: true }]
    }],
    coursePlan: {
      syllabusUploaded: true,
      deadlines: [{ label: "Final Exam", date: "Dec 10, 2026", type: "exam" }],
      exams: [{ label: "Final Exam", date: "Dec 10, 2026", type: "exam" }]
    }
  };
  const invalidDraft = createCourseDraftFromMaterial(`
    CS450 Technology and Society Syllabus
    Semester and Year: Fall 2026
    Professor: Mina Patel
    COURSE GRADING POLICY
    Final Exam 100%
    WEEKLY COURSE GUIDE
    Week 15 Final
    Assignments:
    Final Exam due 13/01/2026
  `);
  const ambiguousDraft = createCourseDraftFromMaterial(`
    CS450 Technology and Society Syllabus
    Semester and Year: Fall 2026
    Professor: Mina Patel
    COURSE GRADING POLICY
    Final Exam 100%
    WEEKLY COURSE GUIDE
    Week 15 Final
    Assignments:
    Final Exam due 03/04
  `);

  assert.ok(invalidDraft.warnings.some((warning) =>
    /13\/01\/2026.*invalid/i.test(warning)
  ));
  assert.ok(invalidDraft.evidence.some((item) =>
    item.label === "Invalid syllabus date" &&
    item.value === "13/01/2026"
  ));
  assert.ok(ambiguousDraft.warnings.some((warning) =>
    /03\/04.*ambiguous/i.test(warning)
  ));
  assert.ok(ambiguousDraft.evidence.some((item) =>
    item.label === "Ambiguous syllabus date" &&
    item.value === "03/04"
  ));

  const globalResult = upsertCourseFromDraft([existing], invalidDraft);
  assert.equal(globalResult.action, "needs-date-review");
  assert.deepEqual(globalResult.courses[0].coursePlan, existing.coursePlan);

  const boundDraft = bindDraftToCourse(ambiguousDraft, existing);
  assert.equal(boundDraft.confidence, ambiguousDraft.confidence);
  const selectedResult = upsertCourseFromDraft(
    [existing],
    boundDraft,
    existing.id
  );
  assert.equal(selectedResult.action, "needs-date-review");
  assert.deepEqual(selectedResult.courses[0].coursePlan, existing.coursePlan);
});

test("createCourseDraftFromMaterial allows a syllabus without assignment due fields", () => {
  const draft = createCourseDraftFromMaterial(`
    CS450 Technology Strategy
    Syllabus
    Topics: AI collaboration, market analysis, stakeholder interviews
    Office hours: Wednesday 2pm
    Grading policy: projects and participation
  `);
  const result = upsertCourseFromDraft([], draft);
  const [course] = result.courses;

  assert.equal(draft.sourceType, "Syllabus or schedule");
  assert.ok(!draft.warnings.some((warning) => warning.includes("Assignment title")));
  assert.ok(!draft.warnings.some((warning) => warning.includes("Due date")));
  assert.equal(result.action, "course-created");
  assert.deepEqual(course.assignments, []);
  assert.equal(course.coursePlan.syllabusUploaded, true);
  assert.ok(course.coursePlan.courseRequirements.includes("Office hours: Wednesday 2pm"));
});

test("createCourseDraftFromMaterial treats a synthetic CS450 syllabus as course-level data", () => {
  const draft = createCourseDraftFromMaterial(`
    CS450 - Technology and Society - Summer 2026 - CS450(A)

    Semester and Year: Summer 2026
    Professor: Alex Morgan
    Credits: 3.0
    Section Number: A
    Modality: On-campus
    Meeting Location: M/W: 9:00 AM - 11:45 AM, Classroom 201
    Office Hours: Tue: 12 to 1 By appointment in person / zoom
    Email: alex.morgan@example.edu

    COURSE DESCRIPTION
    This course explores the intersection of Artificial Intelligence (AI) and emerging technologies, including Web 3.0, the Metaverse, Blockchain, Cybersecurity, Quantum, Biotechnology, IoT, Edge Computing, Space technologies and ESG frameworks.

    COURSE GRADING POLICY
    Assignments Percentage
    Certifications 20%
    SEMINAR 10%
    HW and Innovation news 40%
    Final Exam 30%
    Total 100%

    WEEKLY COURSE GUIDE
    Week Topic Learning Experience, Reading and Assignments
    Week 1 Introduction
    Assignments:
    Build a chatbot
    Assigned Readings & Learning Resources:
    Executive guide to AI, Replit

    Week 3 Web 3.0
    In-Class Learning Activities:
    Smart Contract Code with AI
    Assignments:
    Weekly Innovation Report; Presentations; Research Paper
    Assigned Readings & Learning Resources:
    Ch 1-3 ; Chapter in AI 2041

    Week 16 Finals
    In-Class Learning Activities:
    Presentations
    Assignments:
    Finals

    LATE SUBMISSION POLICY
    Late work is allowed with notice, but there will be a penalty of 10% per week delayed.

    AI POLICY
    You have to use AI and cite it and show us the prompts and use the QJE framework for deploying it.

    ATTENDANCE POLICY
    Attendance is mandatory for all students.
  `);
  const result = upsertCourseFromDraft([], draft);
  const [course] = result.courses;

  assert.equal(draft.sourceType, "Syllabus or schedule");
  assert.equal(draft.code, "CS450-A");
  assert.equal(draft.name, "Technology and Society");
  assert.equal(draft.coursePlan.syllabusUploaded, true);
  assert.equal(draft.coursePlan.term, "Summer 2026");
  assert.equal(draft.coursePlan.professor, "Alex Morgan");
  assert.equal(draft.coursePlan.credits, "3.0");
  assert.equal(draft.coursePlan.section, "A");
  assert.equal(draft.coursePlan.modality, "On-campus");
  assert.equal(draft.coursePlan.meetingLocation, "M/W: 9:00 AM - 11:45 AM, Classroom 201");
  assert.equal(draft.coursePlan.officeHours, "Tue: 12 to 1 By appointment in person / zoom");
  assert.equal(draft.coursePlan.email, "alex.morgan@example.edu");
  assert.ok(draft.coursePlan.grading.some((item) => item.label === "Final Exam" && item.weight === "30%"));
  assert.ok(draft.coursePlan.weeklyGuide.some((week) => week.week === "Week 3" && week.topic === "Web 3.0" && week.assignments.includes("Research Paper")));
  assert.ok(draft.coursePlan.policies.some((policy) => policy.label === "AI policy" && /QJE framework/i.test(policy.text)));
  assert.ok(draft.coursePlan.policies.some((policy) => policy.label === "Late policy" && /10% per week/i.test(policy.text)));
  assert.ok(draft.confidence >= 86);
  assert.equal(result.action, "course-created");
  assert.deepEqual(course.assignments, []);
});

test("generated syllabus text creates dated course deadlines and a final exam planner item", () => {
  const draft = createCourseDraftFromMaterial(`
    BUS501 Strategic Analytics Syllabus
    Semester and Year: Fall 2026
    Professor: Mina Patel
    Credits: 3
    Section Number: B
    Modality: Hybrid
    Meeting Location: Thu: 6:00 PM - 8:45 PM, Room 305
    Office Hours: Friday 10 AM by Zoom
    Email: mina.patel@example.edu
    Topics: dashboards, forecasting, stakeholder interviews
    COURSE GRADING POLICY
    Case Memo 25%
    Midterm Exam 25%
    Final Project 35%
    Participation 15%
    WEEKLY COURSE GUIDE
    Week 4 Forecasting
    Assignments:
    Case Memo due Sep 18, 2026 11:59pm
    Week 8 Decision Models
    Assignments:
    Midterm Exam due Oct 16, 2026 9:00am
    Week 15 Executive Briefing
    Assignments:
    Final Project due Dec 4, 2026 11:59pm
  `);

  assert.equal(draft.sourceType, "Syllabus or schedule");
  assert.equal(draft.coursePlan.deadlines.length, 3);
  assert.ok(draft.coursePlan.exams.some((exam) => exam.label === "Midterm Exam" && exam.date === "Oct 16, 2026, 9:00 AM"));
  assert.ok(!draft.coursePlan.exams.some((exam) => exam.label === "Final Project"));
  assert.ok(draft.coursePlan.grading.some((item) => item.label === "Final Project" && item.weight === "35%"));
  assert.ok(draft.coursePlan.weeklyGuide.some((week) => week.week === "Week 15" && week.assignments.includes("Final Project")));
});

test("separate course syllabi stay in separate course directories", () => {
  const cs450Draft = createCourseDraftFromMaterial(`
    CS450 - Technology and Society - Summer 2026 - CS450(A)
    Semester and Year: Summer 2026
    Professor: Alex Morgan
    Credits: 3.0
    Section Number: A
    Modality: On-campus
    Meeting Location: M/W: 9:00 AM - 11:45 AM, Classroom 201
    Office Hours: Tue: 12 to 1 By appointment in person / zoom
    Email: alex.morgan@example.edu
    COURSE GRADING POLICY
    Certifications 20%
    Final Exam 30%
    WEEKLY COURSE GUIDE
    Week 3 Web 3.0
    Assignments:
    Research Paper
    AI POLICY
    You have to use AI and cite it.
  `);
  const bus501Draft = createCourseDraftFromMaterial(`
    BUS501 Strategic Analytics Syllabus
    Semester and Year: Fall 2026
    Professor: Mina Patel
    Credits: 3
    Section Number: B
    COURSE GRADING POLICY
    Case Memo 25%
    Final Project 35%
    WEEKLY COURSE GUIDE
    Week 8 Decision Models
    Assignments:
    Midterm Exam due Oct 16, 2026 9:00am
  `);

  const first = upsertCourseFromDraft([], cs450Draft);
  const second = upsertCourseFromDraft(first.courses, bus501Draft, first.activeCourseId);
  const cs450 = second.courses.find((course) => course.code === "CS450-A");
  const bus501 = second.courses.find((course) => course.code === "BUS501");

  assert.equal(second.courses.length, 2);
  assert.equal(cs450.coursePlan.professor, "Alex Morgan");
  assert.equal(bus501.coursePlan.professor, "Mina Patel");
  assert.ok(cs450.coursePlan.weeklyGuide.some((week) => week.assignments.includes("Research Paper")));
  assert.ok(!bus501.coursePlan.weeklyGuide.some((week) => week.assignments.includes("Research Paper")));
  assert.ok(bus501.coursePlan.exams.some((exam) => exam.label === "Midterm Exam"));
  assert.ok(!cs450.coursePlan.exams.some((exam) => exam.label === "Midterm Exam"));
});

test("applyCourseContextToDraft groups assignment-only uploads into the selected course", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    CS450 Technology Strategy
    Syllabus
    Topics: AI collaboration, market analysis
    Final exam due Aug 20.
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const draft = createCourseDraftFromMaterial(`
    Research Paper
    Due: Mon Jun 22, 2026 9:00am
    50 Points Possible
    Main Report (4-5 pages)
  `);
  const contextualDraft = applyCourseContextToDraft(draft, course);
  const result = upsertCourseFromDraft([course], contextualDraft, course.id);
  const [updatedCourse] = result.courses;

  assert.equal(contextualDraft.code, "CS450");
  assert.equal(contextualDraft.name, course.name);
  assert.ok(!contextualDraft.warnings.some((warning) => warning.includes("Course code")));
  assert.ok(!contextualDraft.warnings.some((warning) => warning.includes("Course name")));
  assert.ok(contextualDraft.confidence >= 86);
  assert.ok(contextualDraft.evidence.some((item) => item.label === "Course context"));
  assert.deepEqual(updatedCourse.assignments.map((assignment) => assignment.title), ["Research Paper"]);
});

test("bindDraftToCourse forces directory uploads into the selected course", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    CS450 - Technology and Society - Summer 2026 - CS450(A)
    Semester and Year: Summer 2026
    Professor: Alex Morgan
    COURSE GRADING POLICY
    Final Exam 30%
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const misreadAssignmentDraft = createCourseDraftFromMaterial(`
    CS450 Technology Strategy > Assignments > Attend a seminar
    Due: Tue Jul 28, 2026 11:59pm
    100 Points Possible
    Max one page reflection on the seminar you attended. Please add pictures too
  `);
  const boundAssignmentDraft = bindDraftToCourse(misreadAssignmentDraft, course);
  const assignmentResult = upsertCourseFromDraft([course], boundAssignmentDraft, course.id);
  const updatedCourse = assignmentResult.courses[0];

  assert.equal(boundAssignmentDraft.code, "CS450-A");
  assert.equal(boundAssignmentDraft.name, "Technology and Society");
  assert.ok(boundAssignmentDraft.evidence.some((item) => item.label === "Course directory"));
  assert.equal(assignmentResult.courses.length, 1);
  assert.deepEqual(updatedCourse.assignments.map((assignment) => assignment.title), ["Attend a seminar"]);

  const misreadSyllabusDraft = createCourseDraftFromMaterial(`
    CS450 Technology Strategy Syllabus
    Semester and Year: Summer 2026
    Professor: Updated Professor
    COURSE GRADING POLICY
    SEMINAR 10%
  `);
  const boundSyllabusDraft = bindDraftToCourse(misreadSyllabusDraft, updatedCourse);
  const syllabusResult = upsertCourseFromDraft(assignmentResult.courses, boundSyllabusDraft, updatedCourse.id);
  const [finalCourse] = syllabusResult.courses;

  assert.equal(boundSyllabusDraft.code, "CS450-A");
  assert.equal(boundSyllabusDraft.name, "Technology and Society");
  assert.equal(syllabusResult.courses.length, 1);
  assert.deepEqual(finalCourse.assignments.map((assignment) => assignment.title), ["Attend a seminar"]);
  assert.ok(finalCourse.coursePlan.grading.some((item) => item.label === "SEMINAR" && item.weight === "10%"));
});

test("noisy Canvas screenshot OCR uses the selected course and the real assignment title", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    CS450 - Technology and Society - Summer 2026 - CS450(A)
    Semester and Year: Summer 2026
    Professor: Alex Morgan
    COURSE GRADING POLICY
    Final Exam 30%
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const noisyScreenshotDraft = createCourseDraftFromMaterial(
    `
      v A Resources | Example University x Attend a seminar xX + [818 Gemini
      @ Chrome XX HE BF HLER PE PARR FET BHO HE © J 28% = 6 Q 8 7A19HREA T#11:00
      & (¢] 25 example.instructure.com/courses/999/assignments/222?module_item_id=333 I 3% foe) Zr EfTEsEIT ER
      IN — SUMMER 2026 CS450 - A > Assignments > Attend a seminar [%) Immersive Reader
      Account Home Due: Tue Jul 28, 2026 11:59pm
      Attend a seminar 100 Points Possible
      Attempt 1
      In Progress
      NEXT UP: Submit Assignment
      Courses Unlimited Attempts Allowed
      Deta ils
      Eh Pages Max one page reflection on the seminar you attended. Please add pictures too
      Choose a submission type
      Text
      Web URL
      Media
      Upload
      Studio
      More
      |< { Previous Submit Assignment Next » iy
    `,
    "canvas-seminar.png"
  );
  const contextualDraft = applyCourseContextToDraft(noisyScreenshotDraft, course);
  const result = upsertCourseFromDraft([course], contextualDraft, course.id);
  const [updatedCourse] = result.courses;

  assert.equal(noisyScreenshotDraft.assignment, "Attend a seminar");
  assert.equal(noisyScreenshotDraft.points, "100 Points Possible");
  assert.equal(contextualDraft.code, "CS450-A");
  assert.equal(contextualDraft.name, "Technology and Society");
  assert.equal(result.courses.length, 1);
  assert.deepEqual(updatedCourse.assignments.map((assignment) => assignment.title), ["Attend a seminar"]);
  assert.equal(updatedCourse.assignments[0].dueDate, "Tue Jul 28, 2026, 11:59 PM");
  assert.equal(updatedCourse.assignments[0].points, "100 Points Possible");
  assert.ok(updatedCourse.assignments[0].details.requirements.some((item) => /Max one page reflection/i.test(item)));
  assert.ok(updatedCourse.assignments[0].tasks.some((task) => /Write a one-page reflection/i.test(task.title)));
  assert.ok(!updatedCourse.assignments[0].tasks.some((task) => /Points Possible|Eh Pages|Attendance|Previous Submit Assignment Next/i.test(task.title)));
});

test("buildAssignmentCoach explains the selected assignment in Chinese with requirements and score strategy", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    CS450 - Technology and Society - Summer 2026 - CS450(A)
    Semester and Year: Summer 2026
    Professor: Alex Morgan
    COURSE GRADING POLICY
    SEMINAR 10%
    Final Exam 30%
    AI POLICY
    You have to use AI and cite it and show us the prompts and use the QJE framework for deploying it.
  `);
  const assignmentDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 CS450 - A > Assignments > Attend a seminar
    Due: Tue Jul 28, 2026 11:59pm
    100 Points Possible
    In Progress
    NEXT UP: Submit Assignment
    Details
    Max one page reflection on the seminar you attended. Please add pictures too
    Choose a submission type
    Text
    Web URL
    Media
    Upload
    Studio
    More
  `);
  const courseCreated = upsertCourseFromDraft([], syllabusDraft);
  const merged = upsertCourseFromDraft(courseCreated.courses, assignmentDraft, courseCreated.activeCourseId);
  const course = merged.courses[0];
  const assignment = course.assignments[0];
  const coach = buildAssignmentCoach(course, assignment, "zh");

  assert.equal(coach.title, "Attend a seminar");
  assert.match(coach.summary, /参加.*seminar/i);
  assert.match(coach.summary, /一页/);
  assert.ok(coach.mustDo.some((item) => item.includes("Tue Jul 28, 2026, 11:59 PM")));
  assert.ok(coach.mustDo.some((item) => item.includes("100 Points Possible")));
  assert.ok(coach.mustDo.some((item) => /图片|pictures/i.test(item)));
  assert.ok(coach.nextSteps.some((item) => /参加.*seminar/i.test(item)));
  assert.ok(coach.nextSteps.some((item) => /一页|one-page/i.test(item)));
  assert.ok(coach.scoreStrategy.some((item) => /课程|CS450|class/i.test(item)));
  assert.ok(coach.writingHelp.some((item) => item.includes("This seminar helped me understand")));
  assert.ok(coach.riskFlags.some((item) => /due|截止|Tue Jul 28/i.test(item)));
});

test("buildCourseCoach summarizes syllabus priorities without needing a selected assignment", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    CS450 - Technology and Society - Summer 2026 - CS450(A)
    Semester and Year: Summer 2026
    Professor: Alex Morgan
    COURSE GRADING POLICY
    Certifications 20%
    SEMINAR 10%
    HW and Innovation news 40%
    Final Exam 30%
    WEEKLY COURSE GUIDE
    Week 3 Web 3.0
    Assignments:
    Research Paper
    Week 16 Finals
    Assignments:
    Finals
    LATE SUBMISSION POLICY
    Late work is allowed with notice, but there will be a penalty of 10% per week delayed.
    AI POLICY
    You have to use AI and cite it and show us the prompts and use the QJE framework for deploying it.
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const coach = buildCourseCoach(course, "zh");

  assert.equal(coach.title, "CS450-A");
  assert.match(coach.summary, /Technology and Society/);
  assert.ok(coach.priorities.some((item) => /HW and Innovation news.*40%/i.test(item)));
  assert.ok(coach.priorities.some((item) => /Final Exam.*30%/i.test(item)));
  assert.ok(coach.policyNotes.some((item) => /10% per week|每周.*10%/i.test(item)));
  assert.ok(coach.policyNotes.some((item) => /QJE|AI/i.test(item)));
  assert.ok(coach.studyFocus.some((item) => /Research Paper|Week 3/i.test(item)));
  assert.ok(coach.studyFocus.some((item) => /Finals|Week 16/i.test(item)));
});

test("createCourseFromDraft saves user-corrected screenshot fields", () => {
  const draft = createCourseDraftFromMaterial(
    `
      Chrome file edit view history
      example.instructure.com courses assignments
      Watch this vide0
      Due: Sat Jul 11, 2026 9:00am
      10 Points Possible
      NEXT UP: Submit Assignment
    `,
    "canvas-assignment.png"
  );

  const course = createCourseFromDraft({
    ...draft,
    code: "CS450-A",
    name: "SUMMER 2026 CS450 - A",
    assignment: "Watch this video",
    dueDate: "Sat Jul 11, 2026, 9:00 AM",
    points: "10 Points Possible",
    linksText: "https://www.youtube.com/watch?v=Z-k8Wm2uQmw",
    tasksText: "Submit Assignment\nwrite watched after you complete. focus on the eval and execution part"
  });

  assert.equal(course.code, "CS450-A");
  assert.equal(course.name, "SUMMER 2026 CS450 - A");
  assert.equal(course.nextDue, "Watch this video");
  assert.equal(course.dueDate, "Sat Jul 11, 2026, 9:00 AM");
  assert.deepEqual(
    course.tasks.map((task) => task.title),
    [
      "Submit Assignment",
      "write watched after you complete. focus on the eval and execution part"
    ]
  );
  assert.match(course.notes, /10 Points Possible/);
  assert.match(course.notes, /youtube\.com\/watch\?v=Z-k8Wm2uQmw/);
});

test("addTaskToCourse appends a user task without changing existing task state", () => {
  const course = createCourseFromInput({
    code: "ENG201",
    name: "Writing",
    tasksText: "Draft outline"
  });
  const updated = addTaskToCourse(course, "Ask professor about citation format");

  assert.equal(updated.tasks.length, 2);
  assert.equal(updated.tasks[0].done, false);
  assert.equal(updated.tasks[1].title, "Ask professor about citation format");
  assert.equal(updated.tasks[1].id, "eng201-writing-task-2");
});

test("mergeCourseDeadlines adds syllabus deadlines to a user course", () => {
  const course = createCourseFromInput({
    code: "BUS300",
    name: "Strategy",
    deadlineLabel: "Case memo",
    dueDate: "2026-08-01"
  });
  const analysis = analyzeSyllabus("Team presentation due Aug 12. Final report due Aug 28.");
  const updated = mergeCourseDeadlines(course, analysis.deadlines);

  assert.equal(updated.deadlines.length, 3);
  assert.deepEqual(
    updated.deadlines.map((deadline) => deadline.label),
    ["Case memo", "Team presentation", "Final report"]
  );
});

test("removeCourseById removes a course and returns the next active course", () => {
  const first = createCourseFromInput({ code: "A", name: "Alpha" });
  const second = createCourseFromInput({ code: "B", name: "Beta" });
  const result = removeCourseById([first, second], first.id);

  assert.deepEqual(
    result.courses.map((course) => course.id),
    [second.id]
  );
  assert.equal(result.activeCourseId, second.id);
});

test("removeCourseById keeps the active course when deleting another course", () => {
  const first = createCourseFromInput({ code: "A", name: "Alpha" });
  const second = createCourseFromInput({ code: "B", name: "Beta" });
  const third = createCourseFromInput({ code: "C", name: "Gamma" });
  const result = removeCourseById([first, second, third], third.id, second.id);

  assert.deepEqual(
    result.courses.map((course) => course.id),
    [first.id, second.id]
  );
  assert.equal(result.activeCourseId, second.id);
});

test("getActionAvailability explains why course-dependent buttons are unavailable", () => {
  const state = getActionAvailability({
    hasCourse: false,
    material: "",
    deadlineCount: 0,
    taskTitle: "",
    courseCount: 0
  });

  assert.equal(state.buildCourse.enabled, false);
  assert.match(state.buildCourse.message, /Paste course material/);
  assert.equal(state.addTask.enabled, false);
  assert.match(state.addTask.message, /Import a course/);
  assert.equal(state.addDeadlines.enabled, false);
  assert.match(state.addDeadlines.message, /Analyze class text/);
  assert.equal(state.deleteCourse.enabled, false);
  assert.equal(state.clearData.enabled, false);
});

test("getActionAvailability enables actions when required data exists", () => {
  const state = getActionAvailability({
    hasCourse: true,
    material: "MATH208 Probability\nHomework due Aug 15",
    deadlineCount: 2,
    taskTitle: "Review notes",
    courseCount: 1
  });

  assert.equal(state.buildCourse.enabled, true);
  assert.equal(state.addTask.enabled, true);
  assert.equal(state.addDeadlines.enabled, true);
  assert.equal(state.deleteCourse.enabled, true);
  assert.equal(state.clearData.enabled, true);
});

test("getCourseImportFileKind identifies text files and screenshots", () => {
  assert.equal(
    getCourseImportFileKind({ name: "syllabus.txt", type: "text/plain" }),
    "text"
  );
  assert.equal(
    getCourseImportFileKind({ name: "assignment-screenshot.png", type: "image/png" }),
    "image"
  );
  assert.equal(
    getCourseImportFileKind({ name: "canvas-upload.jpeg", type: "" }),
    "image"
  );
  assert.equal(
    getCourseImportFileKind({ name: "slides.pdf", type: "application/pdf" }),
    "unsupported"
  );
});
