// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPdf, pdfText } from "./exportPdf";
import { parseMarkdown } from "./markdown";
import { SAMPLE_REPORT_MD } from "./fixtures";
import { exportFileName, type ExportMeta } from "./exportMeta";

const meta: ExportMeta = {
  title: "Sample issue report: 428 El Rio Rd",
  projectName: "El Rio remodel",
  date: new Date("2026-11-05T15:00:00Z"),
  author: "Dana Lee",
  version: 3,
};

describe("PDF export", () => {
  const bytes = Buffer.from(buildPdf(parseMarkdown(SAMPLE_REPORT_MD).slice(1), meta)).toString("latin1");

  it("makes a PDF file", () => {
    expect(bytes.startsWith("%PDF-")).toBe(true);
    expect(bytes.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("has a title block with the project name and the date", () => {
    expect(bytes).toContain("EL RIO REMODEL");
    expect(bytes).toContain("Sample issue report: 428 El Rio Rd");
    expect(bytes).toContain("Nov 5, 2026");
  });

  it("keeps headings as larger serif text", () => {
    expect(bytes).toContain("(Findings) Tj");
    expect(bytes).toMatch(/\/BaseFont \/Times-Bold/);
    expect(bytes).toMatch(/ 16 Tf/);
  });

  it("keeps the table cells", () => {
    for (const cell of ["Sheet", "Suggested fix", "A-0.1", "T-24"]) expect(bytes).toContain(cell);
  });

  it("numbers the pages", () => {
    expect(bytes).toMatch(/Page 1 of \d/);
  });

  it("maps text the built-in fonts cannot draw", () => {
    expect(pdfText("“Quote” — A‑1 → ok ✓")).not.toMatch(/[^\x20-\xff]/);
  });

  it("names the file after the title and version", () => {
    expect(exportFileName(meta, "pdf")).toMatch(/^sample-issue-report-428-el-rio-rd.*v3\.pdf$/);
  });
});
