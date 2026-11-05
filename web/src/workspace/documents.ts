// Reads the text of a file the team adds to a project's documents, in the browser, so the chat
// assistant can read it later without opening the file again.
import type { PageText } from "../lib/engine";
import type { NewDocument } from "./types";

/** The same margin as a stored permit set: Firestore refuses documents over 1 MiB. */
export const MAX_DOCUMENT_CHARS = 900_000;
/** 200 MB, the same limit as a permit set (and storage.rules). */
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;
/** Plain text is split into parts this long, so the assistant can read a long file a part at a time. */
const PART_CHARS = 4_000;

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|html?|rtf|log)$/i;

export type ReadPdf = (file: File) => Promise<PageText[]>;

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isText(file: File) {
  return file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXTENSIONS.test(file.name);
}

/** Splits plain text into parts at line breaks, about PART_CHARS each. */
export function splitText(text: string): PageText[] {
  const parts: PageText[] = [];
  let rest = text.replace(/\r\n/g, "\n");
  while (rest.length > 0) {
    let cut = rest.length <= PART_CHARS ? rest.length : rest.lastIndexOf("\n", PART_CHARS);
    if (cut < PART_CHARS / 2) cut = Math.min(PART_CHARS, rest.length);
    parts.push({ page: parts.length + 1, text: rest.slice(0, cut) });
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  return parts;
}

/** Keeps whole pages until the text limit; says when the rest was left out. */
export function capPages(pages: PageText[]): { pages: PageText[]; truncated: boolean } {
  let used = 0;
  const kept: PageText[] = [];
  for (const p of pages) {
    if (used + p.text.length > MAX_DOCUMENT_CHARS) return { pages: kept, truncated: true };
    kept.push(p);
    used += p.text.length;
  }
  return { pages: kept, truncated: false };
}

function readText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

/** What a file becomes in the project's documents: the file, its type and its text. */
export async function readDocument(file: File, uploadedBy: string, readPdf: ReadPdf, chatId?: string): Promise<NewDocument> {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`${file.name} is over 200 MB. Upload a smaller file.`);
  let pages: PageText[] = [];
  if (isPdf(file)) {
    try {
      pages = (await readPdf(file)).filter((p) => p.text.trim() !== "");
    } catch {
      // A scan or a damaged PDF: keep the file; the assistant just cannot read it.
      pages = [];
    }
  } else if (isText(file)) {
    pages = splitText(await readText(file));
  }
  const capped = capPages(pages);
  return {
    file,
    name: file.name,
    contentType: file.type || (isPdf(file) ? "application/pdf" : "application/octet-stream"),
    uploadedBy,
    pages: capped.pages,
    ...(capped.truncated ? { truncated: true } : {}),
    ...(chatId ? { chatId } : {}),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "PDF", "Image", "Spreadsheet"… for the documents list. */
export function fileKind(contentType: string, name: string): string {
  if (contentType === "application/pdf" || /\.pdf$/i.test(name)) return "PDF";
  if (contentType.startsWith("image/")) return "Image";
  if (/\.(xlsx?|csv|tsv|numbers)$/i.test(name)) return "Spreadsheet";
  if (/\.(docx?|pages|rtf)$/i.test(name)) return "Word document";
  if (/\.(dwg|dxf|rvt|skp)$/i.test(name)) return "Drawing file";
  if (contentType.startsWith("text/") || TEXT_EXTENSIONS.test(name)) return "Text";
  return "File";
}
