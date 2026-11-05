import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODE_LIBRARY,
  RULE_CITATIONS,
  citationIds,
  getPack,
  getSection,
  groupLibrary,
  hasSection,
  jurisdictionIn,
  runCheck,
  toCsv,
  validateLibrary,
  type CodeLibraryData,
  type RegeneratedSet,
} from "../src/engine";
import { loadElRio } from "./fixtures/el-rio/load";

const DANVILLE = getPack("Town of Danville");
const BASE = getPack("City of Walnut Creek");
const elRio = loadElRio();
const OPTIONS = { jurisdiction: "Town of Danville", aduType: "Attached ADU", address: "428 El Rio Rd, Danville, CA 94526" };

// Every rule id the rules file creates a finding for.
const RULE_IDS = [
  ...new Set(
    [...readFileSync(new URL("../src/engine/rules.ts", import.meta.url), "utf8").matchAll(/rule_id:\s*"([A-Z]{2}-\d{3})"/g)].map(
      (m) => m[1],
    ),
  ),
];

describe("code library data", () => {
  it("has no data problems: unique ids, known packs, https sources, last-checked dates", () => {
    expect(validateLibrary()).toEqual([]);
    expect(CODE_LIBRARY.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(CODE_LIBRARY.packs.map((p) => p.id)).toEqual(["ca-2025", "danville-2025"]);
  });

  it("gives each section a code, part, number, title, summary, source, edition and date", () => {
    for (const s of CODE_LIBRARY.sections) {
      expect(s.code && s.part && s.section && s.title && s.summary, s.id).toBeTruthy();
      expect(s.source_url, s.id).toMatch(/^https:\/\//);
      expect(s.edition, s.id).toMatch(/^2025$|^Danville amendment/);
      expect(s.last_checked, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("stores no copyrighted code text: only Energy Code (Part 6) sections may carry text", () => {
    for (const s of CODE_LIBRARY.sections) if (s.text !== undefined) expect(s.code, s.id).toBe("Energy Code");
    const bad: CodeLibraryData = {
      ...CODE_LIBRARY,
      sections: [{ ...getSection("CRC-R314"), text: "Smoke alarms shall be installed in the following locations" }],
    };
    expect(validateLibrary(bad).join(" ")).toMatch(/only Energy Code text may be stored/);
  });

  it("stores the Danville sections with links to the official Danville Municipal Code", () => {
    const danville = CODE_LIBRARY.sections.filter((s) => s.pack === "danville-2025");
    expect(danville.map((s) => s.section)).toEqual(
      expect.arrayContaining(["10-1", "10-2", "10-6", "10-20", "32-76", "32-79"]),
    );
    for (const s of danville) expect(s.source_url).toMatch(/^https:\/\/codelibrary\.amlegal\.com\/codes\/danvilleca\//);
    expect(getSection("DMC-32-79").title).toBe("Tree Preservation");
  });

  it("throws for an id the library does not have", () => {
    expect(() => getSection("CRC-R999")).toThrow(/no section "CRC-R999"/);
  });

  it("groups the sections by jurisdiction, then code part", () => {
    const groups = groupLibrary();
    expect(groups.map((g) => g.jurisdiction)).toEqual(["State of California", "Town of Danville"]);
    expect(groups[0].parts.map((p) => p.part)).toContain("Title 24, Part 2.5");
    const total = groups.flatMap((g) => g.parts).reduce((n, p) => n + p.sections.length, 0);
    expect(total).toBe(CODE_LIBRARY.sections.length);
  });
});

describe("rule citations", () => {
  it("every rule cites at least one library entry, in Danville and in a base pack", () => {
    expect(RULE_IDS.length).toBeGreaterThan(10);
    for (const id of RULE_IDS) {
      expect(RULE_CITATIONS[id], `${id} has no citations`).toBeDefined();
      for (const pack of [DANVILLE, BASE]) {
        const ids = citationIds(id, pack);
        expect(ids.length, id).toBeGreaterThan(0);
        for (const cited of ids) expect(hasSection(cited), `${id} cites missing entry ${cited}`).toBe(true);
      }
    }
  });

  it("every pack's local entry exists in the library", () => {
    for (const id of Object.values(DANVILLE.local)) expect(hasSection(id!), id).toBe(true);
  });

  it("each El Rio finding carries its cited sections with official links", () => {
    const result = runCheck(elRio, OPTIONS);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.citations?.length, f.rule_id).toBeGreaterThan(0);
      for (const c of f.citations!) {
        expect(hasSection(c.id), `${f.rule_id} cites missing entry ${c.id}`).toBe(true);
        expect(c.source_url).toMatch(/^https:\/\//);
      }
    }
    const jb = result.findings.find((f) => f.rule_id === "JB-001");
    expect(jb?.citations?.map((c) => c.id)).toEqual(expect.arrayContaining(["CRC-R106.1.1", "DMC"]));
    expect(toCsv(result.findings)).toContain("CRC Section R106.1.1 <https://codes.iccsafe.org/content/CARC2025P2>");
  });

  it("a base pack cites only state sections", () => {
    const result = runCheck(elRio, { ...OPTIONS, jurisdiction: "City of Walnut Creek" });
    for (const f of result.findings) for (const c of f.citations ?? []) expect(c.id.startsWith("DMC"), c.id).toBe(false);
  });
});

describe("regenerated sheet citations", () => {
  const set = runCheck(elRio, OPTIONS).regenerated as RegeneratedSet;

  it("every regenerated sheet lists the library entries it cites", () => {
    for (const s of set.sheets) {
      expect(s.citations?.length, s.sheet).toBeGreaterThan(0);
      for (const c of s.citations!) expect(hasSection(c.id), `${s.sheet} cites missing ${c.id}`).toBe(true);
    }
    const cover = set.sheets.find((s) => s.sheet === "A-0.1")!;
    expect(cover.citations!.map((c) => c.id)).toEqual(expect.arrayContaining(["T24-P2", "T24-P6", "DMC"]));
  });

  it("every section or chapter number printed on a sheet is a cited library entry", () => {
    for (const s of set.sheets) {
      const cited = new Set(s.citations!.map((c) => getSection(c.id).section.toUpperCase()));
      const text = s.sections.flatMap((x) => x.lines).join("\n");
      const printed = [...text.matchAll(/\b(SECTION|CHAPTER)\s+([A-Z]?\d+(?:[.-]\d+)*)/g)].map((m) =>
        m[1] === "CHAPTER" ? `CHAPTER ${m[2]}` : m[2],
      );
      for (const p of printed) expect(cited.has(p), `${s.sheet} prints ${p} without a library entry`).toBe(true);
    }
  });
});

describe("jurisdiction detection", () => {
  it("detects Danville in the El Rio set and warns when it was checked as Walnut Creek", () => {
    const result = runCheck(elRio, { ...OPTIONS, jurisdiction: "City of Walnut Creek" });
    expect(result.jurisdiction).toMatchObject({
      selected: "City of Walnut Creek",
      detected: "Town of Danville",
      matches: false,
      sheet: "A-0.1",
    });
    expect(result.jurisdiction?.evidence).toMatch(/DANVILLE/);
  });

  it("finds no mismatch when the El Rio set is checked as Danville", () => {
    const result = runCheck(elRio, OPTIONS);
    expect(result.jurisdiction).toMatchObject({ selected: "Town of Danville", detected: "Town of Danville", matches: true });
  });

  it("reads the regenerated cover's JURISDICTION line", () => {
    const set = runCheck(elRio, OPTIONS).regenerated as RegeneratedSet;
    const pages = set.sheets.map((s, i) => ({ page: i + 1, text: s.text }));
    const result = runCheck(pages, { ...OPTIONS, jurisdiction: "City of Orinda" });
    expect(result.jurisdiction?.detected).toBe("Town of Danville");
    expect(result.jurisdiction?.matches).toBe(false);
  });

  it("does not take the fire district name for the City of San Ramon", () => {
    expect(jurisdictionIn("SAN RAMON VALLEY FIRE PROTECTION DISTRICT")).toBeNull();
    expect(jurisdictionIn("2222 CAMINO RAMON, SAN RAMON, CA")).toBe("City of San Ramon");
    expect(jurisdictionIn("ALAMO, CA 94507")).toBe("Unincorporated Contra Costa County");
  });
});
