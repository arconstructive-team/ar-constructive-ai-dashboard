// A small PDF writer for the regenerated sheets. It has no dependencies, so the API and the
// browser make the same file. Each text line is its own text object, so a PDF reader
// (PDF.js) extracts the lines in the same order as `layoutSheet` returns them.
import type { SheetSection } from "./types";

/** 11 x 17 inch sheet, landscape, in PDF points. */
export const PAGE_WIDTH = 1224;
export const PAGE_HEIGHT = 792;
const MARGIN = 36;
const BLOCK_WIDTH = 170;
const BLOCK_X = PAGE_WIDTH - MARGIN - BLOCK_WIDTH + 10;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN - BLOCK_WIDTH - 10;
const COLUMNS = 3;
const GAP = 16;
const TOP = PAGE_HEIGHT - MARGIN - 14;
const BOTTOM = MARGIN + 10;
// Helvetica capitals average about 0.62 em with spaces; wrap on that width.
const CHAR_EM = 0.62;

export interface PlacedLine {
  x: number;
  y: number;
  size: number;
  bold: boolean;
  text: string;
}

export interface SheetLayoutInput {
  titleBlock: string[];
  sections: SheetSection[];
}

/** Breaks one paragraph into lines of at most `max` characters, on spaces. */
export function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= max) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    while (line.length > max) {
      out.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line) out.push(line);
  return out;
}

function flowContent(sections: SheetSection[], size: number): PlacedLine[] | null {
  const width = (CONTENT_RIGHT - MARGIN - GAP * (COLUMNS - 1)) / COLUMNS;
  const leading = size * 1.3;
  const max = Math.floor(width / (size * CHAR_EM));
  const out: PlacedLine[] = [];
  let column = 0;
  let y = TOP;
  const place = (text: string, bold: boolean, lineSize: number): boolean => {
    if (y < BOTTOM) {
      column += 1;
      y = TOP;
      if (column >= COLUMNS) return false;
    }
    out.push({ x: MARGIN + column * (width + GAP), y, size: lineSize, bold, text });
    y -= leading;
    return true;
  };
  for (const section of sections) {
    // Keep a heading with at least two lines of its section.
    if (y - leading * 2 < BOTTOM && y !== TOP) {
      column += 1;
      y = TOP;
      if (column >= COLUMNS) return null;
    }
    for (const line of wrap(section.heading, Math.floor(max * 0.9))) {
      if (!place(line, true, size + 1)) return null;
    }
    for (const paragraph of section.lines) {
      for (const line of wrap(paragraph, max)) {
        if (!place(line, false, size)) return null;
      }
    }
    y -= leading * 0.6;
  }
  return out;
}

/** Places the title block (right column) first, then the notes in three columns. */
export function layoutSheet(input: SheetLayoutInput): PlacedLine[] {
  const block: PlacedLine[] = [];
  let y = TOP;
  for (const line of input.titleBlock) {
    if (line.trim()) block.push({ x: BLOCK_X, y, size: 8, bold: false, text: line });
    y -= 13;
  }
  for (const size of [8, 7, 6, 5.5, 5]) {
    const content = flowContent(input.sections, size);
    if (content) return [...block, ...content];
  }
  // Too long for one sheet even at the smallest size: print what fits.
  return [...block, ...(flowContent(input.sections.slice(0, 1), 5) ?? [])];
}

/** The text a PDF reader extracts from a laid-out sheet: one line per text object. */
export function layoutText(lines: PlacedLine[]): string {
  return lines.map((l) => l.text).join("\n") + "\n";
}

// WinAnsi covers Latin-1 for the characters the notes use; replace the rest.
function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "-");
}

function escapePdf(text: string): string {
  return toWinAnsi(text).replace(/[\\()]/g, (c) => `\\${c}`);
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function pageStream(lines: PlacedLine[]): string {
  const ops: string[] = [
    "0.6 w",
    `${MARGIN / 2} ${MARGIN / 2} ${PAGE_WIDTH - MARGIN} ${PAGE_HEIGHT - MARGIN} re S`,
    `${BLOCK_X - 10} ${MARGIN / 2} m ${BLOCK_X - 10} ${PAGE_HEIGHT - MARGIN / 2} l S`,
  ];
  for (const l of lines) {
    ops.push(`BT /${l.bold ? "F2" : "F1"} ${fmt(l.size)} Tf ${fmt(l.x)} ${fmt(l.y)} Td (${escapePdf(l.text)}) Tj ET`);
  }
  return ops.join("\n");
}

/** Writes the pages as one PDF file. Each entry is the laid-out lines of one page. */
export function writePdf(pages: PlacedLine[][], title = "Regenerated sheets"): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // Object numbers: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info, then page + stream pairs.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title (${escapePdf(title)}) /Producer (arconstructive) >>`;
  let next = 6;
  for (const lines of pages) {
    const pageId = next++;
    const streamId = next++;
    const stream = pageStream(lines);
    pageIds.push(pageId);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Every character is Latin-1, so one character is one byte.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** Base64 of the bytes, for a data: link the browser can download. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
