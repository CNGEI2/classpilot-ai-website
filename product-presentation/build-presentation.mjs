import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = "/Users/pf/Documents/homework/classpilot-ai-website";
const BUILD = `${ROOT}/product-presentation/.build`;
const OUTPUT = `${ROOT}/product-presentation/ClassPilot-AI-Product-Introduction.pptx`;
const DESKTOP = `${BUILD}/coach-desktop.png`;
const MOBILE = `${BUILD}/coach-mobile.png`;

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
  const mobileBytes = await fs.readFile(MOBILE);
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
    textBox(slide, "cover-body", "A private student workspace that reads uploads, organizes coursework, and coaches the student through the work.", 62, 390, 500, 108, {
      fontSize: 21,
      color: "#CAD1D4",
    });
    label(slide, "Product introduction", 62, 548, 190, C.goldSoft, "#725E16");
    shape(slide, "cover-screen-frame", 626, 82, 590, 544, C.paper, "#49545B", "roundRect");
    addImage(slide, desktopBytes, "ClassPilot AI Coach product screenshot", 642, 98, 558, 512, { left: 0, top: 0, right: 0, bottom: 0.36 });
    notes(slide, "Introduce ClassPilot AI as a finished student workspace, then frame the AI Coach as one part of a broader course organization workflow.", ["ClassPilot AI local product screenshot, captured July 25, 2026."]);
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
    title(slide, "One upload becomes an organized course workflow.", "The selected course is the source of truth, so files cannot drift into duplicate course records.");
    const steps = [
      ["Import once", "Upload a screenshot, assignment text, PDF, DOCX, or syllabus directly inside the course."],
      ["Extract facts", "Capture course name, assignment title, due date, points, status, requirements, and deliverables."],
      ["Organize by course", "Keep syllabus-level exams and policies separate from assignment-level tasks and evidence."],
      ["Coach the work", "Explain the prompt, identify missing requirements, and turn it into the next practical steps."],
    ];
    steps.forEach((item, i) => {
      const left = 58 + i * 302;
      numberedStep(slide, i + 1, item[0], item[1], left, 278, 250);
      if (i < steps.length - 1) {
        rule(slide, left + 58, 302, 214, C.rule, 2);
        shape(slide, `arrow-${i}`, left + 258, 296, 13, 13, C.rule, C.rule, "triangle");
      }
    });
    textBox(slide, "workflow-result", "RESULT  /  Every course becomes a living workspace instead of a folder of disconnected uploads.", 58, 594, 1150, 44, {
      fontSize: 17,
      color: C.teal,
      bold: true,
    });
    notes(slide, "Walk through the four-step loop. Emphasize that uploading within a course removes the need for the student to re-identify the course.", ["ClassPilot AI implementation: course-bound import flow and content parser, July 2026."]);
  }

  // 4. Product screen
  {
    const slide = baseSlide(presentation, "The product", 4);
    title(slide, "The Coach works inside the selected assignment.", "It can see the due date, point value, extracted requirements, deliverables, and current work plan.");
    shape(slide, "screen-shadow", 46, 226, 1188, 438, "#DDE1DE", "none", "roundRect");
    shape(slide, "screen-frame", 58, 214, 1164, 438, C.paper, C.rule, "roundRect");
    addImage(slide, desktopBytes, "ClassPilot AI Coach interface in assignment context", 72, 228, 1136, 410, { left: 0, top: 0, right: 0, bottom: 0.5 });
    label(slide, "Selected assignment context", 830, 178, 262, C.goldSoft, "#725E16");
    notes(slide, "Point out the course and assignment context strip, then show the four quick actions and conversational composer.", ["ClassPilot AI local product screenshot, captured July 25, 2026."]);
  }

  // 5. Coach behavior
  {
    const slide = baseSlide(presentation, "AI Coach", 5);
    title(slide, "Grounded help, not generic chat.", "Every response is structured around evidence from the selected course and a short list of next steps.");
    shape(slide, "coach-evidence-frame", 48, 236, 706, 408, C.paper, C.rule, "roundRect");
    addImage(slide, desktopBytes, "Coach answer with evidence and next steps", 62, 250, 678, 380, { left: 0.16, top: 0.34, right: 0.02, bottom: 0.08 });
    const items = [
      ["Explain", "Rewrites dense assignment language into a clear interpretation without inventing facts."],
      ["Check", "Compares the student's plan against extracted requirements, points, dates, and deliverables."],
      ["Plan", "Recommends the next small actions and keeps the student responsible for the final assessed work."],
    ];
    items.forEach((item, i) => {
      const top = 248 + i * 126;
      label(slide, item[0], 790, top, 112, i === 1 ? C.goldSoft : C.tealSoft, i === 1 ? "#725E16" : C.teal);
      textBox(slide, `coach-item-${i}`, item[1], 928, top - 2, 290, 94, { fontSize: 18, color: C.muted });
      if (i < 2) rule(slide, 790, top + 106, 428);
    });
    notes(slide, "Explain that the assistant has a bounded context object rather than unrestricted access to all student data. The visible evidence rail lets the student verify what the response used.", ["ClassPilot AI Coach implementation and local product screenshot, July 25, 2026."]);
  }

  // 6. Architecture
  {
    const slide = baseSlide(presentation, "Secure architecture", 6);
    title(slide, "The API key never enters the browser.", "ClassPilot sends only bounded course context through a same-origin-aware server proxy.");
    const nodes = [
      ["01", "Browser", "Local course data\nand conversations"],
      ["02", "Context builder", "Selected course +\nselected assignment"],
      ["03", "Secure Worker", "CORS, validation,\nrate limiting"],
      ["04", "AI response", "Structured answer,\nevidence, next steps"],
    ];
    nodes.forEach((n, i) => {
      const left = 54 + i * 302;
      shape(slide, `architecture-node-${i}`, left, 270, 244, 220, i === 2 ? C.ink : C.paper, i === 2 ? C.ink : C.rule, "roundRect");
      textBox(slide, `architecture-index-${i}`, n[0], left + 22, 292, 48, 28, { fontSize: 13, color: i === 2 ? C.gold : C.teal, bold: true });
      textBox(slide, `architecture-title-${i}`, n[1], left + 22, 340, 200, 42, { fontSize: 23, color: i === 2 ? C.paper : C.ink, bold: true });
      textBox(slide, `architecture-body-${i}`, n[2], left + 22, 402, 200, 62, { fontSize: 17, color: i === 2 ? "#CBD2D5" : C.muted });
      if (i < 3) {
        rule(slide, left + 244, 378, 58, C.gold, 3);
        shape(slide, `architecture-arrow-${i}`, left + 284, 370, 18, 18, C.gold, C.gold, "triangle");
      }
    });
    textBox(slide, "architecture-caption", "Production mode uses the OpenAI Responses API with server-side secrets. Explicit Mock mode remains available for deterministic UI testing.", 54, 550, 1160, 62, { fontSize: 18, color: C.muted });
    notes(slide, "Use this slide to explain the security boundary. The browser holds student-facing state; the Worker controls origins, payload size, validation, rate limiting, and the server secret.", ["ClassPilot AI Worker implementation, July 25, 2026.", "OpenAI Responses API documentation: https://platform.openai.com/docs/api-reference/responses"]);
  }

  // 7. Integrity and privacy
  {
    const slide = baseSlide(presentation, "Trust by design", 7);
    title(slide, "Help students do the work. Do not do it for them.", "The Coach is designed as a study partner with explicit academic-integrity and privacy boundaries.");
    textBox(slide, "integrity-do-title", "THE COACH CAN", 58, 260, 500, 28, { fontSize: 14, color: C.teal, bold: true });
    textBox(slide, "integrity-dont-title", "THE COACH WILL NOT", 686, 260, 500, 28, { fontSize: 14, color: C.red, bold: true });
    const can = ["Explain assignment language", "Identify requirements and gaps", "Suggest a sequence of next steps", "Ground answers in uploaded evidence"];
    const cannot = ["Invent missing course facts", "Write a complete assessed submission", "Send unrelated courses by default", "Expose an API secret in client code"];
    can.forEach((value, i) => {
      shape(slide, `can-dot-${i}`, 62, 324 + i * 66, 18, 18, C.teal, C.teal, "ellipse");
      textBox(slide, `can-${i}`, value, 96, 316 + i * 66, 470, 38, { fontSize: 21 });
    });
    cannot.forEach((value, i) => {
      shape(slide, `cannot-mark-${i}`, 690, 324 + i * 66, 18, 18, C.red, C.red, "rect");
      textBox(slide, `cannot-${i}`, value, 724, 316 + i * 66, 470, 38, { fontSize: 21 });
    });
    shape(slide, "privacy-band", 58, 608, 1136, 48, C.ink, C.ink, "roundRect");
    textBox(slide, "privacy-band-text", "Selected course context is sent only when the student asks; conversations remain scoped to that course and assignment.", 80, 618, 1092, 28, { fontSize: 16, color: C.paper, bold: true, alignment: "center" });
    notes(slide, "Position academic integrity as a product feature. The Coach supports interpretation, planning, and checking while leaving judgment and final authorship with the student.", ["ClassPilot AI Coach system prompt and privacy UI, July 25, 2026."]);
  }

  // 8. Validation
  {
    const slide = baseSlide(presentation, "Validation", 8);
    title(slide, "Built like a product, verified like one.", "Automated contracts cover parsing, OCR normalization, course binding, Coach context, UI behavior, and backend security.");
    const stats = [
      ["292", "automated tests passing"],
      ["0", "browser console errors"],
      ["2", "responsive viewports checked"],
    ];
    stats.forEach((s, i) => {
      const left = 58 + i * 174;
      const top = 264;
      shape(slide, `stat-${i}`, left, top, 158, 126, i === 0 ? C.tealSoft : C.paper, C.rule, "roundRect");
      textBox(slide, `stat-value-${i}`, s[0], left + 14, top + 16, 130, 56, { fontSize: 43, color: i === 0 ? C.teal : C.ink, bold: true });
      textBox(slide, `stat-label-${i}`, s[1], left + 14, top + 76, 130, 36, { fontSize: 13, color: C.muted, bold: true });
    });
    textBox(slide, "validation-list", "VERIFIED FLOWS\n\nCanvas screenshots → exact title, due date, points, status\nSyllabus uploads → course-level dates and policies\nAssignment imports → requirements, deliverables, work plan\nCoach → isolated context, quick actions, custom questions", 58, 430, 520, 196, { fontSize: 17, color: C.muted });
    shape(slide, "mobile-frame", 782, 228, 292, 454, C.ink, C.ink, "roundRect");
    addImage(slide, mobileBytes, "ClassPilot AI mobile Coach interface", 796, 242, 264, 426, { left: 0, top: 0, right: 0, bottom: 0.49 });
    label(slide, "Mobile QA", 1090, 270, 126, C.goldSoft, "#725E16");
    textBox(slide, "mobile-callout", "No horizontal overflow at 390 × 844. Controls remain readable and touch-friendly.", 1090, 322, 134, 166, { fontSize: 17, color: C.muted });
    notes(slide, "Share the verification evidence: all automated tests passed, the tested browser had no console errors, and both desktop and mobile layouts were inspected.", ["ClassPilot AI test suite and local browser QA, July 25, 2026.", "ClassPilot AI mobile product screenshot, captured July 25, 2026."]);
  }

  // 9. Close
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.ink;
    textBox(slide, "close-kicker", "CLASS PILOT AI", 58, 52, 350, 28, { fontSize: 14, color: C.gold, bold: true });
    textBox(slide, "close-title", "One upload.\nOne organized course.\nOne clear next step.", 58, 154, 710, 260, { fontSize: 58, color: C.paper, bold: true });
    textBox(slide, "close-body", "A private, evidence-grounded academic workspace designed around the student's actual course materials.", 62, 466, 680, 84, { fontSize: 22, color: "#CAD1D4" });
    shape(slide, "close-link", 840, 252, 370, 112, C.teal, C.teal, "roundRect");
    textBox(slide, "close-link-label", "LIVE PRODUCT", 872, 270, 306, 24, { fontSize: 13, color: C.goldSoft, bold: true, alignment: "center" });
    textBox(slide, "close-link-url", "cngei2.github.io/\nclasspilot-ai-website/", 872, 306, 306, 54, { fontSize: 19, color: C.paper, bold: true, alignment: "center" });
    textBox(slide, "close-note", "Real-time AI responses activate when a server-side OpenAI API secret is configured. Mock mode remains available for deterministic testing.", 840, 416, 370, 118, { fontSize: 17, color: "#CAD1D4" });
    notes(slide, "Close on the product promise and open the live URL. Be transparent that the real-time model connection is activated through the server secret, while the complete interface and backend are already implemented.", ["ClassPilot AI product: https://cngei2.github.io/classpilot-ai-website/"]);
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
