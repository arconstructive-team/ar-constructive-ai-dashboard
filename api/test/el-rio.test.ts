import { describe, expect, it } from "vitest";
import { runEngine, type Finding } from "../src/engine";
import { loadElRio } from "./fixtures/el-rio/load";

const result = runEngine(loadElRio(), {
  jurisdiction: "Town of Danville",
  aduType: "Attached ADU",
  address: "428 El Rio Rd, Danville, CA 94526",
});

interface Expected {
  key: string;
  rule: string;
  sheets: string[];
  /** Matches the finding's subject or evidence. */
  about?: RegExp;
}

const ARCH_SHEETS = [
  "A-0.1", "A-0.2", "A-0.3", "A-1.1", "A-2.1", "A-2.2", "A-2.3", "A-2.4", "A-2.5", "A-2.6", "A-2.7",
  "A-3.1", "A-3.2", "A-3.3", "A-3.4", "A-4.1", "A-5.1", "A-5.2", "A-5.3",
  "AD-6.1", "AD-6.2", "AD-6.3", "AD-6.4", "AD-6.7", "AD-6.8",
];

// The answer key of the PRD (AI Permit-Set Assistant PRD, "Answer key: 428 El Rio").
const ANSWER_KEY: Expected[] = [
  { key: "1 Tiburon lighting code", rule: "JB-001", sheets: ["A-0.3"], about: /Tiburon/ },
  { key: "2 Tiburon municipal code", rule: "JB-001", sheets: ["A-5.2"], about: /Tiburon/ },
  { key: "3 Berkeley code", rule: "JB-001", sheets: ["A-5.2"], about: /Berkeley/ },
  { key: "4 San Francisco building code", rule: "JB-001", sheets: ["A-5.1"], about: /San Francisco/ },
  { key: "5 Redwood City code", rule: "JB-001", sheets: ["AD-6.3"], about: /Redwood City/ },
  { key: "6 Sonoma Valley Fire", rule: "JB-002", sheets: ["A-5.3"], about: /Sonoma Valley/ },
  { key: "7 fire zone vs WUI", rule: "CD-001", sheets: ["A-0.1", "A-5.3"] },
  { key: "8 elevator shaft", rule: "CD-002", sheets: ["A-2.3", "A-2.4"], about: /elevator/i },
  { key: "9 attached ADU vs JADU", rule: "CD-003", sheets: ["A-0.1", "T-1 (ADU)", "T-2 (ADU)"], about: /JADU/ },
  { key: "10 2022 Energy Code", rule: "CY-001", sheets: ["AD-6.3"], about: /2022 California Energy Code/ },
  { key: "11 2016 / 2022 Fire Code", rule: "CY-001", sheets: ["A-5.3"], about: /2016 CFC/ },
  { key: "12 1,708 vs 1,724 sf", rule: "AR-001", sheets: ["A-0.1", "A-2.3"], about: /1,708[\s\S]*1,724/ },
  { key: "13 garage 420 vs 418 sf", rule: "AR-002", sheets: ["A-0.1"], about: /418[\s\S]*420/ },
  { key: "14 A-1.2 missing", rule: "XR-001", sheets: ["A-0.1"], about: /^A-1\.2$/ },
  { key: "15 AD-6.5 missing", rule: "XR-002", sheets: ["A-2.7"], about: /^AD-6\.5$/ },
  { key: "16 A-6.7 missing", rule: "XR-002", sheets: ["A-3.1", "A-4.1"], about: /^A-6\.7$/ },
  { key: "17 A-1.0 missing", rule: "XR-002", sheets: ["A-0.1"], about: /^A-1\.0$/ },
  { key: "18 render cited on A-0.2, is on A-0.1", rule: "XR-003", sheets: ["A-0.2", "A-0.1", "A-3.1"], about: /render/i },
  { key: "19 3rd level on a 2-story house", rule: "XR-004", sheets: ["S-3.1"], about: /3RD Level/ },
  { key: "20 4142 Canyon Road, Lafayette", rule: "TB-001", sheets: ARCH_SHEETS, about: /4142 CANYON ROAD/ },
  { key: "21a dates out of order", rule: "DT-001", sheets: ["A-0.1", "A-0.4", "S-1.0", "S-3.1"] },
  { key: "21b soils report not in set", rule: "TP-004", sheets: ["S-1.0"], about: /Soils report/ },
];

function matches(f: Finding, e: Expected): boolean {
  if (f.rule_id !== e.rule) return false;
  if (!e.sheets.every((s) => f.sheets.includes(s))) return false;
  return !e.about || e.about.test(f.subject) || e.about.test(f.evidence);
}

describe("428 El Rio acceptance test", () => {
  it("finds all 22 answer-key findings with the right sheets", () => {
    const unmatched = ANSWER_KEY.filter((e) => !result.findings.some((f) => matches(f, e)));
    expect(unmatched.map((e) => e.key)).toEqual([]);
    expect(ANSWER_KEY).toHaveLength(22);
  });

  it("reports no more than 5 other findings", () => {
    const used = new Set<Finding>();
    for (const e of ANSWER_KEY) {
      const f = result.findings.find((x) => !used.has(x) && matches(x, e));
      if (f) used.add(f);
    }
    const extra = result.findings.filter((f) => !used.has(f));
    expect(used.size).toBe(22);
    expect(extra.length, extra.map((f) => `${f.rule_id} ${f.subject} ${f.sheets.join(",")}`).join("\n")).toBeLessThanOrEqual(5);
  });

  it("lists the elevator-shaft finding under A-2.3", () => {
    const cd = result.findings.find((f) => f.rule_id === "CD-002");
    expect(cd?.sheets[0]).toBe("A-2.3");
  });

  it("classifies all 51 pages", () => {
    expect(result.pages).toHaveLength(51);
    expect(result.pages.filter((p) => p.method === "unknown")).toEqual([]);
    const labels = result.pages.map((p) => p.label);
    expect(labels.slice(0, 5)).toEqual(["A-0.1", "A-0.2", "A-0.3", "A-0.4", "A-1.1"]);
    expect(labels.slice(26, 32)).toEqual(["G-1", "G-2", "T-1", "T-2", "T-1 (ADU)", "T-2 (ADU)"]);
    expect(labels.slice(48)).toEqual(["HFX1", "HFX2", "HFX3"]);
    expect(result.pages[3]).toMatchObject({ kind: "survey", method: "index-order", date: "2026-07-10" });
    expect(result.pages[40]).toMatchObject({ sheet: "S-3.1", kind: "structural", date: "2026-08-14" });
    expect(result.sheet_index).toHaveLength(52);
  });

  it("reports A-1.2, A-1.0, AD-6.5, A-6.7 and the soils report as missing", () => {
    const missing = result.missing.map((m) => m.item);
    for (const item of ["A-1.2", "A-1.0", "AD-6.5", "A-6.7", "Soils report"]) {
      expect(missing).toContain(item);
    }
  });

  it("counts findings by family", () => {
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.findings.length);
    expect(result.pack).toBe("danville-2025");
  });
});
