import type { ClassifiedPage, Finding, PageKind, RuleFamily, Severity } from "./types";

/** A sheet number: A-0.1, AD-6.3, S-2.1, T-1, G-2, HFX3. */
export const SHEET_ID = String.raw`(?:HFX\d+|(?:AD|[AGSTCLMEP])-\d+(?:\.\d+)?)`;
const SHEET_LINE = new RegExp(`^${SHEET_ID}$`);

export function isSheetId(value: string): boolean {
  return SHEET_LINE.test(value.trim());
}

export function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A short quote around a match, with whitespace collapsed. */
export function snippet(text: string, index: number, length: number, radius = 90): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? "…" : ""}${collapse(text.slice(start, end))}${end < text.length ? "…" : ""}`;
}

export interface Match {
  index: number;
  text: string;
  groups: string[];
}

export function findAll(text: string, re: RegExp): Match[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const out: Match[] = [];
  for (const m of text.matchAll(new RegExp(re.source, flags))) {
    out.push({ index: m.index ?? 0, text: m[0], groups: m.slice(1).map((g) => g ?? "") });
  }
  return out;
}

export function findFirst(text: string, re: RegExp): Match | null {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(text);
  return m ? { index: m.index, text: m[0], groups: m.slice(1).map((g) => g ?? "") } : null;
}

/** The earliest match of any of the patterns. */
export function firstOf(text: string, patterns: RegExp[]): Match | null {
  let best: Match | null = null;
  for (const re of patterns) {
    const m = findFirst(text, re);
    if (m && (!best || m.index < best.index)) best = m;
  }
  return best;
}

/** Reads 05/18/2026, 7/10/2026, 08.14.2026 or 01/06/16 as yyyy-mm-dd. */
export function parseDate(raw: string): string | null {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function firstSlashDate(text: string): string | null {
  for (const m of findAll(text, /\b\d{1,2}\/\d{1,2}\/\d{4}\b/)) {
    const iso = parseDate(m.text);
    if (iso) return iso;
  }
  return null;
}

/** Joins PDF.js text items into page text: one line per end-of-line mark. */
export function itemsToText(items: ReadonlyArray<unknown>): string {
  let out = "";
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { str, hasEOL } = item as { str?: unknown; hasEOL?: unknown };
    if (typeof str === "string") out += str;
    if (hasEOL === true) out += "\n";
  }
  return out;
}

export function toNumber(value: string): number {
  return Number(value.replace(/,/g, ""));
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Sheets an architect draws (not vendor or consultant documents). */
export const DESIGN_KINDS: ReadonlySet<PageKind> = new Set(["architectural", "structural", "general"]);

export function makeFinding(input: {
  rule_id: string;
  severity: Severity;
  title: string;
  subject: string;
  pages: ClassifiedPage[];
  evidence: string;
  suggested_fix: string;
}): Finding {
  const byPage = new Map<number, ClassifiedPage>();
  for (const p of input.pages) byPage.set(p.page, p);
  const sorted = [...byPage.values()].sort((a, b) => a.page - b.page);
  return {
    rule_id: input.rule_id,
    family: input.rule_id.slice(0, 2) as RuleFamily,
    severity: input.severity,
    title: input.title,
    subject: input.subject,
    sheets: unique(sorted.map((p) => p.label)),
    pages: sorted.map((p) => p.page),
    evidence: input.evidence,
    suggested_fix: input.suggested_fix,
  };
}

/** "A-2.1, A-2.2 and 3 more" style list for evidence text. */
export function listSheets(labels: string[], max = 6): string {
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`;
}
