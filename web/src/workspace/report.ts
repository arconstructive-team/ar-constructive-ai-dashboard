// Turns a check result into artifact markdown: the issue report and the regenerated sheet set.
import { RULE_FAMILY_ORDER, groupBySheet, type CheckResult, type RegeneratedSet } from "../lib/engine";
import { RULE_FAMILIES, type ProjectData } from "../lib/project";

const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** Makes text safe inside one markdown table cell. */
export function cell(value: string): string {
  return value.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim() || "—";
}

export function issueReportTitle(project: ProjectData): string {
  return `Issue report: ${project.address.trim() || "permit set"}`;
}

export function sheetSetTitle(set: RegeneratedSet): string {
  return `Regenerated sheets: ${set.address}`;
}

export function issueReportMarkdown(result: CheckResult, project: ProjectData, fileName: string): string {
  const out: string[] = [];
  const total = result.findings.length;
  out.push(`# ${issueReportTitle(project)}`);
  out.push(
    `${cell(fileName)} · ${result.pages.length} pages · ${project.jurisdiction || "No jurisdiction"} · ${project.aduType} · ${result.pack_name}`,
  );

  if (result.jurisdiction && !result.jurisdiction.matches && result.jurisdiction.detected) {
    out.push(
      `> The set names **${result.jurisdiction.detected}**${result.jurisdiction.sheet ? ` on ${result.jurisdiction.sheet}` : ""}, but it was checked as **${result.jurisdiction.selected}**. Write "check it as ${result.jurisdiction.detected}" to check it again.`,
    );
  }

  out.push("## Summary");
  out.push(total === 0 ? "The check found no issues." : `The check found ${total} ${total === 1 ? "issue" : "issues"}.`);
  out.push(
    [
      "| Rule family | Issues |",
      "| --- | --- |",
      ...RULE_FAMILY_ORDER.map((code) => {
        const family = RULE_FAMILIES.find((f) => f.code === code);
        return `| ${code} · ${family?.name ?? code} | ${result.counts[code] ?? 0} |`;
      }),
    ].join("\n"),
  );

  if (total > 0) {
    out.push("## Issues by sheet");
    for (const group of groupBySheet(result.findings)) {
      out.push(`### ${group.sheet}${group.page !== null ? ` · page ${group.page}` : ""}`);
      out.push(
        [
          "| Rule | Severity | Issue | Evidence | Suggested fix |",
          "| --- | --- | --- | --- | --- |",
          ...group.findings.map(
            (f) =>
              `| ${cell(f.rule_id)} | ${SEVERITY_LABEL[f.severity]} | ${cell(f.title)} | ${cell(f.evidence)} | ${cell(f.suggested_fix)} |`,
          ),
        ].join("\n"),
      );
    }
  }

  if (result.missing.length > 0) {
    out.push("## Missing from the set");
    out.push(
      [
        "| Item | Why it is needed | Cited on |",
        "| --- | --- | --- |",
        ...result.missing.map((m) => `| ${cell(m.item)} | ${cell(m.reason)} | ${cell(m.cited_on.join(", "))} |`),
      ].join("\n"),
    );
  }

  out.push("The architect of record approves every finding. We never stamp or sign sheets, and we never edit vendor documents.");
  return out.join("\n\n") + "\n";
}

export function sheetSetMarkdown(set: RegeneratedSet): string {
  const out: string[] = [];
  out.push(`# ${sheetSetTitle(set)}`);
  out.push(`Cover data and notes written again under the ${set.code_cycle} codes (${set.pack_name}).`);
  for (const sheet of set.sheets) {
    out.push(`## ${sheet.sheet} · ${sheet.title}`);
    out.push(
      `${sheet.original_page !== null ? `Replaces page ${sheet.original_page}` : "New sheet"} · ${sheet.date}${sheet.job ? ` · job ${sheet.job}` : ""} · ${sheet.address.join(" ")}`,
    );
    for (const section of sheet.sections) {
      out.push(`### ${section.heading}`);
      out.push(section.lines.filter((line) => line.trim().length > 0).join("\n\n") || "—");
    }
  }
  if (set.to_confirm.length > 0) {
    out.push("## Check before you issue these sheets");
    out.push(set.to_confirm.map((item) => `- ${item}`).join("\n"));
  }
  if (set.findings.length > 0) {
    out.push("## Still to check on the regenerated sheets");
    out.push(
      [
        "| Sheet | Rule | Issue |",
        "| --- | --- | --- |",
        ...set.findings.map((f) => `| ${cell(f.sheets[0] ?? "Whole set")} | ${cell(f.rule_id)} | ${cell(f.title)} |`),
      ].join("\n"),
    );
  }
  return out.join("\n\n") + "\n";
}

/**
 * Splits markdown into growing prefixes, so generation can write the document a part at a time.
 * The last prefix is the whole text.
 */
export function progressiveParts(markdown: string, parts = 6): string[] {
  const blocks = markdown.split(/\n{2,}/);
  const size = Math.max(1, Math.ceil(blocks.length / parts));
  const out: string[] = [];
  for (let end = size; end < blocks.length; end += size) out.push(blocks.slice(0, end).join("\n\n") + "\n");
  out.push(markdown);
  return out;
}
