import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { plainText, type Block, type Inline } from "./markdown";
import { metaLine, type ExportMeta } from "./exportMeta";

// PDF colours as RGB. They are the DESIGN.md tokens ink, muted, border and surface.
const INK: [number, number, number] = [17, 17, 17];
const MUTED: [number, number, number] = [110, 110, 106];
const BORDER: [number, number, number] = [212, 212, 210];
const SURFACE: [number, number, number] = [230, 230, 227];

const MARGIN = 54; // 0.75 in
const BODY_SIZE = 10.5;
const LINE = 1.4;
const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 16, 3: 13, 4: 12, 5: 11, 6: 11 };

const ASCII: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  "•": "-",
  "→": "->",
  "≤": "<=",
  "≥": ">=",
  " ": " ",
};

/** The built-in PDF fonts cover Latin-1 only. Other characters get a close ASCII form. */
export function pdfText(text: string): string {
  return Array.from(text)
    .map((ch) => (ASCII[ch] ?? (ch.charCodeAt(0) <= 255 ? ch : "?")))
    .join("");
}

const inline = (content: Inline[]) => pdfText(plainText(content).replace(/\s+/g, " ").trim());

type LastTable = { lastAutoTable?: { finalY: number } };

/**
 * Builds a print-ready PDF: US Letter, a title block with the project name and
 * date, real headings, and tables drawn as grids that split across pages with
 * the header row repeated.
 */
export function buildPdf(blocks: Block[], meta: ExportMeta): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  doc.setProperties({ title: meta.title, subject: meta.projectName, author: meta.author, creator: "arconstructive" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  const bottom = pageHeight - MARGIN - 18;
  let y = MARGIN;

  const ensure = (height: number) => {
    if (y + height > bottom) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const writeLines = (lines: string[], size: number, x = MARGIN, color = INK) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const step = size * LINE;
    for (const line of lines) {
      ensure(step);
      doc.text(line, x, y + size);
      y += step;
    }
  };

  // Title block.
  doc.setFont("helvetica", "bold");
  writeLines([pdfText(meta.projectName).toUpperCase()], 8, MARGIN, MUTED);
  y += 4;
  doc.setFont("times", "bold");
  writeLines(doc.splitTextToSize(pdfText(meta.title), width) as string[], 24);
  y += 2;
  doc.setFont("helvetica", "normal");
  writeLines(doc.splitTextToSize(pdfText(metaLine(meta)), width) as string[], 9, MARGIN, MUTED);
  y += 8;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 18;

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const size = HEADING_SIZE[block.level];
        y += block.level <= 2 ? 10 : 6;
        ensure(size * LINE * 2 + BODY_SIZE * LINE);
        doc.setFont("times", "bold");
        writeLines(doc.splitTextToSize(inline(block.content), width) as string[], size);
        y += 4;
        break;
      }
      case "paragraph": {
        doc.setFont("helvetica", "normal");
        writeLines(doc.splitTextToSize(inline(block.content), width) as string[], BODY_SIZE);
        y += 8;
        break;
      }
      case "list":
      case "tasks": {
        doc.setFont("helvetica", "normal");
        const items =
          block.type === "list"
            ? block.items.map((item, index) => ({ marker: block.ordered ? `${block.start + index}.` : "-", text: inline(item) }))
            : block.items.map((item) => ({ marker: item.checked ? "[x]" : "[ ]", text: inline(item.content) }));
        for (const item of items) {
          const lines = doc.splitTextToSize(item.text, width - 22) as string[];
          ensure(BODY_SIZE * LINE);
          doc.setFontSize(BODY_SIZE);
          doc.setTextColor(...INK);
          doc.text(item.marker, MARGIN, y + BODY_SIZE);
          writeLines(lines, BODY_SIZE, MARGIN + 22);
          y += 2;
        }
        y += 6;
        break;
      }
      case "table": {
        ensure(BODY_SIZE * LINE * 3);
        autoTable(doc, {
          startY: y,
          margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 18 },
          head: [block.header.map(inline)],
          body: block.rows.map((row) => row.map(inline)),
          theme: "grid",
          showHead: "everyPage",
          styles: {
            font: "helvetica",
            fontSize: 9,
            cellPadding: 5,
            textColor: INK,
            lineColor: BORDER,
            lineWidth: 0.5,
            overflow: "linebreak",
            valign: "top",
          },
          headStyles: { fillColor: SURFACE, textColor: INK, fontStyle: "bold" },
          bodyStyles: { fillColor: [255, 255, 255] },
        });
        y = ((doc as unknown as LastTable).lastAutoTable?.finalY ?? y) + 14;
        break;
      }
      case "code": {
        doc.setFont("courier", "normal");
        const lines = block.text.split("\n").flatMap((line) => doc.splitTextToSize(pdfText(line) || " ", width - 16) as string[]);
        const step = 9 * LINE;
        let index = 0;
        while (index < lines.length) {
          ensure(step + 12);
          const room = Math.max(1, Math.floor((bottom - y - 12) / step));
          const part = lines.slice(index, index + room);
          doc.setFillColor(...SURFACE);
          doc.rect(MARGIN, y, width, part.length * step + 12, "F");
          y += 6;
          writeLines(part, 9, MARGIN + 8);
          y += 6;
          index += part.length;
        }
        y += 8;
        break;
      }
      case "quote": {
        doc.setFont("helvetica", "italic");
        const start = y;
        writeLines(doc.splitTextToSize(inline(block.content), width - 16) as string[], BODY_SIZE, MARGIN + 14, MUTED);
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(3);
        if (y > start) doc.line(MARGIN + 2, start, MARGIN + 2, y);
        y += 8;
        break;
      }
      case "rule": {
        ensure(16);
        y += 6;
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.75);
        doc.line(MARGIN, y, pageWidth - MARGIN, y);
        y += 12;
        break;
      }
      case "image": {
        doc.setFont("helvetica", "italic");
        writeLines([pdfText(`[Image: ${block.alt || block.src}]`)], 9, MARGIN, MUTED);
        y += 6;
        break;
      }
    }
  }

  // Footer on every page: project, title and page number, as on a drawing sheet.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, pageHeight - MARGIN + 2, pageWidth - MARGIN, pageHeight - MARGIN + 2);
    doc.text(pdfText(`${meta.projectName}  ·  ${meta.title}`).slice(0, 110), MARGIN, pageHeight - MARGIN + 14);
    doc.text(`Page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN + 14, { align: "right" });
  }

  return doc.output("arraybuffer");
}
