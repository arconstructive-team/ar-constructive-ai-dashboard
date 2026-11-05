import { describe, expect, it } from "vitest";
import {
  buildContext,
  coverAreas,
  groupBySheet,
  parseSheetIndex,
  readTitleBlock,
  runEngine,
  toCsv,
  type PageText,
} from "../src/engine";
import {
  areaRules,
  codeYearRules,
  contradictionRules,
  crossReferenceRules,
  dateRules,
  jurisdictionRules,
  thirdPartyRules,
  titleBlockRules,
} from "../src/engine/rules";
import { archTitleBlock, structPage } from "./fixtures/el-rio/load";

const COVER_BODY = [
  "HIGH FIRE HAZARD ZONE : YES",
  "NUMBER OF STORIES: 2 STORY",
  "(N) GROSS FLOOR AREA:",
  "1ST FLOOR: 1,000 ± S.F.",
  "2ND FLOOR: 800 ± S.F.",
  "(GARAGE): 400 ± S.F.",
  "TOTAL FLOOR AREA (INC. GARAGE) 2,200 ± S.F.",
  "A-0.1",
  "A-1.1",
  "A-2.1",
  "A-2.2",
  "S-1.0",
].join("\n");

/** An architectural page with a clean title block (no leftover layers). */
const arch = (page: number, sheet: string, body: string): PageText => ({
  page,
  text: `${archTitleBlock(sheet, ["Plan"])}${body}\n`,
});

/** A small set: a cover, plan sheets with the given bodies, and one structural sheet. */
function set(
  bodies: Record<string, string>,
  extra: PageText[] = [],
  cover = COVER_BODY,
  structDate = "05.18.2026",
): PageText[] {
  const pages: PageText[] = [arch(1, "A-0.1", cover)];
  let n = 2;
  for (const sheet of ["A-1.1", "A-2.1", "A-2.2"]) {
    pages.push(arch(n++, sheet, bodies[sheet] ?? "PLAN"));
  }
  pages.push(structPage(n++, "S-1.0", ["Notes"], bodies["S-1.0"] ?? "NOTES", structDate));
  for (const p of extra) pages.push({ page: n++, text: p.text });
  return pages;
}
const ctx = (pages: PageText[], aduType?: string) =>
  buildContext(pages, { jurisdiction: "Town of Danville", aduType });

describe("classification", () => {
  it("reads the architectural, structural and Title 24 title blocks", () => {
    expect(readTitleBlock(`${archTitleBlock("A-2.5", ["Enlarged", "Bathrooms"])}BODY`)).toEqual({
      sheet: "A-2.5",
      title: "Enlarged Bathrooms",
      date: "2026-05-18",
      address: "428 EL RIO",
    });
    expect(readTitleBlock(structPage(1, "S-3.1", ["Framing Plan"], "").text)).toMatchObject({
      sheet: "S-3.1",
      date: "2026-08-14",
      address: "428 El Rio Road",
    });
    expect(readTitleBlock("T-1\nTITLE 24\n17 MAIN ST, OAKLAND, CA 94601\n")).toMatchObject({
      sheet: "T-1",
      address: "17 MAIN ST",
    });
    expect(readTitleBlock("TOPOGRAPHIC SURVEY\n")).toBeNull();
  });

  it("joins the sheet-index columns and ignores lone sheet numbers", () => {
    const text = "SHEET NO.\n\nA-0.1\n\n05/18/2026\nC-01\nEXP: 03/31/27\nA-0.1\nA-0.2\n\nA-1.1\nT-1\nT-1\nTITLES\nS-1.0\nS-1.1\nS-2.0\nS-2.1\nHFX1 (No Change)\n";
    expect(parseSheetIndex(text)).toEqual(["A-0.1", "A-0.2", "A-1.1", "T-1", "T-1", "S-1.0", "S-1.1", "S-2.0", "S-2.1", "HFX1"]);
  });

  it("gives pages without a title block the next free index entry", () => {
    const pages = set({}, [{ page: 0, text: "TOPOGRAPHIC SURVEY\n7/10/2026\n" }]);
    const cover = COVER_BODY.replace("S-1.0", "S-1.0\nA-9.9");
    const c = ctx(set({}, [{ page: 0, text: "TOPOGRAPHIC SURVEY\n7/10/2026\n" }], cover));
    expect(c.pages[5]).toMatchObject({ sheet: "A-9.9", kind: "survey", method: "index-order", date: "2026-07-10" });
    expect(ctx(pages).pages[5]).toMatchObject({ method: "unknown" });
  });
});

describe("JB: jurisdiction boilerplate", () => {
  it("flags another city's code and another fire agency", () => {
    const c = ctx(set({ "A-2.1": "OUTLETS [TMC 13-4.4.1(E)]\nINSPECTION BY SONOMA VALLEY FIRE RESCUE" }));
    const found = jurisdictionRules(c);
    expect(found.map((f) => [f.rule_id, f.subject, f.sheets[0]])).toEqual([
      ["JB-001", "Town of Tiburon", "A-2.1"],
      ["JB-002", "Sonoma Valley Fire", "A-2.1"],
    ]);
    expect(found[0].suggested_fix).toContain("Town of Danville");
  });

  it("accepts the project's own jurisdiction and fire agency", () => {
    const c = ctx(set({ "A-2.1": "TOWN OF DANVILLE\nSAN RAMON VALLEY FIRE PROTECTION DISTRICT" }));
    expect(jurisdictionRules(c)).toEqual([]);
  });
});

describe("CD: contradictions", () => {
  it("flags a fire-zone NO against wildland-urban interface notes", () => {
    const cover = COVER_BODY.replace("YES", "NO");
    const c = ctx(set({ "A-2.2": "PER CHAPTER R337 IN THE CRC." }, [], cover));
    expect(contradictionRules(c).map((f) => [f.rule_id, f.sheets])).toEqual([["CD-001", ["A-0.1", "A-2.2"]]]);
  });

  it("flags notes about more floors than the cover states", () => {
    const c = ctx(set({ "A-2.1": "Fire rate the elevator shaft on all three floors" }));
    const [f] = contradictionRules(c);
    expect(f).toMatchObject({ rule_id: "CD-002", sheets: ["A-2.1"] });
    expect(f.title).toContain("elevator");
  });

  it("flags two ADU types", () => {
    const c = ctx(set({}, [{ page: 0, text: "T-1\nTITLE 24\nJADU\n" }], `${COVER_BODY}\n1 + 1 ATTACHED ADU`), "Attached ADU");
    const [f] = contradictionRules(c);
    expect(f).toMatchObject({ rule_id: "CD-003", sheets: ["A-0.1", "T-1 (ADU)"] });
  });

  it("finds nothing in a consistent set", () => {
    expect(contradictionRules(ctx(set({})))).toEqual([]);
  });
});

describe("CY: code year", () => {
  it("flags citations from an older code cycle once per sheet", () => {
    const c = ctx(set({ "A-2.1": "2022 CALIFORNIA ENERGY CODE\n16 CFC 505.1\n2025 CBC 719" }));
    const found = codeYearRules(c);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule_id: "CY-001", sheets: ["A-2.1"] });
    expect(found[0].title).toContain("2022, 2016");
    expect(found[0].evidence).toContain('cites "2022 CALIFORNIA ENERGY CODE", "16 CFC"');
  });
});

describe("AR: areas", () => {
  it("reads the new area block of the cover and the existing garage", () => {
    const text = "(E) GROSS FLOOR AREA:\n1ST FLOOR : 900\n(GARAGE): 420\nTOTAL FLOOR AREA 1,320\n" +
      "(N) GROSS FLOOR AREA:\n1ST FLOOR: 1,708\n2ND FLOOR: 1,226\n(GARAGE): 525\nTOTAL FLOOR AREA (INC. GARAGE) 3,459\nADU (ATTACHED): 418";
    const a = coverAreas(text);
    expect([a.first?.value, a.second?.value, a.garage?.value, a.total?.value]).toEqual([1708, 1226, 525, 3459]);
    expect([a.existingGarage?.value, a.adu?.value]).toEqual([420, 418]);
  });

  it("flags a plan area close to, but not equal to, the cover area", () => {
    const c = ctx(set({ "A-2.1": "1016sq ft\nGr. Area:", "A-2.2": "800sq ft Gr. Area:" }));
    const found = areaRules(c);
    expect(found.map((f) => [f.rule_id, f.subject, f.sheets])).toEqual([["AR-001", "1st floor", ["A-0.1", "A-2.1"]]]);
  });

  it("flags a garage area that differs from the scope of work, and a wrong total", () => {
    const cover = COVER_BODY.replace("2,200", "2,300") +
      "\n(E) GROSS FLOOR AREA:\n(GARAGE): 420\nTOTAL FLOOR AREA 420\nCONVERT THE EXISTING 418 SQ.\nFT. ATTACHED GARAGE";
    const ids = areaRules(ctx(set({}, [], cover))).map((f) => f.rule_id);
    expect(ids).toEqual(["AR-002", "AR-003"]);
  });
});

describe("XR: cross-references", () => {
  it("flags index entries and cited sheets that are not in the set", () => {
    const cover = COVER_BODY.replace("A-2.2\n", "A-2.2\nA-1.2\n");
    const c = ctx(set({ "A-2.1": "(SEE SHEET AD-6.5)", "A-2.2": "SEE SHEETS A-2.1 & AD-6.5" }, [], cover));
    const out = crossReferenceRules(c);
    expect(out.findings.map((f) => [f.rule_id, f.subject, f.sheets])).toEqual([
      ["XR-001", "A-1.2", ["A-0.1"]],
      ["XR-002", "AD-6.5", ["A-2.1", "A-2.2"]],
    ]);
    expect(out.missing.map((m) => m.item)).toEqual(["A-1.2", "AD-6.5"]);
  });

  it("groups references to a render on a sheet that has none", () => {
    const c = ctx(set({ "A-2.1": "DOOR (SEE\nRENDER A-1.1)", "A-2.2": "DOOR (SEE RENDER A-1.1)" }, [], `${COVER_BODY}\nPROPOSED RENDER`));
    const xr = crossReferenceRules(c).findings.filter((f) => f.rule_id === "XR-003");
    expect(xr).toHaveLength(1);
    expect(xr[0].sheets).toEqual(["A-0.1", "A-1.1", "A-2.1", "A-2.2"]);
    expect(xr[0].evidence).toContain("it is on A-0.1");
  });

  it("flags a structural level the building does not have", () => {
    const c = ctx(set({ "S-1.0": "3RD Level Ceiling Plan\n2ND FLOOR" }));
    const xr = crossReferenceRules(c).findings.filter((f) => f.rule_id === "XR-004");
    expect(xr.map((f) => f.sheets)).toEqual([["S-1.0"]]);
  });
});

describe("TB: title blocks", () => {
  it("flags another project's address, owner and title block once", () => {
    const old = "4142 CANYON ROAD,\nLAFAYETTE CA, 94549\nERFANI MASOUDI LIVING TRUST\nSHEET NO.\n09/08/2025\n";
    const c = ctx(set({ "A-2.1": old, "A-2.2": old }));
    const found = titleBlockRules(c);
    expect(found).toHaveLength(1);
    expect(found[0].sheets).toEqual(["A-2.1", "A-2.2"]);
    expect(found[0].evidence).toContain('address "4142 CANYON ROAD, LAFAYETTE"');
    expect(found[0].evidence).toContain("second title block dated 09/08/2025");
  });

  it("ignores the project address and the consultants' addresses", () => {
    const c = ctx(set({ "A-2.1": "428 EL RIO RD, DANVILLE, CA\nS&P ENGINEERS\n1724 CARRIAGE DR. WALNUT CREEK, CA 94598\nPghaffari@sp-engs.com" }));
    expect(titleBlockRules(c)).toEqual([]);
  });
});

describe("DT: dates", () => {
  it("flags an architectural set dated before the survey and structural sheets", () => {
    const survey = [{ page: 0, text: "TOPOGRAPHIC SURVEY\n7/10/2026\n" }];
    const c = ctx(set({}, survey, COVER_BODY.replace("S-1.0", "S-1.0\nA-0.4"), "08.14.2026"));
    const found = dateRules(c);
    expect(found.map((f) => f.rule_id)).toEqual(["DT-001"]);
    expect(found[0].evidence).toContain("07/10/2026");
    expect(found[0].evidence).toContain("08/14/2026");
  });
});

describe("TP: third-party documents", () => {
  it("flags a Title 24 report for another address and a missing soils report", () => {
    const c = ctx(set({ "S-1.0": "FOLLOW RECOMMENDATIONS IN SOIL REPORT" }, [{ page: 0, text: "T-1\nTITLE 24\n17 MAIN ST, OAKLAND, CA 94601\n" }]));
    const out = thirdPartyRules(c);
    expect(out.findings.map((f) => [f.rule_id, f.sheets])).toEqual([
      ["TP-001", ["T-1"]],
      ["TP-004", ["S-1.0"]],
    ]);
    expect(out.missing).toEqual([{ item: "Soils report", reason: "Cited by the structural notes", cited_on: ["S-1.0"] }]);
  });
});

describe("results", () => {
  it("groups findings by their first sheet and writes CSV", () => {
    const result = runEngine(set({ "A-2.1": "[TMC 13-4]\n2019 CBC" }), { jurisdiction: "Town of Danville" });
    const groups = groupBySheet(result.findings);
    expect(groups.map((g) => g.sheet)).toEqual(["A-2.1"]);
    expect(groups[0].findings.map((f) => f.rule_id)).toEqual(["JB-001", "CY-001"]);
    const csv = toCsv(result.findings);
    expect(csv.split("\r\n")[0]).toBe("sheet,rule_id,family,severity,title,sheets,pages,evidence,suggested_fix");
    expect(csv.split("\r\n")).toHaveLength(4);
    expect(result.counts).toMatchObject({ JB: 1, CY: 1, AR: 0 });
  });
});
