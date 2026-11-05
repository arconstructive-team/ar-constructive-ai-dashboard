import { itemsToText, type PageText } from "./engine";

/** Reads the text of every page in the browser with PDF.js. Loaded only when a check starts. */
export async function extractPagesInBrowser(file: File): Promise<PageText[]> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
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
