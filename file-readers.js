(function exposeFileReaders(root) {
  "use strict";
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_PDF_PAGES = 40;

  function classifyImportFile(file = {}) {
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").trim().toLowerCase();
    const mimeKinds = {
      "application/pdf": "pdf",
      "image/png": "image",
      "image/jpeg": "image",
      "image/webp": "image",
      "text/plain": "text",
      "text/markdown": "text",
      "text/x-markdown": "text",
      "text/csv": "text"
    };
    if (mimeKinds[type]) return mimeKinds[type];
    if (type && type !== "application/octet-stream") return "unsupported";
    if (name.endsWith(".pdf")) return "pdf";
    if (/\.(png|jpe?g|webp)$/.test(name)) return "image";
    if (/\.(txt|md|csv)$/.test(name)) return "text";
    return "unsupported";
  }

  function validateImportFile(file = {}) {
    const kind = classifyImportFile(file);
    if (kind === "unsupported") {
      throw new Error("Use PDF, PNG, JPEG, WebP, TXT, Markdown, or CSV.");
    }
    if (Number(file.size) > MAX_FILE_BYTES) {
      throw new Error("Files must be 25 MB or smaller.");
    }
    if (Number(file.size) === 0) throw new Error("The selected file is empty.");
    return kind;
  }

  const joinPdfTextItems = (items = []) => items
    .map((item) => String(item.str || "").trim())
    .filter(Boolean)
    .join(" ");

  const shouldOcrPage = (text) =>
    String(text || "").replace(/\s/g, "").length < 40;

  function assertPdfPageLimit(pageCount) {
    if (pageCount > MAX_PDF_PAGES) {
      throw new Error("PDFs must contain 40 pages or fewer.");
    }
    return pageCount;
  }

  function createAbortError() {
    if (typeof DOMException === "function") {
      return new DOMException("Import cancelled.", "AbortError");
    }
    const error = new Error("Import cancelled.");
    error.name = "AbortError";
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError();
  }

  function ignoreRejection(value) {
    if (value && typeof value.then === "function") value.catch(() => {});
  }

  function cancelOperation(operation) {
    if (!operation) return;
    for (const method of ["cancel", "abort", "terminate"]) {
      if (typeof operation[method] !== "function") continue;
      try {
        ignoreRejection(operation[method]());
      } catch {
        // The import is already rejecting with AbortError.
      }
    }
  }

  function abortableAwait(signal, start, onAbort) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let operation;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => {
        try {
          onAbort?.(operation);
        } catch {
          // The import still rejects immediately below.
        }
        finish(reject, createAbortError());
      };

      signal?.addEventListener("abort", abort, { once: true });
      try {
        operation = start();
      } catch (error) {
        finish(reject, error);
        return;
      }
      Promise.resolve(operation).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  }

  function canReadWithFileReader(file) {
    return typeof FileReader === "function" &&
      typeof Blob === "function" &&
      file instanceof Blob;
  }

  function readWithFileReader(file, signal, method) {
    if (!canReadWithFileReader(file)) return null;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => {
        try {
          reader.abort();
        } catch {
          // The import still rejects immediately below.
        }
        finish(reject, createAbortError());
      };

      reader.onload = () => finish(resolve, reader.result);
      reader.onerror = () => finish(reject, reader.error || new Error("Could not read file."));
      reader.onabort = () => finish(reject, createAbortError());
      signal?.addEventListener("abort", abort, { once: true });
      try {
        reader[method](file);
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function readFileAsText(file, signal) {
    return readWithFileReader(file, signal, "readAsText") ||
      abortableAwait(signal, () => file.text(), cancelOperation);
  }

  function readFileAsArrayBuffer(file, signal) {
    return readWithFileReader(file, signal, "readAsArrayBuffer") ||
      abortableAwait(signal, () => file.arrayBuffer(), cancelOperation);
  }

  async function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob
          ? resolve(blob)
          : reject(new Error("Could not render PDF page.")),
        "image/png"
      );
    });
  }

  async function readPdfFile(file, options = {}) {
    let loadingTask;
    let pdf;
    let completed = false;
    let cleanupPromise;
    let destroyPromise;
    const testPdf = options.__testPdf;
    const cleanupPdf = () => {
      if (!pdf || cleanupPromise) return cleanupPromise;
      try {
        cleanupPromise = Promise.resolve(pdf.cleanup());
      } catch (error) {
        cleanupPromise = Promise.reject(error);
      }
      ignoreRejection(cleanupPromise);
      return cleanupPromise;
    };
    const destroyLoadingTask = () => {
      if (!loadingTask || destroyPromise) return destroyPromise;
      try {
        destroyPromise = Promise.resolve(loadingTask.destroy?.());
      } catch (error) {
        destroyPromise = Promise.reject(error);
      }
      ignoreRejection(destroyPromise);
      return destroyPromise;
    };
    try {
      const pdfjs = await abortableAwait(
        options.signal,
        () => testPdf?.engine || import("./vendor/pdfjs/pdf.mjs")
      );
      pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";
      const bytes = new Uint8Array(await readFileAsArrayBuffer(file, options.signal));
      loadingTask = pdfjs.getDocument({
        data: bytes,
        wasmUrl: "./vendor/pdfjs/wasm/"
      });
      pdf = await abortableAwait(
        options.signal,
        () => loadingTask.promise,
        () => {
          void destroyLoadingTask();
        }
      );
      assertPdfPageLimit(pdf.numPages);

      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        throwIfAborted(options.signal);
        options.onProgress?.({
          stage: "extracting",
          pageNumber,
          pageCount: pdf.numPages
        });
        const page = await abortableAwait(options.signal, () => pdf.getPage(pageNumber));
        let textContentOperation;
        const content = await abortableAwait(
          options.signal,
          () => {
            textContentOperation = page.getTextContent();
            return textContentOperation;
          },
          () => cancelOperation(textContentOperation)
        );
        let text = joinPdfTextItems(content.items);
        if (shouldOcrPage(text) && options.ocrImage) {
          const viewport = page.getViewport({ scale: 1.7 });
          const canvas = testPdf?.createCanvas?.() || document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const canvasContext = canvas.getContext("2d");
          if (!canvasContext) throw new Error("Could not render PDF page.");
          let renderTask;
          await abortableAwait(
            options.signal,
            () => {
              renderTask = page.render({ canvasContext, viewport });
              return renderTask.promise;
            },
            () => cancelOperation(renderTask)
          );
          const blob = await abortableAwait(options.signal, () => canvasToBlob(canvas));
          let ocrOperation;
          text = await abortableAwait(
            options.signal,
            () => {
              ocrOperation = options.ocrImage(blob, (progress) => {
                if (options.signal?.aborted) return;
                options.onProgress?.({
                  stage: "ocr",
                  pageNumber,
                  pageCount: pdf.numPages,
                  progress
                });
              });
              return ocrOperation;
            },
            () => cancelOperation(ocrOperation)
          );
        }
        pages.push(text);
      }
      const result = {
        kind: "pdf",
        text: pages.filter(Boolean).join("\n\n"),
        pageCount: pdf.numPages
      };
      completed = true;
      return result;
    } catch (error) {
      if (options.signal?.aborted) throw createAbortError();
      throw error;
    } finally {
      const cleanup = cleanupPdf();
      if (completed) {
        let cleanupError;
        try {
          if (cleanup) await cleanup;
        } catch (error) {
          cleanupError = error;
        }
        try {
          const destroy = destroyLoadingTask();
          if (destroy) await destroy;
        } catch (error) {
          if (!cleanupError) cleanupError = error;
        }
        if (cleanupError) throw cleanupError;
      } else {
        ignoreRejection(cleanup);
        ignoreRejection(destroyLoadingTask());
      }
    }
  }

  async function readImportFile(file, options = {}) {
    throwIfAborted(options.signal);
    const kind = validateImportFile(file);
    options.onProgress?.({ stage: "reading", kind, fileName: file.name });
    if (kind === "text") {
      const text = await readFileAsText(file, options.signal);
      return { kind, text, pageCount: 0 };
    }
    if (kind === "image") {
      if (!options.ocrImage) throw new Error("Image OCR is unavailable.");
      let ocrOperation;
      const text = await abortableAwait(
        options.signal,
        () => {
          ocrOperation = options.ocrImage(file, (progress) => {
            if (options.signal?.aborted) return;
            options.onProgress?.({ stage: "ocr", progress });
          });
          return ocrOperation;
        },
        () => cancelOperation(ocrOperation)
      );
      return { kind, text, pageCount: 1 };
    }
    return readPdfFile(file, options);
  }

  const api = {
    MAX_FILE_BYTES,
    MAX_PDF_PAGES,
    assertPdfPageLimit,
    classifyImportFile,
    joinPdfTextItems,
    readImportFile,
    shouldOcrPage,
    validateImportFile
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClassPilotFileReaders = api;
})(typeof window !== "undefined" ? window : globalThis);
