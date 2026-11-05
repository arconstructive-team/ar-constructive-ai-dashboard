// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildDocxDocument } from "./exportDocx";
import { parseMarkdown } from "./markdown";
import { SAMPLE_REPORT_MD } from "./fixtures";

const meta = {
  title: "Sample issue report: 428 El Rio Rd",
  projectName: "El Rio remodel",
  date: new Date("2026-11-05T15:00:00Z"),
  author: "Dana Lee",
  version: 3,
};

async function documentXml(): Promise<string> {
  const buffer = await Packer.toBuffer(buildDocxDocument(parseMarkdown(SAMPLE_REPORT_MD).slice(1), meta));
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("The Word file has no document part.");
  return file.async("string");
}

describe("Word export", () => {
  it("makes a Word file with a title block", async () => {
    const xml = await documentXml();
    expect(xml).toContain('w:val="Title"');
    expect(xml).toContain("Sample issue report: 428 El Rio Rd");
    expect(xml).toContain("El Rio remodel");
    expect(xml).toContain("Nov 5, 2026");
  });

  it("keeps headings as Word heading styles", async () => {
    const xml = await documentXml();
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain("Findings");
  });

  it("keeps tables as Word tables with a repeating header row", async () => {
    const xml = await documentXml();
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:tblHeader");
    for (const cell of ["Sheet", "Suggested fix", "A-0.1", "T-24"]) expect(xml).toContain(cell);
  });
});
