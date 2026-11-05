import { describe, expect, it } from "vitest";
import { cell, issueReportMarkdown, progressiveParts, sheetSetMarkdown } from "./report";
import { parseMarkdown } from "./MarkdownPreview";
import { PAGES, fakeCheck } from "./fixtures.test-utils";

const PROJECT = { address: "428 El Rio Rd, Danville", jurisdiction: "City of San Ramon" as const, aduType: "No ADU" as const };

describe("artifact markdown", () => {
  it("writes the issue report with a summary table and the issues by sheet", () => {
    const md = issueReportMarkdown(fakeCheck(PAGES, PROJECT), PROJECT, "set.pdf");
    expect(md.startsWith("# Issue report: 428 El Rio Rd, Danville")).toBe(true);
    expect(md).toContain("| JB · Jurisdiction boilerplate | 1 |");
    expect(md).toContain("### A-5.3 · page 2");
    // A pipe in the evidence is escaped, so the table keeps its columns.
    expect(md).toContain("CITY OF LAFAYETTE \\| FIRE NOTES");
    expect(md).toContain("The set names **Town of Danville**");

    const tables = parseMarkdown(md).filter((b) => b.kind === "table");
    expect(tables).toHaveLength(2);
    const issues = tables[1];
    if (issues.kind !== "table") throw new Error("not a table");
    expect(issues.head).toEqual(["Rule", "Severity", "Issue", "Evidence", "Suggested fix"]);
    expect(issues.rows[0][3]).toBe("CITY OF LAFAYETTE | FIRE NOTES");
  });

  it("writes the regenerated sheets with their notes and the list to check", () => {
    const set = fakeCheck(PAGES, PROJECT).regenerated;
    if (!set) throw new Error("no sheets");
    const md = sheetSetMarkdown(set);
    expect(md).toContain("# Regenerated sheets: 428 EL RIO RD, DANVILLE");
    expect(md).toContain("## A-0.1 · COVER SHEET");
    expect(md).toContain("All work shall comply with the City of San Ramon code.");
    expect(md).toContain("- Confirm the APN on A-0.1.");
  });

  it("splits a document into growing parts that end with the whole text", () => {
    const md = issueReportMarkdown(fakeCheck(PAGES, PROJECT), PROJECT, "set.pdf");
    const parts = progressiveParts(md);
    expect(parts.length).toBeGreaterThan(2);
    for (let i = 1; i < parts.length; i++) expect(parts[i].length).toBeGreaterThan(parts[i - 1].length);
    expect(parts[parts.length - 1]).toBe(md);
  });

  it("keeps table cells on one line", () => {
    expect(cell("a\nb | c")).toBe("a b \\| c");
    expect(cell("  ")).toBe("—");
  });
});
