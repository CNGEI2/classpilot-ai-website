(function attachClassPilotSubmissionChecker(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotSubmissionChecker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSubmissionChecker() {
  "use strict";

  const STOP_WORDS = new Set([
    "about", "against", "assignment", "beyond", "criterion", "demonstrate",
    "include", "integration", "original", "provide", "research", "strategic",
    "student", "their", "these", "this", "through", "using", "with"
  ]);

  function cleanText(value, maxLength = 1200) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function cleanDocumentText(value, maxLength = 300000) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function normalized(value) {
    return cleanText(value, 200000).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function words(value) {
    return cleanText(value, 300000).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
  }

  function extensionOf(fileName) {
    const match = cleanText(fileName, 500).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function assignmentStrings(assignment) {
    const details = assignment?.details && typeof assignment.details === "object"
      ? assignment.details
      : {};
    return [
      ...(Array.isArray(details.requirements) ? details.requirements : []),
      ...(Array.isArray(details.deliverables) ? details.deliverables : []),
      cleanText(details.overview, 5000)
    ].map((item) => cleanText(item, 2400)).filter(Boolean);
  }

  function allowedExtensions(assignment) {
    const explicit = Array.isArray(assignment?.details?.allowedExtensions)
      ? assignment.details.allowedExtensions
      : [];
    const found = new Set(explicit.map((item) => cleanText(item, 20).toLowerCase().replace(/^\./, "")));
    const source = assignmentStrings(assignment).join(" ");
    for (const extension of ["pdf", "docx", "pptx", "txt", "rtf"]) {
      if (new RegExp(`\\b${extension}\\b`, "i").test(source)) found.add(extension);
    }
    return [...found].filter(Boolean);
  }

  function parseRange(source, unit) {
    const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const range = source.match(new RegExp(`\\b(\\d{1,6})\\s*[-–]\\s*(\\d{1,6})\\s*${escapedUnit}s?\\b`, "i"));
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const maximum = source.match(new RegExp(`\\b(?:maximum|max|no more than|up to)\\s+(\\d{1,6})\\s*${escapedUnit}s?\\b`, "i"));
    if (maximum) return { min: 0, max: Number(maximum[1]) };
    const exact = source.match(new RegExp(`\\b(\\d{1,6})\\s*${escapedUnit}s?\\b`, "i"));
    return exact ? { min: Number(exact[1]), max: Number(exact[1]) } : null;
  }

  function makeCheck(id, label, status, evidence, source) {
    return {
      id: cleanText(id, 120),
      label: cleanText(label, 240),
      status,
      evidence: cleanText(evidence, 800),
      source: cleanText(source, 1000)
    };
  }

  function phraseFound(text, phrase) {
    const target = normalized(phrase);
    if (!target) return false;
    const haystack = normalized(text);
    if (haystack.includes(target)) return true;
    const tokens = target.split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
    return tokens.length > 0 && tokens.filter((token) => haystack.includes(token)).length >= Math.ceil(tokens.length * 0.6);
  }

  function objectiveChecks(assignment, extraction, wordCount) {
    const checks = [];
    const extension = extensionOf(extraction.fileName);
    const allowed = allowedExtensions(assignment);
    checks.push(makeCheck(
      "file-type",
      "File type",
      !extension ? "warn" : !allowed.length || allowed.includes(extension) ? "pass" : "fail",
      !extension
        ? "The file extension could not be read."
        : allowed.length
          ? `Uploaded .${extension}; expected ${allowed.map((item) => `.${item}`).join(" or ")}.`
          : `Uploaded .${extension}; the assignment does not state a required format.`,
      allowed.length ? `Required format: ${allowed.join(", ").toUpperCase()}` : "No file format was stated."
    ));

    const source = assignmentStrings(assignment).join("\n");
    const pageRange = parseRange(source, "page");
    if (pageRange) {
      const count = Math.max(0, Number(extraction.pageCount) || 0);
      checks.push(makeCheck(
        "page-range",
        "Page count",
        !count ? "warn" : count >= pageRange.min && count <= pageRange.max ? "pass" : "fail",
        count ? `${count} page${count === 1 ? "" : "s"} detected.` : "Page count is unavailable for this file type.",
        pageRange.min === pageRange.max
          ? `${pageRange.min} pages required.`
          : `${pageRange.min}-${pageRange.max} pages required.`
      ));
    }
    const wordRange = parseRange(source, "word");
    if (wordRange) {
      checks.push(makeCheck(
        "word-range",
        "Word count",
        wordCount >= wordRange.min && wordCount <= wordRange.max ? "pass" : "fail",
        `${wordCount} words detected.`,
        wordRange.min === wordRange.max
          ? `${wordRange.min} words required.`
          : `${wordRange.min}-${wordRange.max} words required.`
      ));
    }

    const deliverables = Array.isArray(assignment?.details?.deliverables)
      ? assignment.details.deliverables
      : [];
    deliverables.slice(0, 12).forEach((deliverable, index) => {
      const found = phraseFound(extraction.text, deliverable);
      checks.push(makeCheck(
        `deliverable-${index + 1}`,
        cleanText(deliverable, 240) || `Deliverable ${index + 1}`,
        found ? "pass" : "fail",
        found ? "Matching heading or terms were found in the file." : "No matching heading or terms were found.",
        deliverable
      ));
    });

    const lowerSource = source.toLowerCase();
    const lowerText = cleanText(extraction.text, 300000).toLowerCase();
    if (/bibliograph|citation|references|sources/.test(lowerSource)) {
      const found = /\bbibliograph|\breferences\b|\bworks cited\b|\([12][0-9]{3}\)|\[[0-9]+\]/i.test(lowerText);
      checks.push(makeCheck(
        "bibliography",
        "Citations and bibliography",
        found ? "pass" : "fail",
        found ? "Citation or bibliography markers were found." : "No citation or bibliography markers were found.",
        assignmentStrings(assignment).find((item) => /bibliograph|citation|references|sources/i.test(item)) || "Citations required."
      ));
    }
    if (/interview|survey|primary research/.test(lowerSource)) {
      const found = /\binterview|\bsurvey|\bparticipant|\brespondent|professional (?:said|explained|reported)/i.test(lowerText);
      checks.push(makeCheck(
        "primary-research",
        "Primary research evidence",
        found ? "pass" : "fail",
        found ? "Interview or survey evidence markers were found." : "No interview or survey evidence markers were found.",
        assignmentStrings(assignment).find((item) => /interview|survey|primary research/i.test(item)) || "Primary research required."
      ));
    }
    return checks;
  }

  function criterionTokens(criterion) {
    return normalized(`${criterion?.label || ""} ${criterion?.description || ""}`)
      .split(" ")
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
      .slice(0, 18);
  }

  function evidenceLine(text, tokens) {
    const lines = String(text || "").split(/\r?\n/).map((line) => cleanText(line, 300)).filter(Boolean);
    return lines
      .filter((line) => tokens.some((token) => normalized(line).includes(token)))
      .sort((left, right) => left.length - right.length)[0] || "";
  }

  function rubricEvaluation(assignment, text) {
    const rubric = Array.isArray(assignment?.details?.rubric) ? assignment.details.rubric : [];
    const haystack = normalized(text);
    return rubric.slice(0, 16).map((criterion, index) => {
      const tokens = criterionTokens(criterion);
      const matches = tokens.filter((token) => haystack.includes(token));
      const ratio = tokens.length ? matches.length / tokens.length : 0;
      const status = ratio >= 0.5 ? "found" : ratio >= 0.2 ? "partial" : "missing";
      const line = evidenceLine(text, matches);
      return {
        id: `rubric-${index + 1}`,
        label: cleanText(criterion?.label, 240) || `Criterion ${index + 1}`,
        weight: cleanText(criterion?.weight, 120),
        description: cleanText(criterion?.description, 600),
        status,
        evidence: line
          ? cleanText(line, 300)
          : matches.length
            ? `Found related terms: ${matches.slice(0, 6).join(", ")}.`
            : "No clear evidence was found in the extracted text.",
        matchedTerms: matches.slice(0, 8)
      };
    });
  }

  function criterionWeight(value, fallback) {
    const match = cleanText(value, 120).match(/(\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) : fallback;
  }

  function scoreEstimate(rubric, textWordCount) {
    if (!rubric.length) {
      return { label: "ClassPilot estimate unavailable", min: 0, max: 100, confidence: "low" };
    }
    const fallback = 100 / rubric.length;
    const rawWeights = rubric.map((item) => criterionWeight(item.weight, fallback));
    const total = rawWeights.reduce((sum, value) => sum + value, 0) || 100;
    let min = 0;
    let max = 0;
    rubric.forEach((item, index) => {
      const weight = rawWeights[index] / total * 100;
      const band = item.status === "found"
        ? [0.62, 0.9]
        : item.status === "partial"
          ? [0.32, 0.68]
          : [0, 0.35];
      min += weight * band[0];
      max += weight * band[1];
    });
    const evidenceCount = rubric.filter((item) => item.status !== "missing").length;
    const confidence = textWordCount >= 600 && evidenceCount === rubric.length
      ? "medium"
      : "low";
    return {
      label: "ClassPilot estimate",
      min: Math.max(0, Math.round(min)),
      max: Math.min(100, Math.round(max)),
      confidence
    };
  }

  function aiWritingRisk(assignment, text, wordCount, options) {
    if (wordCount < 300) {
      return {
        status: "unavailable",
        score: null,
        confidence: "low",
        blocking: false,
        message: "There is not enough long-form prose for a useful review signal.",
        reasons: []
      };
    }
    let score = 0;
    const reasons = [];
    const sentences = cleanText(text, 300000).split(/[.!?]+/).map((item) => words(item).length).filter((count) => count >= 4);
    const repeatedTransitions = (cleanText(text, 300000).match(/\b(?:furthermore|moreover|in conclusion|it is important to note)\b/gi) || []).length;
    if (repeatedTransitions >= 5) {
      score += Math.min(30, 10 + repeatedTransitions);
      reasons.push("The same formal transition pattern appears repeatedly.");
    }
    if (sentences.length >= 12) {
      const mean = sentences.reduce((sum, value) => sum + value, 0) / sentences.length;
      const variance = sentences.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sentences.length;
      if (mean > 0 && Math.sqrt(variance) / mean < 0.18) {
        score += 15;
        reasons.push("Sentence lengths are unusually uniform across the document.");
      }
    }
    const source = assignmentStrings(assignment).join(" ");
    if (/interview|survey|personal reflection|original insight/i.test(source) &&
        !/\binterview|\bsurvey|\bparticipant|\bi (?:argue|found|observed|learned)|professional (?:said|explained)/i.test(text)) {
      score += 20;
      reasons.push("The assignment asks for personal or primary evidence, but none was clearly found.");
    }
    if (wordCount >= 700 && !/\bbibliograph|\breferences\b|\bworks cited\b|\([12][0-9]{3}\)|\[[0-9]+\]/i.test(text)) {
      score += 10;
      reasons.push("Long-form claims appear without visible citation markers.");
    }
    if (options?.hasDraftHistory) score = Math.max(0, score - 15);
    if (options?.hasSourceNotes) score = Math.max(0, score - 10);
    score = Math.min(100, Math.round(score));
    return {
      status: score > 20 ? "review" : "clear",
      score,
      confidence: options?.hasDraftHistory ? "medium" : "low",
      blocking: false,
      message: score > 20
        ? "Review the highlighted signals before submitting. This is not proof of AI use."
        : "No strong review signal was found. This is not proof of human authorship.",
      reasons
    };
  }

  function analyzeSubmission(assignment = {}, extraction = {}, options = {}) {
    const text = cleanDocumentText(extraction.text, 300000);
    const wordCount = words(text).length;
    const checks = objectiveChecks(assignment, { ...extraction, text }, wordCount);
    const rubric = rubricEvaluation(assignment, text);
    const counts = { pass: 0, warn: 0, fail: 0 };
    checks.forEach((check) => { counts[check.status] += 1; });
    return {
      version: 1,
      checkedAt: cleanText(options.now, 80) || new Date().toISOString(),
      file: {
        name: cleanText(extraction.fileName, 500),
        type: cleanText(extraction.mimeType, 200),
        size: Math.max(0, Math.floor(Number(extraction.size) || 0)),
        pageCount: Math.max(0, Math.floor(Number(extraction.pageCount) || 0)),
        slideCount: Math.max(0, Math.floor(Number(extraction.slideCount) || 0)),
        wordCount
      },
      checks,
      rubric,
      scoreEstimate: scoreEstimate(rubric, wordCount),
      aiRisk: aiWritingRisk(assignment, text, wordCount, options),
      summary: counts
    };
  }

  return { analyzeSubmission };
});
