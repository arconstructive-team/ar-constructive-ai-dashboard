import type { EngineOptions, EngineResult, Finding, PageText, RuleContext, RuleFamily } from "./types";
import { classifyPages } from "./classify";
import { getPack } from "./packs";
import { findFirst } from "./text";
import {
  areaRules,
  codeYearRules,
  contradictionRules,
  crossReferenceRules,
  dateRules,
  jurisdictionRules,
  thirdPartyRules,
  titleBlockRules,
} from "./rules";

export * from "./types";
export { classifyPages, parseSheetIndex, readTitleBlock } from "./classify";
export { DANVILLE_2025, getPack } from "./packs";
export { itemsToText } from "./text";
export { coverAreas } from "./rules";

export const RULE_FAMILY_ORDER: RuleFamily[] = ["JB", "CD", "CY", "AR", "XR", "TB", "DT", "TP"];
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

export function buildContext(input: PageText[], options: EngineOptions = {}): RuleContext {
  const { pages, index } = classifyPages(input);
  const cover = pages.find((p) => p.sheet === "A-0.1") ?? pages.find((p) => p.kind === "architectural");
  const fromOptions = options.address ? /^\s*(\d{1,6})\b/.exec(options.address)?.[1] : undefined;
  const fromBlocks = mostCommon(
    pages
      .filter((p) => p.kind === "architectural" && p.address)
      .map((p) => /^(\d+)/.exec(p.address!)?.[1] ?? "")
      .filter(Boolean),
  );
  const stories = cover ? findFirst(cover.text, /NUMBER\s+OF\s+STORIES\s*:\s*(\d+)/i) : null;
  return {
    pages,
    index,
    cover,
    pack: getPack(options.jurisdiction),
    options,
    projectNumber: fromOptions ?? fromBlocks,
    stories: stories ? Number(stories.groups[0]) : null,
  };
}

/** Runs every rule family on the extracted page text of one permit set. */
export function runEngine(input: PageText[], options: EngineOptions = {}): EngineResult {
  const ctx = buildContext(input, options);
  const xr = crossReferenceRules(ctx);
  const tp = thirdPartyRules(ctx);
  const findings: Finding[] = [
    ...jurisdictionRules(ctx),
    ...contradictionRules(ctx),
    ...codeYearRules(ctx),
    ...areaRules(ctx),
    ...xr.findings,
    ...titleBlockRules(ctx),
    ...dateRules(ctx),
    ...tp.findings,
  ].sort(
    (a, b) =>
      (a.pages[0] ?? 0) - (b.pages[0] ?? 0) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.rule_id.localeCompare(b.rule_id),
  );
  const counts = Object.fromEntries(RULE_FAMILY_ORDER.map((f) => [f, 0])) as Record<RuleFamily, number>;
  for (const f of findings) counts[f.family] += 1;
  return {
    pack: ctx.pack.id,
    pack_name: ctx.pack.name,
    code_cycle: ctx.pack.codeCycle,
    pages: ctx.pages.map((p) => ({
      page: p.page,
      sheet: p.sheet,
      label: p.label,
      kind: p.kind,
      title: p.title,
      date: p.date,
      address: p.address,
      method: p.method,
    })),
    sheet_index: ctx.index,
    findings,
    missing: [...xr.missing, ...tp.missing],
    counts,
  };
}

export interface SheetGroup {
  sheet: string;
  page: number | null;
  findings: Finding[];
}

/** Findings grouped by the first sheet each one names, in page order. */
export function groupBySheet(findings: Finding[]): SheetGroup[] {
  const groups = new Map<string, SheetGroup>();
  for (const f of findings) {
    const sheet = f.sheets[0] ?? "Whole set";
    const group = groups.get(sheet) ?? { sheet, page: f.pages[0] ?? null, findings: [] };
    group.findings.push(f);
    groups.set(sheet, group);
  }
  return [...groups.values()].sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9));
}

const CSV_COLUMNS = ["sheet", "rule_id", "family", "severity", "title", "sheets", "pages", "evidence", "suggested_fix"];

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The findings as CSV, one row per finding, for a spreadsheet. */
export function toCsv(findings: Finding[]): string {
  const rows = findings.map((f) =>
    [
      f.sheets[0] ?? "",
      f.rule_id,
      f.family,
      f.severity,
      f.title,
      f.sheets.join("; "),
      f.pages.join("; "),
      f.evidence,
      f.suggested_fix,
    ].map(csvCell).join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
