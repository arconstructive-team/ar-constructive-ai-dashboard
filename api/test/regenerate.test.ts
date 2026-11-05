import { describe, expect, it } from "vitest";
import {
  REGENERATED_SHEETS,
  readProjectFacts,
  regeneratedPdf,
  runCheck,
  runEngine,
  type EngineOptions,
  type PageText,
  type RegeneratedSet,
} from "../src/engine";
import { extractPages } from "../src/extract";
import { loadElRio } from "./fixtures/el-rio/load";

const OPTIONS: EngineOptions = {
  jurisdiction: "Town of Danville",
  aduType: "Attached ADU",
  address: "428 El Rio Rd, Danville, CA 94526",
};

const original = loadElRio();
const result = runCheck(original, OPTIONS);
const set = result.regenerated as RegeneratedSet;
const generatedPages: PageText[] = set.sheets.map((s, i) => ({ page: i + 1, text: s.text }));

// Every "<year> California <x> code" and "<year> CBC/CRC/..." citation, with any year.
const CITATION =
  /\b(\d{4}|\d{2})\s+(?:(?:CALIFORNIA|CA\.?)\s+[A-Z][A-Z -]*?CODE\b|CBC|CRC|CFC|CEC|CPC|CMC|CEBC|CWUIC|CALGREEN|CGBSC|NEC|IBC|IRC|IFC|UBC|UPC|UMC)\b/gi;

describe("regenerated sheets for 428 El Rio, Danville", () => {
  it("regenerates A-0.1, A-0.2, A-5.2 and A-5.3 and points each at its original page", () => {
    expect(set.sheets.map((s) => s.sheet)).toEqual([...REGENERATED_SHEETS]);
    const pageOf = (sheet: string) => result.pages.find((p) => p.sheet === sheet)?.page ?? null;
    for (const s of set.sheets) expect(s.original_page).toBe(pageOf(s.sheet));
    expect(set.pack).toBe("danville-2025");
  });

  it("reads the project data from the original cover", () => {
    const facts = readProjectFacts(original[0].text);
    expect(facts.owner).toBe("KNK TWO LLC");
    expect(facts.occupancy).toBe("R-3 / U");
    expect(facts.stories).toBe("2");
    expect(facts.fireZone).toBe("NO");
    expect(facts.lotSize).toBe("43,680");
    expect(facts.proposed).toContain("TOTAL FLOOR AREA (INC. GARAGE) 3,459 ± S.F.");
    expect(facts.scope).toContain("CONVERT THE EXISTING 418 SQ. FT. ATTACHED GARAGE INTO AN ATTACHED ADU");
  });

  it("the check engine finds no jurisdiction, code-year or title-block issue on the generated pages", () => {
    const check = runEngine(generatedPages, OPTIONS);
    expect(check.counts.JB).toBe(0);
    expect(check.counts.CY).toBe(0);
    expect(check.counts.TB).toBe(0);
    // The generated pages read as the same sheets of the same project.
    expect(check.pages.map((p) => p.sheet)).toEqual([...REGENERATED_SHEETS]);
    for (const p of check.pages) expect(p.address).toMatch(/^428 EL RIO/);
    expect(set.findings.filter((f) => ["JB", "CY", "TB"].includes(f.family))).toEqual([]);
  });

  it("the original sheets have the issues the regenerated sheets remove", () => {
    const onRegenerated = (families: string[]) =>
      result.findings.filter(
        (f) => families.includes(f.family) && f.sheets.some((s) => (REGENERATED_SHEETS as readonly string[]).includes(s)),
      );
    expect(onRegenerated(["JB"]).length).toBeGreaterThan(0);
    expect(onRegenerated(["CY"]).length).toBeGreaterThan(0);
  });

  it("swapping the regenerated sheets into the full set clears their JB, CY and CD-001 findings", () => {
    const swapped = original.map((p) => {
      const s = set.sheets.find((x) => x.original_page === p.page);
      return s ? { page: p.page, text: s.text } : p;
    });
    const check = runEngine(swapped, OPTIONS);
    const ids = REGENERATED_SHEETS as readonly string[];
    expect(check.findings.filter((f) => (f.family === "JB" || f.family === "CY") && f.sheets.some((s) => ids.includes(s)))).toEqual([]);
    expect(check.findings.filter((f) => f.rule_id === "CD-001")).toEqual([]);
  });

  it("cites only 2025 codes, and every sheet cites at least one", () => {
    for (const s of set.sheets) {
      const years = [...s.text.matchAll(CITATION)].map((m) => (m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])));
      expect(years.length, `${s.sheet} cites no code`).toBeGreaterThan(0);
      expect(new Set(years), `${s.sheet} cites another code cycle`).toEqual(new Set([2025]));
    }
  });

  it("prints the project address on every generated page", () => {
    for (const s of set.sheets) {
      expect(s.text).toContain("428 EL RIO RD,");
      expect(s.text).toContain("DANVILLE, CA 94526");
    }
  });

  it("names only Danville and its fire district", () => {
    const all = set.sheets.map((s) => s.text).join("\n");
    expect(all).toContain("TOWN OF DANVILLE");
    expect(all).toContain("SAN RAMON VALLEY FIRE PROTECTION DISTRICT");
    expect(all).not.toMatch(/TIBURON|BERKELEY|SONOMA|LAFAYETTE|WALNUT CREEK|CHAPTER R337|JADU/i);
  });

  it("writes a PDF that reads back as the same sheets with no JB, CY or TB issue", async () => {
    const bytes = regeneratedPdf(set);
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("%PDF-1.4");
    const pages = await extractPages(bytes);
    expect(pages).toHaveLength(4);
    for (const p of pages) expect(p.text).toContain("428 EL RIO RD,");
    const check = runEngine(pages, OPTIONS);
    expect(check.pages.map((p) => p.sheet)).toEqual([...REGENERATED_SHEETS]);
    expect(check.counts.JB).toBe(0);
    expect(check.counts.CY).toBe(0);
    expect(check.counts.TB).toBe(0);
  });
});
