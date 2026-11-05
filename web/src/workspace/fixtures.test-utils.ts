// Test helpers: a small check result in the shape the engine returns.
import type { CheckResult, Finding, PageText } from "../lib/engine";
import type { ProjectData } from "../lib/project";

export const PAGES: PageText[] = [
  { page: 1, text: "A-0.1 COVER SHEET 428 EL RIO RD, DANVILLE" },
  { page: 2, text: "A-5.3 FIRE NOTES SAN RAMON VALLEY FIRE" },
];

export function pdfFile(name = "428-el-rio.pdf"): File {
  return new File(["%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"], name, { type: "application/pdf" });
}

const jb = (jurisdiction: string): Finding => ({
  rule_id: "JB-01",
  family: "JB",
  severity: "high",
  title: `Boilerplate names another city than ${jurisdiction}`,
  subject: "Jurisdiction",
  sheets: ["A-5.3"],
  pages: [2],
  evidence: "CITY OF LAFAYETTE | FIRE NOTES",
  suggested_fix: `Replace the notes with the ${jurisdiction} notes.`,
});

/** Danville sets come back clean; any other jurisdiction finds one JB issue. */
export function fakeCheck(_pages: PageText[], project: ProjectData): CheckResult {
  const findings = project.jurisdiction === "Town of Danville" ? [] : [jb(project.jurisdiction)];
  return {
    pack: "pack",
    pack_name: `${project.jurisdiction}, 2025 California codes`,
    code_cycle: 2025,
    pages: [
      { page: 1, sheet: "A-0.1", label: "A-0.1", kind: "architectural", title: "COVER SHEET", date: null, address: null, method: "title-block" },
      { page: 2, sheet: "A-5.3", label: "A-5.3", kind: "architectural", title: "FIRE NOTES", date: null, address: null, method: "title-block" },
    ],
    sheet_index: ["A-0.1", "A-5.3"],
    findings,
    missing: [],
    counts: { JB: findings.length, CD: 0, CY: 0, AR: 0, XR: 0, TB: 0, DT: 0, TP: 0 },
    jurisdiction: {
      selected: project.jurisdiction,
      detected: "Town of Danville",
      evidence: "PROJECT DATA: 428 EL RIO RD, DANVILLE",
      sheet: "A-0.1",
      page: 1,
      matches: project.jurisdiction === "Town of Danville",
    },
    regenerated: {
      pack: "pack",
      pack_name: `${project.jurisdiction}, 2025 California codes`,
      code_cycle: 2025,
      address: "428 EL RIO RD, DANVILLE",
      sheets: [
        {
          sheet: "A-0.1",
          title: "COVER SHEET",
          original_page: 1,
          date: "05/18/2026",
          job: "22-1955",
          address: ["428 EL RIO RD,", "DANVILLE, CA 94526"],
          title_block: [],
          sections: [{ heading: "JURISDICTION NOTES", lines: [`All work shall comply with the ${project.jurisdiction} code.`] }],
          text: "",
        },
      ],
      to_confirm: ["Confirm the APN on A-0.1."],
      findings: [],
    },
  };
}
