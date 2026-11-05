import type { PDFDocumentProxy } from "pdfjs-dist";
import { itemsToText, type PageText } from "./engine";

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Reads the text of every page in the browser with PDF.js. Loaded only when a check starts. */
export async function extractPagesInBrowser(file: File): Promise<PageText[]> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ page: n, text: itemsToText(content.items) });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

// The side-by-side view renders several pages of the same set: open each file once.
const openDocs = new WeakMap<File, Promise<PDFDocumentProxy>>();

function openDocument(file: File): Promise<PDFDocumentProxy> {
  let doc = openDocs.get(file);
  if (!doc) {
    doc = (async () => {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    })();
    doc.catch(() => openDocs.delete(file));
    openDocs.set(file, doc);
  }
  return doc;
}

/** Draws one page of the uploaded set on a canvas, about 1600 pixels wide. */
export async function renderPdfPage(file: File, pageNumber: number, canvas: HTMLCanvasElement): Promise<void> {
  const doc = await openDocument(file);
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, 1600 / base.width) });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the page.");
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
}
