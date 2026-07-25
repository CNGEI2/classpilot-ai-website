const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const {
  MAX_FILE_BYTES,
  MAX_PDF_PAGES,
  assertPdfPageLimit,
  classifyImportFile,
  joinPdfTextItems,
  readImportFile,
  shouldOcrPage,
  validateImportFile
} = require("../file-readers.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortResult(promise) {
  return Promise.race([
    promise.then(
      () => ({ name: "resolved" }),
      (error) => ({ name: error?.name })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ name: "timeout" }), 30))
  ]);
}

function settlesSoon(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Operation did not start.")), 30))
  ]);
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createPdfFile(bytes = new Uint8Array([1])) {
  return {
    name: "fixture.pdf",
    type: "application/pdf",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function createTextPdfBytes(text) {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function createPdfEngine(overrides = {}) {
  const cleanup = overrides.cleanup || (() => {});
  const destroy = overrides.destroy || (() => {});
  const pdf = {
    numPages: 1,
    cleanup,
    getPage: async () => ({
      getTextContent: async () => ({ items: [{ str: "PDF text" }] }),
      ...overrides.page
    }),
    ...overrides.pdf
  };
  const loadingTask = {
    promise: overrides.loadingPromise || Promise.resolve(pdf),
    destroy
  };
  return {
    GlobalWorkerOptions: {},
    getDocument: () => loadingTask,
    ...overrides.engine
  };
}

test("classifies PDF, image, and text imports", () => {
  assert.equal(classifyImportFile({ name: "syllabus.pdf", type: "application/pdf" }), "pdf");
  assert.equal(classifyImportFile({ name: "canvas.png", type: "image/png" }), "image");
  assert.equal(classifyImportFile({ name: "prompt.txt", type: "text/plain" }), "text");
  assert.equal(classifyImportFile({ name: "notes.md", type: "text/markdown" }), "text");
  assert.equal(classifyImportFile({ name: "notes.md", type: "text/x-markdown" }), "text");
});

test("rejects unsupported MIME types and MIME-extension conflicts", () => {
  assert.equal(classifyImportFile({ name: "sticker.png", type: "image/gif" }), "unsupported");
  assert.equal(classifyImportFile({ name: "vector.png", type: "image/svg+xml" }), "unsupported");
  assert.equal(classifyImportFile({ name: "page.txt", type: "text/html" }), "unsupported");
  assert.equal(classifyImportFile({ name: "page.png", type: "application/octet-stream" }), "image");
  assert.equal(classifyImportFile({ name: "page.png", type: "application/pdf" }), "pdf");
});

test("uses extension fallback only for empty or generic MIME", () => {
  assert.equal(classifyImportFile({ name: "syllabus.PDF", type: "" }), "pdf");
  assert.equal(classifyImportFile({ name: "canvas.webp" }), "image");
  assert.equal(classifyImportFile({ name: "data.csv", type: "application/octet-stream" }), "text");
  assert.equal(classifyImportFile({ name: "archive.bin", type: "" }), "unsupported");
  assert.equal(classifyImportFile({ name: "archive.gif", type: "" }), "unsupported");
});

test("rejects empty and oversized files but accepts the exact 25 MB limit", () => {
  assert.throws(
    () => validateImportFile({ name: "empty.pdf", type: "application/pdf", size: 0 }),
    /empty/
  );
  assert.equal(validateImportFile({
    name: "limit.pdf",
    type: "application/pdf",
    size: MAX_FILE_BYTES
  }), "pdf");
  assert.throws(
    () => validateImportFile({
      name: "large.pdf",
      type: "application/pdf",
      size: MAX_FILE_BYTES + 1
    }),
    /25 MB/
  );
});

test("joins PDF text and flags nearly empty pages for OCR", () => {
  assert.equal(joinPdfTextItems([{ str: "CS450" }, { str: "Syllabus" }]), "CS450 Syllabus");
  assert.equal(shouldOcrPage("A".repeat(39)), true);
  assert.equal(shouldOcrPage("A".repeat(20) + " ".repeat(20) + "B".repeat(20)), false);
  assert.equal(shouldOcrPage("A".repeat(80)), false);
});

test("exposes the API on the browser global", () => {
  const source = fs.readFileSync(require.resolve("../file-readers.js"), "utf8");
  const browser = {};
  vm.runInNewContext(source, { window: browser });
  assert.equal(browser.ClassPilotFileReaders.MAX_PDF_PAGES, 40);
  assert.equal(browser.ClassPilotFileReaders.classifyImportFile({
    name: "syllabus.pdf",
    type: "application/pdf"
  }), "pdf");
});

test("exposes the exact PDF page limit", () => {
  assert.equal(MAX_PDF_PAGES, 40);
});

test("accepts PDFs at the 40-page limit", () => {
  assert.equal(assertPdfPageLimit(40), 40);
});

test("rejects PDFs above 40 pages", () => {
  assert.throws(() => assertPdfPageLimit(41), /40 pages/);
});

test("reads text imports directly and reports reading progress", async () => {
  const events = [];
  const result = await readImportFile({
    name: "notes.txt",
    type: "text/plain",
    size: 12,
    text: async () => "Course notes"
  }, {
    onProgress: (event) => events.push(event)
  });

  assert.deepEqual(result, { kind: "text", text: "Course notes", pageCount: 0 });
  assert.deepEqual(events, [{ stage: "reading", kind: "text", fileName: "notes.txt" }]);
});

test("uses OCR for image imports and forwards OCR progress", async () => {
  const events = [];
  const image = { name: "scan.png", type: "image/png", size: 12 };
  const result = await readImportFile(image, {
    onProgress: (event) => events.push(event),
    ocrImage: async (blob, onProgress) => {
      assert.equal(blob, image);
      onProgress(0.5);
      return "Scanned notes";
    }
  });

  assert.deepEqual(result, { kind: "image", text: "Scanned notes", pageCount: 1 });
  assert.deepEqual(events, [
    { stage: "reading", kind: "image", fileName: "scan.png" },
    { stage: "ocr", progress: 0.5 }
  ]);
});

test("rejects image imports without an OCR reader", async () => {
  await assert.rejects(
    readImportFile({ name: "scan.png", type: "image/png", size: 12 }),
    /Image OCR is unavailable/
  );
});

test("rejects an already-cancelled import with AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readImportFile({
      name: "notes.txt",
      type: "text/plain",
      size: 12,
      text: async () => "This must not be read"
    }, { signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );
});

test("settles a blocked text read immediately when aborted", async () => {
  const blockedRead = deferred();
  const controller = new AbortController();
  const importPromise = readImportFile({
    name: "notes.txt",
    type: "text/plain",
    size: 12,
    text: () => blockedRead.promise
  }, { signal: controller.signal });

  controller.abort();
  assert.deepEqual(await abortResult(importPromise), { name: "AbortError" });
  assert.equal(blockedRead.promise instanceof Promise, true);
});

test("cancels a blocked PDF loading task immediately when aborted", async () => {
  const blockedLoad = deferred();
  const loadStarted = deferred();
  const controller = new AbortController();
  let destroyCalls = 0;
  const engine = {
    GlobalWorkerOptions: {},
    getDocument: () => {
      loadStarted.resolve();
      return {
        promise: blockedLoad.promise,
        destroy: () => {
          destroyCalls += 1;
        }
      };
    }
  };
  const importPromise = readImportFile(createPdfFile(), {
    signal: controller.signal,
    __testPdf: { engine }
  });

  await settlesSoon(loadStarted.promise);
  controller.abort();
  assert.deepEqual(await abortResult(importPromise), { name: "AbortError" });
  assert.equal(destroyCalls, 1);
});

test("cancels a blocked PDF render and cleans up when aborted", async () => {
  const blockedRender = deferred();
  const renderStarted = deferred();
  const controller = new AbortController();
  let cancelCalls = 0;
  let cleanupCalls = 0;
  let destroyCalls = 0;
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupCalls += 1;
    },
    destroy: () => {
      destroyCalls += 1;
    },
    page: {
      getTextContent: async () => ({ items: [] }),
      getViewport: () => ({ width: 10, height: 10 }),
      render: () => {
        renderStarted.resolve();
        return {
          promise: blockedRender.promise,
          cancel: () => {
            cancelCalls += 1;
          }
        };
      }
    }
  });
  const importPromise = readImportFile(createPdfFile(), {
    signal: controller.signal,
    ocrImage: async () => "unreachable",
    __testPdf: {
      engine,
      createCanvas: () => ({
        getContext: () => ({}),
        toBlob: () => {}
      })
    }
  });

  await settlesSoon(renderStarted.promise);
  controller.abort();
  assert.deepEqual(await abortResult(importPromise), { name: "AbortError" });
  assert.equal(cancelCalls, 1);
  assert.equal(cleanupCalls, 1);
  assert.equal(destroyCalls, 1);
});

test("cancels a blocked PDF text extraction when aborted", async () => {
  const blockedText = deferred();
  const textStarted = deferred();
  const controller = new AbortController();
  let cancelCalls = 0;
  blockedText.promise.cancel = () => {
    cancelCalls += 1;
  };
  const engine = createPdfEngine({
    page: {
      getTextContent: () => {
        textStarted.resolve();
        return blockedText.promise;
      }
    }
  });
  const importPromise = readImportFile(createPdfFile(), {
    signal: controller.signal,
    __testPdf: { engine }
  });

  await settlesSoon(textStarted.promise);
  controller.abort();
  assert.deepEqual(await abortResult(importPromise), { name: "AbortError" });
  assert.equal(cancelCalls, 1);
});

test("extracts text from a valid in-memory PDF with the bundled PDF.js module", async () => {
  const originalDOMMatrix = globalThis.DOMMatrix;
  const originalWorker = globalThis.pdfjsWorker;
  const originalWarn = console.warn;
  const originalPromiseTry = Promise.try;
  const originalToHex = Uint8Array.prototype.toHex;
  const expectedWarnings = [
    /Please use the `legacy` build in Node\.js environments\./,
    /Ensure that the `standardFontDataUrl` API parameter is provided\./
  ];
  const warnings = [];
  console.warn = (...args) => {
    const message = args.map(String).join(" ");
    warnings.push(message);
    if (!expectedWarnings.some((pattern) => pattern.test(message))) originalWarn(...args);
  };
  globalThis.DOMMatrix = class DOMMatrix {};
  if (typeof Promise.try !== "function") {
    Promise.try = (callback, ...args) => Promise.resolve().then(() => callback(...args));
  }
  if (typeof Uint8Array.prototype.toHex !== "function") {
    Object.defineProperty(Uint8Array.prototype, "toHex", {
      configurable: true,
      value() {
        return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
      }
    });
  }
  const events = [];
  try {
    globalThis.pdfjsWorker = await import(pathToFileURL(
      path.resolve(__dirname, "../vendor/pdfjs/pdf.worker.mjs")
    ).href);
    const result = await readImportFile(createPdfFile(createTextPdfBytes("Bundled PDF text")), {
      onProgress: (event) => events.push(event)
    });
    assert.equal(result.kind, "pdf");
    assert.match(result.text, /Bundled PDF text/);
    assert.deepEqual(events, [
      { stage: "reading", kind: "pdf", fileName: "fixture.pdf" },
      { stage: "extracting", pageNumber: 1, pageCount: 1 }
    ]);
    assert.equal(warnings.length, expectedWarnings.length);
    for (let index = 0; index < expectedWarnings.length; index += 1) {
      assert.match(warnings[index], expectedWarnings[index]);
    }
  } finally {
    console.warn = originalWarn;
    globalThis.DOMMatrix = originalDOMMatrix;
    globalThis.pdfjsWorker = originalWorker;
    if (originalPromiseTry === undefined) delete Promise.try;
    if (originalToHex === undefined) delete Uint8Array.prototype.toHex;
  }
});

test("enforces the 40-page limit after a PDF loads", async () => {
  let destroyCalls = 0;
  const engine = createPdfEngine({
    pdf: { numPages: 41 },
    destroy: () => {
      destroyCalls += 1;
    }
  });

  await assert.rejects(
    readImportFile(createPdfFile(), { __testPdf: { engine } }),
    /40 pages/
  );
  assert.equal(destroyCalls, 1);
});

test("renders nearly empty PDF pages for OCR and reports progress", async () => {
  let cleanupCalls = 0;
  let destroyCalls = 0;
  let renderCalls = 0;
  const events = [];
  const canvas = {
    getContext: () => ({}),
    toBlob: (callback) => callback({ type: "image/png" })
  };
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupCalls += 1;
    },
    destroy: () => {
      destroyCalls += 1;
    },
    page: {
      getTextContent: async () => ({ items: [{ str: "scan" }] }),
      getViewport: () => ({ width: 10, height: 10 }),
      render: () => {
        renderCalls += 1;
        return { promise: Promise.resolve() };
      }
    }
  });
  const result = await readImportFile(createPdfFile(), {
    onProgress: (event) => events.push(event),
    ocrImage: async (blob, onProgress) => {
      assert.equal(blob.type, "image/png");
      onProgress(0.75);
      return "OCR text";
    },
    __testPdf: { engine, createCanvas: () => canvas }
  });

  assert.deepEqual(result, { kind: "pdf", text: "OCR text", pageCount: 1 });
  assert.equal(renderCalls, 1);
  assert.equal(cleanupCalls, 1);
  assert.equal(destroyCalls, 1);
  assert.deepEqual(events, [
    { stage: "reading", kind: "pdf", fileName: "fixture.pdf" },
    { stage: "extracting", pageNumber: 1, pageCount: 1 },
    { stage: "ocr", pageNumber: 1, pageCount: 1, progress: 0.75 }
  ]);
});

test("cleans up a PDF loading task after a page error", async () => {
  let cleanupCalls = 0;
  let destroyCalls = 0;
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupCalls += 1;
    },
    destroy: () => {
      destroyCalls += 1;
    },
    page: {
      getTextContent: async () => {
        throw new Error("Text extraction failed");
      }
    }
  });

  await assert.rejects(
    readImportFile(createPdfFile(), { __testPdf: { engine } }),
    /Text extraction failed/
  );
  assert.equal(cleanupCalls, 1);
  assert.equal(destroyCalls, 1);
});

test("awaits asynchronous PDF cleanup before resolving a successful import", async () => {
  const cleanup = deferred();
  const cleanupStarted = deferred();
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupStarted.resolve();
      return cleanup.promise;
    }
  });
  const importPromise = readImportFile(createPdfFile(), { __testPdf: { engine } });
  let settled = false;
  importPromise.then(() => {
    settled = true;
  });

  await settlesSoon(cleanupStarted.promise);
  await nextTurn();
  assert.equal(settled, false);
  cleanup.resolve();
  assert.deepEqual(await importPromise, { kind: "pdf", text: "PDF text", pageCount: 1 });
});

test("awaits asynchronous PDF task destruction before resolving a successful import", async () => {
  const destroy = deferred();
  const destroyStarted = deferred();
  const engine = createPdfEngine({
    destroy: () => {
      destroyStarted.resolve();
      return destroy.promise;
    }
  });
  const importPromise = readImportFile(createPdfFile(), { __testPdf: { engine } });
  let settled = false;
  importPromise.then(() => {
    settled = true;
  });

  await settlesSoon(destroyStarted.promise);
  await nextTurn();
  assert.equal(settled, false);
  destroy.resolve();
  assert.deepEqual(await importPromise, { kind: "pdf", text: "PDF text", pageCount: 1 });
});

test("surfaces asynchronous PDF cleanup failures after otherwise successful imports", async () => {
  const cleanup = deferred();
  const cleanupStarted = deferred();
  cleanup.promise.catch(() => {});
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupStarted.resolve();
      return cleanup.promise;
    }
  });
  const importPromise = readImportFile(createPdfFile(), { __testPdf: { engine } });

  await settlesSoon(cleanupStarted.promise);
  cleanup.reject(new Error("Cleanup failed"));
  await assert.rejects(importPromise, /Cleanup failed/);
});

test("handles async PDF cleanup rejection after abort without an unhandled rejection", async () => {
  const blockedText = deferred();
  const cleanup = deferred();
  const textStarted = deferred();
  const cleanupStarted = deferred();
  const controller = new AbortController();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupStarted.resolve();
      return cleanup.promise;
    },
    page: {
      getTextContent: () => {
        textStarted.resolve();
        return blockedText.promise;
      }
    }
  });
  try {
    const importPromise = readImportFile(createPdfFile(), {
      signal: controller.signal,
      __testPdf: { engine }
    });
    await settlesSoon(textStarted.promise);
    controller.abort();
    await assert.rejects(importPromise, (error) => error?.name === "AbortError");
    await settlesSoon(cleanupStarted.promise);
    cleanup.reject(new Error("Abort cleanup failed"));
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("handles async PDF cleanup rejection after a page error without an unhandled rejection", async () => {
  const cleanup = deferred();
  const cleanupStarted = deferred();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const engine = createPdfEngine({
    cleanup: () => {
      cleanupStarted.resolve();
      return cleanup.promise;
    },
    page: {
      getTextContent: async () => {
        throw new Error("Primary page failure");
      }
    }
  });
  try {
    await assert.rejects(
      readImportFile(createPdfFile(), { __testPdf: { engine } }),
      /Primary page failure/
    );
    await settlesSoon(cleanupStarted.promise);
    cleanup.reject(new Error("Error cleanup failed"));
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("always configures the local PDF worker for an injected engine", async () => {
  const engine = createPdfEngine();
  await readImportFile(createPdfFile(), {
    __testPdf: {
      engine,
      workerSrc: "https://example.invalid/pdf.worker.mjs"
    }
  });
  assert.equal(engine.GlobalWorkerOptions.workerSrc, "./vendor/pdfjs/pdf.worker.mjs");
});
