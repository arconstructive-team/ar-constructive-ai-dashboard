import type { ClassifiedPage, ClassifyMethod, PageKind, PageText } from "./types";
import { SHEET_ID, findAll, firstSlashDate, isSheetId, parseDate } from "./text";

export interface TitleBlock {
  sheet: string;
  title: string;
  date: string | null;
  address: string | null;
}

// Architectural title block: "SHEET NO.\n\nA-5.3\n\n05/15/2026\nM.SH\nA.HK.\n05/18/2026\n22-1955\n<title>\n428 EL RIO ,".
const ARCH_RE = new RegExp(String.raw`SHEET NO\.[ \t]*\n\s*(${SHEET_ID})[ \t]*\n`);
// Structural title block: "DRAWN BY\nS-1.0\n<title>\n...\n08.14.2026".
const STRUCT_RE = /DRAWN BY[ \t]*\n\s*(S-\d+(?:\.\d+)?)[ \t]*\n/;
const DOT_DATE = /\b\d{2}\.\d{2}\.\d{4}\b/;
const SURVEY_RE = /TOPOGRAPHIC SURVEY|BOUNDARY SURVEY|ALTA\/NSPS/i;

/** Reads the sheet number, title and primary date from a page's own title block. */
export function readTitleBlock(text: string): TitleBlock | null {
  const arch = ARCH_RE.exec(text);
  if (arch) {
    const lines = text
      .slice(arch.index + arch[0].length)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 14);
    const job = lines.findIndex((l) => /^\d{2}-\d{3,5}$/.test(l));
    const head = job === -1 ? lines.slice(0, 4) : lines.slice(0, job);
    const dates = head.map((l) => parseDate(l)).filter((d): d is string => d !== null);
    const title: string[] = [];
    let address: string | null = null;
    if (job !== -1) {
      for (const l of lines.slice(job + 1)) {
        if (/^\d+\s/.test(l)) {
          address = l.replace(/\s*,$/, "");
          break;
        }
        if (title.length >= 4) break;
        title.push(l);
      }
    }
    return {
      sheet: arch[1].toUpperCase(),
      title: title.join(" "),
      date: dates[dates.length - 1] ?? null,
      address,
    };
  }

  const struct = STRUCT_RE.exec(text);
  if (struct) {
    const rest = text.slice(struct.index + struct[0].length);
    const head = rest.slice(0, 600);
    const title = rest.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    const dot = DOT_DATE.exec(head);
    const addr = /^(\d{1,6} [^\n]+)$/m.exec(head.slice(dot ? dot.index : 0));
    return { sheet: struct[1], title, date: dot ? parseDate(dot[0]) : null, address: addr ? addr[1].trim() : null };
  }

  // Title 24 and similar pages print the sheet number alone on the first line.
  const first = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (isSheetId(first)) {
    const addr = /^(\d{1,6} [A-Za-z][^\n]*?),\s*[A-Za-z .]+,\s*CA\b/im.exec(text);
    return {
      sheet: first.toUpperCase(),
      title: /TITLE 24/i.test(text) ? "Title 24" : "",
      date: null,
      address: addr ? addr[1].trim() : null,
    };
  }
  return null;
}

/**
 * Reads the sheet index printed on the cover. The PDF text puts the index as columns: a run
 * of titles, then a run of sheet numbers. Every run of five or more lines that each start
 * with a sheet number is an index column; the columns are joined in page order.
 */
export function parseSheetIndex(text: string): string[] {
  const entry = new RegExp(`^(${SHEET_ID})(?![\\w.-])`);
  const entries: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length >= 5) entries.push(...run);
    run = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = entry.exec(line);
    if (m) run.push(m[1].toUpperCase());
    else close();
  }
  close();
  return entries;
}

function kindOf(sheet: string, method: ClassifyMethod, text: string): PageKind {
  if (method !== "title-block" && SURVEY_RE.test(text)) return "survey";
  if (/^AD?-/.test(sheet)) return "architectural";
  if (sheet.startsWith("S-")) return "structural";
  if (sheet.startsWith("T-")) return "title24";
  if (sheet.startsWith("G-")) return "general";
  return "other";
}

const DEFAULT_TITLES: Record<PageKind, string> = {
  architectural: "Architectural sheet",
  structural: "Structural sheet",
  title24: "Title 24",
  survey: "Topographic survey",
  general: "General sheet",
  other: "Other document",
};

/**
 * Gives every page a sheet number. A page's own title block wins. A page without one
 * (a survey, a vendor sheet) takes the next unused entry of the cover's sheet index.
 */
export function classifyPages(input: PageText[]): { pages: ClassifiedPage[]; index: string[] } {
  const sorted = [...input].sort((a, b) => a.page - b.page);
  const blocks = sorted.map((p) => readTitleBlock(p.text));
  const coverAt = blocks.findIndex((b) => b?.sheet === "A-0.1");
  const index = parseSheetIndex(sorted[coverAt === -1 ? 0 : coverAt]?.text ?? "");
  const detected = new Set(blocks.filter((b): b is TitleBlock => b !== null).map((b) => b.sheet));

  let pointer = 0;
  const pages = sorted.map((p, i): ClassifiedPage => {
    const block = blocks[i];
    let sheet: string;
    let method: ClassifyMethod;
    if (block) {
      sheet = block.sheet;
      method = "title-block";
      const at = index.indexOf(sheet, pointer);
      if (at !== -1) pointer = at + 1;
    } else {
      while (pointer < index.length && detected.has(index[pointer])) pointer++;
      if (pointer < index.length) {
        sheet = index[pointer++];
        method = "index-order";
      } else {
        sheet = `PAGE-${p.page}`;
        method = "unknown";
      }
    }
    const kind = kindOf(sheet, method, p.text);
    const label = kind === "title24" && /\bJ?ADU\b/.test(p.text) ? `${sheet} (ADU)` : sheet;
    const date = block?.date ?? (kind === "survey" ? firstSlashDate(p.text) : null);
    return {
      page: p.page,
      sheet,
      label,
      kind,
      title: block?.title || DEFAULT_TITLES[kind],
      date,
      address: block?.address ?? null,
      method,
      text: p.text,
    };
  });
  return { pages, index };
}

/** Sheet numbers cited in a text run such as "SEE SHEETS A-5.0, A-5.2 & AD-6.8". */
export function sheetIdsIn(text: string): string[] {
  return findAll(text, new RegExp(SHEET_ID, "i")).map((m) => m.text.toUpperCase());
}
