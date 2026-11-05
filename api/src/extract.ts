import { itemsToText, type PageText } from "./engine";

interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
      destroy(): Promise<void>;
    }>;
  };
}

/** Reads the text of every page with PDF.js (the Node build). */
export async function extractPages(data: Uint8Array): Promise<PageText[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
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
