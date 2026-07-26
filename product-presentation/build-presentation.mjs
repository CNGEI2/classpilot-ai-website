import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = `${ROOT}/product-presentation/.build`;
const OUTPUT = `${ROOT}/product-presentation/ClassPilot-AI-Product-Introduction.pptx`;
const DESKTOP = `${BUILD}/coach-desktop.png`;
const CONVERSATION = `${BUILD}/coach-conversation.png`;
const CONVERSATION_MOBILE = `${BUILD}/coach-conversation-mobile.png`;

const C = {
  ink: "#141C22",
  muted: "#647078",
  canvas: "#F6F7F3",
  paper: "#FFFFFF",
  panel: "#E8ECE9",
  rule: "#C8CECA",
  teal: "#2F7D74",
  tealSoft: "#DCECE8",
  gold: "#C9A63F",
  goldSoft: "#F2EEDC",
  red: "#B9504A",
};

const W = 1280;
const H = 720;
const FONT = "Arial";

function shape(slide, name, left, top, width, height, fill = "none", line = "none", geometry = "rect") {
  return slide.shapes.add({
    geometry,
    name,
    position: { left, top, width, height },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
  });
}

function textBox(slide, name, text, left, top, width, height, options = {}) {
  const box = shape(slide, name, left, top, width, height, options.fill || "none", options.line || "none", options.geometry || "textbox");
  box.text = text;
  box.text.style = {
    fontFamily: FONT,
    fontSize: options.fontSize || 24,
    color: options.color || C.ink,
    bold: Boolean(options.bold),
    alignment: options.alignment || "left",
    verticalAlignment: options.verticalAlignment || "top",
  };
  return box;
}

function rule(slide, left, top, width, color = C.rule, height = 1) {
  return shape(slide, `rule-${left}-${top}`, left, top, width, height, color, "none");
}

function baseSlide(presentation, section, page) {
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  textBox(slide, `section-${page}`, section.toUpperCase(), 48, 34, 420, 24, {
    fontSize: 13,
    color: C.teal,
    bold: true,
  });
  textBox(slide, `page-${page}`, String(page).padStart(2, "0"), 1184, 34, 48, 24, {
    fontSize: 13,
    color: C.muted,
    bold: true,
    alignment: "right",
  });
  rule(slide, 48, 66, 1184);
  return slide;
}

function title(slide, value, subtitle = "") {
  textBox(slide, `title-${value}`, value, 48, 88, 1160, 76, { fontSize: 43, bold: true });
  if (subtitle) textBox(slide, `subtitle-${value}`, subtitle, 50, 166, 1120, 46, { fontSize: 20, color: C.muted });
}

function label(slide, value, left, top, width, fill = C.tealSoft, color = C.teal) {
  textBox(slide, `label-${value}-${left}`, value.toUpperCase(), left, top, width, 30, {
    fontSize: 12,
    color,
    bold: true,
    alignment: "center",
    verticalAlignment: "middle",
    fill,
    line: fill,
    geometry: "roundRect",
  });
}

function addImage(slide, bytes, alt, left, top, width, height, crop = undefined, fit = "cover") {
  return slide.images.add({
    blob: bytes,
    contentType: "image/png",
    alt,
    fit,
    position: { left, top, width, height },
    crop,
    geometry: "roundRect",
    borderRadius: 7,
  });
}

function notes(slide, body, sources) {
  slide.speakerNotes.textFrame.setText(`${body}\n\n[Sources]\n${sources.map((s) => `- ${s}`).join("\n")}\n[/Sources]`);
}

function numberedStep(slide, number, heading, body, left, top, width) {
  shape(slide, `step-number-${number}`, left, top, 48, 48, C.teal, C.teal, "ellipse");
  textBox(slide, `step-digit-${number}`, String(number), left, top + 5, 48, 36, {
    fontSize: 20,
    color: C.paper,
    bold: true,
    alignment: "center",
    verticalAlignment: "middle",
  });
  textBox(slide, `step-heading-${number}`, heading, left, top + 72, width, 42, { fontSize: 22, bold: true });
  textBox(slide, `step-body-${number}`, body, left, top + 122, width, 94, { fontSize: 17, color: C.muted });
}

async function main() {
  await fs.mkdir(BUILD, { recursive: true });
  const desktopBytes = await fs.readFile(DESKTOP);
  const conversationBytes = await fs.readFile(CONVERSATION);
  const conversationMobileBytes = await fs.readFile(CONVERSATION_MOBILE);
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // 1. Cover
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.ink;
    shape(slide, "cover-accent", 0, 0, 14, H, C.teal, C.teal);
    textBox(slide, "cover-kicker", "CLASS PILOT AI", 60, 54, 420, 28, { fontSize: 14, color: C.gold, bold: true });
    textBox(slide, "cover-title", "Turn course material\ninto the next right action.", 60, 140, 520, 210, {
      fontSize: 50,
      color: C.paper,
      bold: true,
    });
    textBox(slide, "cover-body", "A private student workspace that reads course material, builds a plan, checks the final file, and coaches the student in a live conversation.", 62, 390, 500, 108, {
      fontSize: 21,
      color: "#CAD1D4",
    });
    label(slide, "Product introduction", 62, 548, 190, C.goldSoft, "#725E16");
    shape(slide, "cover-screen-frame", 626, 82, 590, 544, C.paper, "#49545B", "roundRect");
    addImage(slide, desktopBytes, "ClassPilot AI Coach product screenshot", 642, 98, 558, 512, { left: 0, top: 0, right: 0, bottom: 0.36 });
    notes(slide, "Introduce ClassPilot AI as a finished student workspace. The live conversational Coach is one part of a broader loop from course import to final submission check.", ["ClassPilot AI live product screenshot, captured July 25, 2026."]);
  }

  // 2. Problem
  {
    const slide = baseSlide(presentation, "The student problem", 2);
    title(slide, "Students do not need another dashboard.", "They need scattered course information turned into a clear, trustworthy plan.");
    const cards = [
      ["01", "Course context gets lost", "A screenshot, syllabus, and assignment page often describe the same course, but ordinary tools treat them as unrelated files."],
      ["02", "Requirements hide in long pages", "Due dates, points, deliverables, submission rules, and rubric language compete for attention."],
      ["03", "Planning still happens manually", "Even after reading the prompt, the student must translate it into steps, evidence, checks, and a realistic next action."],
    ];
    cards.forEach((item, i) => {
      const left = 48 + i * 398;
      shape(slide, `problem-card-${i}`, left, 254, 366, 352, i === 1 ? C.tealSoft : C.paper, C.rule, "roundRect");
      textBox(slide, `problem-number-${i}`, item[0], left + 26, 282, 70, 32, { fontSize: 14, color: C.teal, bold: true });
      textBox(slide, `problem-title-${i}`, item[1], left + 26, 344, 310, 76, { fontSize: 27, bold: true });
      textBox(slide, `problem-body-${i}`, item[2], left + 26, 446, 310, 126, { fontSize: 18, color: C.muted });
    });
    notes(slide, "Describe the problem as an information-to-action gap, not a lack of calendars or note-taking tools.", ["ClassPilot AI product requirements and observed Canvas assignment workflows, July 2026."]);
  }

  // 3. Workflow
  {
    const slide = baseSlide(presentation, "Product workflow", 3);
    title(slide, "Upload once. Keep every fact with the right course.", "Importing inside a course removes identity guesswork and prevents syllabus and assignment uploads from splitting into duplicates.");
    const steps = [
      ["Import once", "Upload a screenshot, assignment text, PDF, DOCX, or syllabus directly inside the course."],
      ["Extract facts", "Capture course name, assignment title, due date, points, status, requirements, and deliverables."],
      ["Organize by course", "Keep syllabus-level exams and policies separate from assignment-level tasks and evidence."],
      ["Build the work", "Create tasks, a study schedule, a next action, and evidence-grounded Coach context."],
    ];
    steps.forEach((item, i) => {
      const left = 58 + i * 302;
      numberedStep(slide, i + 1, item[0], item[1], left, 278, 250);
      if (i < steps.length - 1) {
        rule(slide, left + 58, 302, 214, C.rule, 2);
        shape(slide, `arrow-${i}`, left + 258, 296, 13, 13, C.rule, C.rule, "triangle");
      }
    });
    textBox(slide, "workflow-result", "RESULT  /  One course workspace holds its assignments, syllabus, schedule, submission checks, and Coach history.", 58, 594, 1150, 44, {
      fontSize: 17,
      color: C.teal,
      bold: true,
    });
    notes(slide, "Walk through the course-bound import flow. The selected course is authoritative, while global import remains available when the course is genuinely unknown.", ["ClassPilot AI implementation: course-bound import flow, source evidence catalog, and content parser, July 2026."]);
  }

  // 4. Full learning loop
  {
    const slide = baseSlide(presentation, "The product", 4);
    title(slide, "ClassPilot closes the loop from prompt to submission.", "Each feature uses the same course record, so the student's plan stays connected to the original evidence.");
    const stages = [
      ["Import", "Screenshot, text, PDF, DOCX, PPTX"],
      ["Understand", "Facts, requirements, rubric, dates"],
      ["Plan", "Tasks and adaptive study sessions"],
      ["Focus", "One next action on Today"],
      ["Check", "Rubric fit, file quality, AI-writing reminder"],
      ["Coach", "Live follow-up conversation with citations"],
    ];
    stages.forEach((item, i) => {
      const left = 50 + i * 198;
      shape(slide, `loop-node-${i}`, left, 276, 46, 46, i === 5 ? C.gold : C.teal, i === 5 ? C.gold : C.teal, "ellipse");
      textBox(slide, `loop-number-${i}`, String(i + 1), left, 282, 46, 30, { fontSize: 18, color: C.paper, bold: true, alignment: "center", verticalAlignment: "middle" });
      textBox(slide, `loop-title-${i}`, item[0], left, 350, 166, 36, { fontSize: 21, bold: true });
      textBox(slide, `loop-body-${i}`, item[1], left, 400, 166, 100, { fontSize: 16, color: C.muted });
      if (i < stages.length - 1) {
        rule(slide, left + 52, 298, 132, C.rule, 2);
        shape(slide, `loop-arrow-${i}`, left + 170, 292, 14, 14, C.rule, C.rule, "triangle");
      }
    });
    shape(slide, "loop-result-band", 50, 574, 1180, 62, C.ink, C.ink, "roundRect");
    textBox(slide, "loop-result", "The student always knows what the source said, what remains, and what to do next.", 74, 589, 1132, 34, { fontSize: 20, color: C.paper, bold: true, alignment: "center" });
    notes(slide, "Present the product as one connected learning loop rather than a collection of utilities. The same selected course and assignment context flows through every step.", ["ClassPilot AI implementation: import, planning, Today focus, submission checker, and Coach modules, July 2026."]);
  }

  // 5. Conversational Coach
  {
    const slide = baseSlide(presentation, "Live AI Coach", 5);
    title(slide, "The Coach is a real multi-turn conversation.", "Students can ask a question, challenge the answer, request a plan, and act on the next steps without leaving the assignment.");
    shape(slide, "coach-screen-frame", 48, 232, 742, 416, C.paper, C.rule, "roundRect");
    addImage(slide, conversationBytes, "Live ClassPilot Coach conversation with course evidence and a three-day plan", 62, 246, 714, 388, { left: 0.17, top: 0.1, right: 0, bottom: 0.05 });
    const items = [
      ["FOLLOW UP", "Conversation history stays scoped to the selected course and assignment."],
      ["VERIFY", "Evidence chips point back to exact due dates, requirements, and rubric text."],
      ["ACT", "Any suggested next step can be added directly to the assignment checklist."],
    ];
    items.forEach((item, i) => {
      const top = 252 + i * 124;
      textBox(slide, `coach-label-${i}`, item[0], 830, top, 110, 28, { fontSize: 13, color: i === 1 ? "#725E16" : C.teal, bold: true });
      textBox(slide, `coach-copy-${i}`, item[1], 830, top + 36, 380, 70, { fontSize: 19, color: C.muted });
      if (i < 2) rule(slide, 830, top + 110, 380);
    });
    notes(slide, "Show the two-turn live conversation. The Coach first identifies the easiest-to-miss requirement, then converts that advice into a three-day plan with evidence citations and actionable steps.", ["ClassPilot AI live product screenshot and Workers AI response, captured July 25, 2026."]);
  }

  // 6. Planning and submission intelligence
  {
    const slide = baseSlide(presentation, "Daily workflow", 6);
    title(slide, "Planning and final checks stay connected.", "ClassPilot supports the quiet work between importing an assignment and actually submitting it.");
    const rows = [
      ["TODAY", "One-click focus", "Shows one next action, starts a focus session, and advances when a checklist item is completed."],
      ["SCHEDULE", "Adaptive study plan", "Creates calendar sessions from due dates and unfinished work, then replans after progress changes."],
      ["FINAL CHECK", "Submission readiness", "Reads the uploaded file once, checks rubric coverage and deliverables, estimates a score range, and warns when AI-writing signals exceed 20%."],
      ["CANVAS", "Read-only sync", "Imports active courses, syllabus content, assignments, dates, points, and submission state through scoped OAuth."],
    ];
    rows.forEach((item, i) => {
      const top = 238 + i * 92;
      textBox(slide, `daily-tag-${i}`, item[0], 58, top + 7, 132, 26, { fontSize: 12, color: i === 2 ? "#725E16" : C.teal, bold: true });
      textBox(slide, `daily-title-${i}`, item[1], 218, top, 260, 38, { fontSize: 23, bold: true });
      textBox(slide, `daily-copy-${i}`, item[2], 502, top, 704, 58, { fontSize: 17, color: C.muted });
      rule(slide, 58, top + 72, 1148);
    });
    shape(slide, "canvas-boundary", 58, 620, 1148, 38, C.goldSoft, C.goldSoft, "roundRect");
    textBox(slide, "canvas-boundary-text", "Canvas connection code is complete; live school access still requires an administrator-approved Developer Key.", 76, 628, 1112, 24, { fontSize: 15, color: "#725E16", bold: true, alignment: "center" });
    notes(slide, "Explain how ClassPilot supports execution, not only import. Be transparent that the Canvas OAuth flow is implemented but institutional approval is an external prerequisite.", ["ClassPilot AI Today, study scheduler, submission checker, and Canvas connector implementations, July 2026.", "Canvas LMS OAuth2 documentation: https://developerdocs.instructure.com/services/canvas/oauth2"]);
  }

  // 7. Secure live architecture
  {
    const slide = baseSlide(presentation, "Secure architecture", 7);
    title(slide, "Live AI stays bounded to the selected work.", "The browser sends only the selected context; the Worker validates it and returns a structured, evidence-grounded response.");
    const nodes = [
      ["01", "Browser", "Local workspace and scoped conversation"],
      ["02", "Context builder", "Selected course, assignment, and sources"],
      ["03", "Cloudflare Worker", "CORS, size limits, rate limits, validation"],
      ["04", "Workers AI", "Live answer, citations, next steps"],
    ];
    nodes.forEach((n, i) => {
      const left = 54 + i * 302;
      shape(slide, `architecture-node-${i}`, left, 270, 244, 218, i === 2 ? C.ink : C.paper, i === 2 ? C.ink : C.rule, "roundRect");
      textBox(slide, `architecture-index-${i}`, n[0], left + 22, 292, 48, 28, { fontSize: 13, color: i === 2 ? C.gold : C.teal, bold: true });
      textBox(slide, `architecture-title-${i}`, n[1], left + 22, 340, 200, 52, { fontSize: 22, color: i === 2 ? C.paper : C.ink, bold: true });
      textBox(slide, `architecture-body-${i}`, n[2], left + 22, 408, 200, 62, { fontSize: 16, color: i === 2 ? "#CBD2D5" : C.muted });
      if (i < 3) {
        rule(slide, left + 244, 378, 58, C.gold, 3);
        shape(slide, `architecture-arrow-${i}`, left + 284, 370, 18, 18, C.gold, C.gold, "triangle");
      }
    });
    textBox(slide, "architecture-caption", "No secret is stored in client code. Invalid citations are removed, missing evidence is surfaced, and the Coach is instructed not to write an entire assessed submission.", 54, 548, 1160, 68, { fontSize: 18, color: C.muted });
    notes(slide, "Use this slide to explain the privacy and academic-integrity boundary. Workers AI is the default live provider; an OpenAI server-side provider remains optional without changing the public response contract.", ["ClassPilot AI Worker and Coach system instructions, July 25, 2026.", "Cloudflare Workers AI bindings: https://developers.cloudflare.com/workers-ai/configuration/bindings/", "Cloudflare Workers AI JSON mode: https://developers.cloudflare.com/workers-ai/features/json-mode/"]);
  }

  // 8. Validation
  {
    const slide = baseSlide(presentation, "Validation", 8);
    title(slide, "The complete workflow is tested, not staged.", "Automated contracts and live browser QA cover import, planning, submission checks, Canvas boundaries, and multi-turn Coach behavior.");
    const stats = [
      ["326", "automated tests passing"],
      ["0", "browser console errors"],
      ["390", "px mobile width verified"],
    ];
    stats.forEach((s, i) => {
      const left = 58 + i * 174;
      const top = 264;
      shape(slide, `stat-${i}`, left, top, 158, 126, i === 0 ? C.tealSoft : C.paper, C.rule, "roundRect");
      textBox(slide, `stat-value-${i}`, s[0], left + 14, top + 16, 130, 56, { fontSize: 43, color: i === 0 ? C.teal : C.ink, bold: true });
      textBox(slide, `stat-label-${i}`, s[1], left + 14, top + 76, 130, 36, { fontSize: 13, color: C.muted, bold: true });
    });
    textBox(slide, "validation-list", "VERIFIED FLOWS\n\nScreenshots and documents -> exact course and assignment facts\nCourse-bound upload -> no duplicate course split\nToday and scheduler -> next action and replanning\nFinal check -> rubric coverage, score range, AI-writing reminder\nCoach -> two live turns, citations, readable three-day plan", 58, 422, 620, 214, { fontSize: 17, color: C.muted });
    shape(slide, "mobile-frame", 782, 228, 292, 454, C.ink, C.ink, "roundRect");
    addImage(slide, conversationMobileBytes, "ClassPilot AI mobile Coach conversation without horizontal overflow", 796, 242, 264, 426);
    label(slide, "Mobile QA", 1090, 270, 126, C.goldSoft, "#725E16");
    textBox(slide, "mobile-callout", "No page or transcript overflow at 390 x 844. The live Coach returned citations and a readable multi-day plan.", 1090, 322, 134, 190, { fontSize: 17, color: C.muted });
    notes(slide, "Share the verification evidence: 326 automated tests passed, the public product had no browser console errors, and the 390-pixel mobile layout had no page or transcript overflow.", ["ClassPilot AI test suite and public browser QA, July 25, 2026.", "ClassPilot AI live mobile product screenshot, captured July 25, 2026."]);
  }

  // 9. Close
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.ink;
    textBox(slide, "close-kicker", "CLASS PILOT AI", 58, 52, 350, 28, { fontSize: 14, color: C.gold, bold: true });
    textBox(slide, "close-title", "One course.\nOne clear plan.\nOne Coach that remembers.", 58, 154, 710, 260, { fontSize: 58, color: C.paper, bold: true });
    textBox(slide, "close-body", "A live, evidence-grounded academic workspace designed around the student's actual course materials and next action.", 62, 466, 680, 84, { fontSize: 22, color: "#CAD1D4" });
    shape(slide, "close-link", 840, 252, 370, 112, C.teal, C.teal, "roundRect");
    textBox(slide, "close-link-label", "LIVE PRODUCT", 872, 270, 306, 24, { fontSize: 13, color: C.goldSoft, bold: true, alignment: "center" });
    textBox(slide, "close-link-url", "cngei2.github.io/\nclasspilot-ai-website/", 872, 306, 306, 54, { fontSize: 19, color: C.paper, bold: true, alignment: "center" });
    textBox(slide, "close-note", "The public product now includes live multi-turn AI, evidence citations, planning, final checks, and responsive mobile support.", 840, 416, 370, 118, { fontSize: 17, color: "#CAD1D4" });
    notes(slide, "Close on the product promise and open the live URL. The Coach is online through Workers AI; Canvas sync will become active after the school approves a Developer Key.", ["ClassPilot AI live product: https://cngei2.github.io/classpilot-ai-website/", "ClassPilot AI Worker deployment: https://classpilot-ai-coach.cngei2-classpilot.workers.dev"]);
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await presentation.export({ slide, format: "png", scale: 1 });
    await fs.writeFile(`${BUILD}/${stem}.png`, new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(`${BUILD}/${stem}.layout.json`, await layout.text());
  }
  const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(`${BUILD}/deck-montage.webp`, new Uint8Array(await montage.arrayBuffer()));
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(OUTPUT);
  console.log(JSON.stringify({ output: OUTPUT, slides: presentation.slides.items.length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
