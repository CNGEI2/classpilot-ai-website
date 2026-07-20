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
  createCourseDraftFromMaterial,
  createCourseFromDraft,
  createCourseFromMaterial,
  createCourseFromInput,
  groupAssignmentsByCategory,
  getCourseImportFileKind,
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
    "Week 3: Quiz 1 due Aug 12. Final project proposal due September 4. Final exam on Dec 10."
  );

  assert.equal(result.deadlines.length, 3);
  assert.equal(result.deadlines[0].label, "Quiz 1");
  assert.equal(result.deadlines[1].date, "Sep 4");
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
  `);

  assert.equal(course.code, "MATH208");
  assert.equal(course.name, "Probability");
  assert.equal(course.nextDue, "Homework 1");
  assert.equal(course.dueDate, "Aug 15");
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
      SUMMER 2026 AI450 - A > Assignments > Watch this video
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
    "截屏2026-07-08 下午9.24.49.png"
  );

  assert.equal(course.code, "AI450-A");
  assert.equal(course.name, "SUMMER 2026 AI450 - A");
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
      SUMMER 2026 AI450 - A > Assignments > Attend a seminar
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
    "截屏2026-07-19 下午11.00.18.png"
  );

  assert.equal(draft.sourceType, "Canvas assignment page");
  assert.equal(draft.code, "AI450-A");
  assert.equal(draft.name, "SUMMER 2026 AI450 - A");
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
    SUMMER 2026 AI450 - A > Assignments > Watch this video
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
  assert.ok(draft.evidence.some((item) => item.label === "Course" && item.value === "SUMMER 2026 AI450 - A"));
  assert.ok(draft.evidence.some((item) => item.label === "Due" && item.value === "Sat Jul 11, 2026, 9:00 AM"));
  assert.match(draft.tasksText, /Watch the linked video/);
  assert.ok(draft.actionPlan.some((item) => item.includes("Submit before Sat Jul 11, 2026, 9:00 AM")));
});

test("createCourseDraftFromMaterial flags low-confidence OCR instead of pretending it knows the course", () => {
  const draft = createCourseDraftFromMaterial(
    `
      Chrome file edit view history
      sfbu.instructure.com courses assignments
      Watch this vide0
      Due: Sat Jul 11, 2026 9:00am
      10 Points Possible
      NEXT UP: Submit Assignment
    `,
    "截屏2026-07-08 下午9.24.49.png"
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
    Satoshi Paper
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
  assert.equal(draft.assignment, "Satoshi Paper");
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

test("upsertCourseFromDraft groups multiple uploads under the same course and assignment subtitles", () => {
  const firstDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 AI450 - A > Assignments > Watch this video
    Due: Sat Jul 11, 2026 9:00am
    10 Points Possible
    NEXT UP: Submit Assignment
    https://www.youtube.com/watch?v=Z-k8Wm2uQmw
  `);
  const secondDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 AI450 - A > Assignments > Satoshi Paper
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
  assert.equal(course.code, "AI450-A");
  assert.equal(course.name, "SUMMER 2026 AI450 - A");
  assert.deepEqual(
    course.assignments.map((assignment) => assignment.title),
    ["Watch this video", "Satoshi Paper"]
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
      ["Feedback", ["Satoshi Paper"]]
    ]
  );
});

test("upsertCourseFromDraft refuses to group an assignment when course identity is missing", () => {
  const draft = createCourseDraftFromMaterial(`
    Satoshi Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    50 Points Possible
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
  `);
  const result = upsertCourseFromDraft([], draft);

  assert.equal(result.action, "needs-course");
  assert.equal(result.courses.length, 0);
  assert.equal(result.assignment.title, "Satoshi Paper");
  assert.match(result.message, /Course identity/);
});

test("upsertCourseFromDraft merges a reviewed assignment-only page into an existing course", () => {
  const existingDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 AI450 - A > Assignments > Watch this video
    Due: Sat Jul 11, 2026 9:00am
    10 Points Possible
    NEXT UP: Submit Assignment
  `);
  const assignmentOnlyDraft = createCourseDraftFromMaterial(`
    Satoshi Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    50 Points Possible
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
  `);
  const first = upsertCourseFromDraft([], existingDraft);
  const reviewed = {
    ...assignmentOnlyDraft,
    code: "AI450-A",
    name: "SUMMER 2026 AI450 - A",
    warnings: []
  };
  const merged = upsertCourseFromDraft(first.courses, reviewed, first.activeCourseId);

  assert.equal(merged.action, "merged");
  assert.equal(merged.courses.length, 1);
  assert.deepEqual(
    merged.courses[0].assignments.map((assignment) => assignment.title),
    ["Watch this video", "Satoshi Paper"]
  );
});

test("createCourseDraftFromMaterial turns a full assignment prompt into requirements and completion steps", () => {
  const draft = createCourseDraftFromMaterial(`
    Satoshi Paper
    Due: Mon Jun 22, 2026 9:00am
    Late
    Ungraded, 50 Possible Points
    50 Points Possible
    Submitted on Jul 5, 2026 12:51pm
    NEXT UP: Review Feedback
    https://www.zouantcha.com/blog/bitcoin-whitepaper

    Assignment Overview
    Read Satoshi Nakamoto's original Bitcoin white paper "Bitcoin: A Peer-to-Peer Electronic Cash System" (2008) and complete a strategic analysis that demonstrates your ability to synthesize AI insights with original critical thinking.

    Required Reading
    Nakamoto, S. (2008). Bitcoin: A Peer-to-Peer Electronic Cash System. Available at: bitcoin.org/bitcoin.pdf
    Core Assignment Tasks
    Task 1: Contextualized Problem Analysis (20%) extra credit
    Interview one professional in finance/technology (or conduct primary research) to validate or challenge AI insights about market conditions
    Task 2: Competitive Intelligence Integration (25%)
    Use AI to identify Bitcoin's competitors in 2008-2010 vs today
    Task 3: Stakeholder Impact Assessment (25%)
    Interview or survey at least 3 real individuals from different stakeholder groups
    Task 4: Future Scenario Planning (20%)
    Prompt AI to generate 3 scenarios for Bitcoin's evolution over the next decade
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

  assert.equal(draft.assignment, "Satoshi Paper");
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
    AI450 Applied AI Strategy
    Syllabus
    Topics: AI collaboration, market analysis, stakeholder interviews
    Midterm exam due Jul 30.
    Final project due Aug 20.
    Office hours: Wednesday 2pm
    Grading policy: projects and participation
  `);
  const assignmentDraft = createCourseDraftFromMaterial(`
    AI450 Applied AI Strategy > Assignments > Satoshi Paper
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
  assert.deepEqual(course.assignments.map((assignment) => assignment.title), ["Satoshi Paper"]);
});

test("createCourseDraftFromMaterial allows a syllabus without assignment due fields", () => {
  const draft = createCourseDraftFromMaterial(`
    AI450 Applied AI Strategy
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

test("createCourseDraftFromMaterial treats the real AI450 syllabus as course-level data", () => {
  const draft = createCourseDraftFromMaterial(`
    AI450 - AI in Modern Day Society: A Survey - Summer 2026 - AI450(A)

    Semester and Year: Summer 2026
    Professor: Shalini Gopalkrishnan
    Credits: 3.0
    Section Number: A
    Modality: On-campus
    Meeting Location: M/W: 9:00 AM - 11:45 AM, Classroom 201
    Office Hours: Tue: 12 to 1 By appointment in person / zoom
    Email: shalini.gopalkrishnan@sfbu.edu

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
    Weekly Innovation Report; Presentations; Satoshi Paper
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
  assert.equal(draft.code, "AI450-A");
  assert.equal(draft.name, "AI in Modern Day Society: A Survey");
  assert.equal(draft.coursePlan.syllabusUploaded, true);
  assert.equal(draft.coursePlan.term, "Summer 2026");
  assert.equal(draft.coursePlan.professor, "Shalini Gopalkrishnan");
  assert.equal(draft.coursePlan.credits, "3.0");
  assert.equal(draft.coursePlan.section, "A");
  assert.equal(draft.coursePlan.modality, "On-campus");
  assert.equal(draft.coursePlan.meetingLocation, "M/W: 9:00 AM - 11:45 AM, Classroom 201");
  assert.equal(draft.coursePlan.officeHours, "Tue: 12 to 1 By appointment in person / zoom");
  assert.equal(draft.coursePlan.email, "shalini.gopalkrishnan@sfbu.edu");
  assert.ok(draft.coursePlan.grading.some((item) => item.label === "Final Exam" && item.weight === "30%"));
  assert.ok(draft.coursePlan.weeklyGuide.some((week) => week.week === "Week 3" && week.topic === "Web 3.0" && week.assignments.includes("Satoshi Paper")));
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
  const ai450Draft = createCourseDraftFromMaterial(`
    AI450 - AI in Modern Day Society: A Survey - Summer 2026 - AI450(A)
    Semester and Year: Summer 2026
    Professor: Shalini Gopalkrishnan
    Credits: 3.0
    Section Number: A
    Modality: On-campus
    Meeting Location: M/W: 9:00 AM - 11:45 AM, Classroom 201
    Office Hours: Tue: 12 to 1 By appointment in person / zoom
    Email: shalini.gopalkrishnan@sfbu.edu
    COURSE GRADING POLICY
    Certifications 20%
    Final Exam 30%
    WEEKLY COURSE GUIDE
    Week 3 Web 3.0
    Assignments:
    Satoshi Paper
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

  const first = upsertCourseFromDraft([], ai450Draft);
  const second = upsertCourseFromDraft(first.courses, bus501Draft, first.activeCourseId);
  const ai450 = second.courses.find((course) => course.code === "AI450-A");
  const bus501 = second.courses.find((course) => course.code === "BUS501");

  assert.equal(second.courses.length, 2);
  assert.equal(ai450.coursePlan.professor, "Shalini Gopalkrishnan");
  assert.equal(bus501.coursePlan.professor, "Mina Patel");
  assert.ok(ai450.coursePlan.weeklyGuide.some((week) => week.assignments.includes("Satoshi Paper")));
  assert.ok(!bus501.coursePlan.weeklyGuide.some((week) => week.assignments.includes("Satoshi Paper")));
  assert.ok(bus501.coursePlan.exams.some((exam) => exam.label === "Midterm Exam"));
  assert.ok(!ai450.coursePlan.exams.some((exam) => exam.label === "Midterm Exam"));
});

test("applyCourseContextToDraft groups assignment-only uploads into the selected course", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    AI450 Applied AI Strategy
    Syllabus
    Topics: AI collaboration, market analysis
    Final exam due Aug 20.
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const draft = createCourseDraftFromMaterial(`
    Satoshi Paper
    Due: Mon Jun 22, 2026 9:00am
    50 Points Possible
    Main Report (4-5 pages)
  `);
  const contextualDraft = applyCourseContextToDraft(draft, course);
  const result = upsertCourseFromDraft([course], contextualDraft, course.id);
  const [updatedCourse] = result.courses;

  assert.equal(contextualDraft.code, "AI450");
  assert.equal(contextualDraft.name, course.name);
  assert.ok(!contextualDraft.warnings.some((warning) => warning.includes("Course code")));
  assert.ok(!contextualDraft.warnings.some((warning) => warning.includes("Course name")));
  assert.ok(contextualDraft.confidence >= 86);
  assert.ok(contextualDraft.evidence.some((item) => item.label === "Course context"));
  assert.deepEqual(updatedCourse.assignments.map((assignment) => assignment.title), ["Satoshi Paper"]);
});

test("bindDraftToCourse forces directory uploads into the selected course", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    AI450 - AI in Modern Day Society: A Survey - Summer 2026 - AI450(A)
    Semester and Year: Summer 2026
    Professor: Shalini Gopalkrishnan
    COURSE GRADING POLICY
    Final Exam 30%
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const misreadAssignmentDraft = createCourseDraftFromMaterial(`
    AI450 Applied AI Strategy > Assignments > Attend a seminar
    Due: Tue Jul 28, 2026 11:59pm
    100 Points Possible
    Max one page reflection on the seminar you attended. Please add pictures too
  `);
  const boundAssignmentDraft = bindDraftToCourse(misreadAssignmentDraft, course);
  const assignmentResult = upsertCourseFromDraft([course], boundAssignmentDraft, course.id);
  const updatedCourse = assignmentResult.courses[0];

  assert.equal(boundAssignmentDraft.code, "AI450-A");
  assert.equal(boundAssignmentDraft.name, "AI in Modern Day Society: A Survey");
  assert.ok(boundAssignmentDraft.evidence.some((item) => item.label === "Course directory"));
  assert.equal(assignmentResult.courses.length, 1);
  assert.deepEqual(updatedCourse.assignments.map((assignment) => assignment.title), ["Attend a seminar"]);

  const misreadSyllabusDraft = createCourseDraftFromMaterial(`
    AI450 Applied AI Strategy Syllabus
    Semester and Year: Summer 2026
    Professor: Updated Professor
    COURSE GRADING POLICY
    SEMINAR 10%
  `);
  const boundSyllabusDraft = bindDraftToCourse(misreadSyllabusDraft, updatedCourse);
  const syllabusResult = upsertCourseFromDraft(assignmentResult.courses, boundSyllabusDraft, updatedCourse.id);
  const [finalCourse] = syllabusResult.courses;

  assert.equal(boundSyllabusDraft.code, "AI450-A");
  assert.equal(boundSyllabusDraft.name, "AI in Modern Day Society: A Survey");
  assert.equal(syllabusResult.courses.length, 1);
  assert.deepEqual(finalCourse.assignments.map((assignment) => assignment.title), ["Attend a seminar"]);
  assert.ok(finalCourse.coursePlan.grading.some((item) => item.label === "SEMINAR" && item.weight === "10%"));
});

test("noisy Canvas screenshot OCR uses the selected course and the real assignment title", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    AI450 - AI in Modern Day Society: A Survey - Summer 2026 - AI450(A)
    Semester and Year: Summer 2026
    Professor: Shalini Gopalkrishnan
    COURSE GRADING POLICY
    Final Exam 30%
  `);
  const course = upsertCourseFromDraft([], syllabusDraft).courses[0];
  const noisyScreenshotDraft = createCourseDraftFromMaterial(
    `
      v A Resources | San Francisco x Attend a seminar xX + [818 Gemini
      @ Chrome XX HE BF HLER PE PARR FET BHO HE © J 28% = 6 Q 8 7A19HREA T#11:00
      & (¢] 25 sfbu.instructure.com/courses/1742/assignments/30213?module_item_id=87010 I 3% foe) Zr EfTEsEIT ER
      IN — SUMMER 2026 AI450 - A > Assignments > Attend a seminar [%) Immersive Reader
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
    "截屏2026-07-19 下午11.00.18.png"
  );
  const contextualDraft = applyCourseContextToDraft(noisyScreenshotDraft, course);
  const result = upsertCourseFromDraft([course], contextualDraft, course.id);
  const [updatedCourse] = result.courses;

  assert.equal(noisyScreenshotDraft.assignment, "Attend a seminar");
  assert.equal(noisyScreenshotDraft.points, "100 Points Possible");
  assert.equal(contextualDraft.code, "AI450-A");
  assert.equal(contextualDraft.name, "AI in Modern Day Society: A Survey");
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
    AI450 - AI in Modern Day Society: A Survey - Summer 2026 - AI450(A)
    Semester and Year: Summer 2026
    Professor: Shalini Gopalkrishnan
    COURSE GRADING POLICY
    SEMINAR 10%
    Final Exam 30%
    AI POLICY
    You have to use AI and cite it and show us the prompts and use the QJE framework for deploying it.
  `);
  const assignmentDraft = createCourseDraftFromMaterial(`
    SUMMER 2026 AI450 - A > Assignments > Attend a seminar
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
  assert.ok(coach.scoreStrategy.some((item) => /课程|AI450|class/i.test(item)));
  assert.ok(coach.writingHelp.some((item) => item.includes("This seminar helped me understand")));
  assert.ok(coach.riskFlags.some((item) => /due|截止|Tue Jul 28/i.test(item)));
});

test("buildCourseCoach summarizes syllabus priorities without needing a selected assignment", () => {
  const syllabusDraft = createCourseDraftFromMaterial(`
    AI450 - AI in Modern Day Society: A Survey - Summer 2026 - AI450(A)
    Semester and Year: Summer 2026
    Professor: Shalini Gopalkrishnan
    COURSE GRADING POLICY
    Certifications 20%
    SEMINAR 10%
    HW and Innovation news 40%
    Final Exam 30%
    WEEKLY COURSE GUIDE
    Week 3 Web 3.0
    Assignments:
    Satoshi Paper
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

  assert.equal(coach.title, "AI450-A");
  assert.match(coach.summary, /AI in Modern Day Society/);
  assert.ok(coach.priorities.some((item) => /HW and Innovation news.*40%/i.test(item)));
  assert.ok(coach.priorities.some((item) => /Final Exam.*30%/i.test(item)));
  assert.ok(coach.policyNotes.some((item) => /10% per week|每周.*10%/i.test(item)));
  assert.ok(coach.policyNotes.some((item) => /QJE|AI/i.test(item)));
  assert.ok(coach.studyFocus.some((item) => /Satoshi Paper|Week 3/i.test(item)));
  assert.ok(coach.studyFocus.some((item) => /Finals|Week 16/i.test(item)));
});

test("createCourseFromDraft saves user-corrected screenshot fields", () => {
  const draft = createCourseDraftFromMaterial(
    `
      Chrome file edit view history
      sfbu.instructure.com courses assignments
      Watch this vide0
      Due: Sat Jul 11, 2026 9:00am
      10 Points Possible
      NEXT UP: Submit Assignment
    `,
    "截屏2026-07-08 下午9.24.49.png"
  );

  const course = createCourseFromDraft({
    ...draft,
    code: "AI450-A",
    name: "SUMMER 2026 AI450 - A",
    assignment: "Watch this video",
    dueDate: "Sat Jul 11, 2026, 9:00 AM",
    points: "10 Points Possible",
    linksText: "https://www.youtube.com/watch?v=Z-k8Wm2uQmw",
    tasksText: "Submit Assignment\nwrite watched after you complete. focus on the eval and execution part"
  });

  assert.equal(course.code, "AI450-A");
  assert.equal(course.name, "SUMMER 2026 AI450 - A");
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
