import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageText } from "../../../src/engine";

const here = dirname(fileURLToPath(import.meta.url));

/** The architectural title block, exactly as PDF.js extracts it from the 428 El Rio set. */
export function archTitleBlock(sheet: string, title: string[], date = "05/18/2026"): string {
  return [
    "PROJECT NAME",
    "SHEET TITLE",
    "DATE DESCRIPTIONNO.",
    "ISSUES / REVISIONS",
    "DRAWN",
    "CHECKED",
    "DATE",
    "REVISED DATE",
    "JOB NO.",
    "SHEET NO.",
    "",
    sheet,
    "",
    "05/15/2026",
    "M.SH",
    "A.HK.",
    date,
    "22-1955",
    ...title,
    "428 EL RIO ,",
    "DANVILLE, CA",
    "94526",
    "",
  ].join("\n");
}

/** The structural title block of the S&P Professional Engineers sheets. */
export function structTitleBlock(sheet: string, title: string[], date = "08.14.2026"): string {
  return [
    "DRAWN BY",
    sheet,
    ...title,
    "REVISED DATE",
    "PROJECT #",
    "REVISIONS",
    "1724 Carriage Dr,",
    "Walnut Creek, CA 94598",
    "S&P PROFESSIONAL",
    "ENGINEERS",
    "Pghaffari@sp-engs.com",
    "925-239-6686",
    "DATE",
    "CHECKED BY",
    "Z.O.",
    "P.G.",
    date,
    "428 El Rio Road",
    "Danville, California",
    "94526",
    "22-1955",
    "",
  ].join("\n");
}

export const ARCH_BACKGROUND = readFileSync(join(here, "arch-background.txt"), "utf8");

/** An architectural page: its own title block, the page body, then the template's leftover layers. */
export function archPage(page: number, sheet: string, title: string[], body: string): PageText {
  return { page, text: `${archTitleBlock(sheet, title)}${body}\n${ARCH_BACKGROUND}` };
}

export function structPage(page: number, sheet: string, title: string[], body: string, date?: string): PageText {
  return { page, text: `${structTitleBlock(sheet, title, date)}${body}\n` };
}

const HEADER = /^=== (\d+) (arch|struct|raw)(?: (\S+) (.+?))? ===$/;

/** Loads the 51 pages of the 428 El Rio permit set (see README.md). */
export function loadElRio(): PageText[] {
  const source = readFileSync(join(here, "pages.txt"), "utf8");
  const pages: PageText[] = [];
  let header: RegExpExecArray | null = null;
  let body: string[] = [];
  const flush = () => {
    if (!header) return;
    const [, num, kind, sheet, title] = header;
    const text = body.join("\n");
    const titleLines = (title ?? "").split("|");
    if (kind === "arch") pages.push(archPage(Number(num), sheet, titleLines, text));
    else if (kind === "struct") pages.push(structPage(Number(num), sheet, titleLines, text));
    else pages.push({ page: Number(num), text: `${text}\n` });
  };
  for (const line of source.split("\n")) {
    const m = HEADER.exec(line);
    if (m) {
      flush();
      header = m;
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return pages;
}
