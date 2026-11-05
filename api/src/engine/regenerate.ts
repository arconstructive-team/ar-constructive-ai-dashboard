// Regenerates the cover data (A-0.1) and the general, E-M-P and fire notes (A-0.2, A-5.2,
// A-5.3) from the project data and the jurisdiction pack. Only the current code cycle is
// cited, only the project's jurisdiction and fire agency are named, and the title block
// carries the project's own address. Data the cover does not state prints as
// "TO BE CONFIRMED" and is listed for the architect.
import type {
  ClassifiedPage,
  EngineOptions,
  JurisdictionPack,
  PageText,
  RegeneratedSet,
  RegeneratedSheet,
  SheetSection,
} from "./types";
import { classifyPages } from "./classify";
import { getPack } from "./packs";
import { coverAreas } from "./rules";
import { cite, getSection } from "./library";
import { collapse, findFirst, formatNumber } from "./text";
import { layoutSheet, layoutText, toBase64, writePdf } from "./pdf";

export const REGENERATED_SHEETS = ["A-0.1", "A-0.2", "A-5.2", "A-5.3"] as const;
const TBC = "TO BE CONFIRMED";

const DEFAULT_TITLES: Record<string, string> = {
  "A-0.1": "COVER SHEET",
  "A-0.2": "GENERAL NOTES",
  "A-5.2": "GENERAL NOTES",
  "A-5.3": "FIRE NOTES",
};

export interface ProjectFacts {
  address: string | null;
  owner: string | null;
  apn: string | null;
  zoning: string | null;
  occupancy: string | null;
  construction: string | null;
  stories: string | null;
  sprinklers: string | null;
  fireZone: "YES" | "NO" | null;
  lotSize: string | null;
  units: string | null;
  height: string | null;
  scope: string | null;
  existing: string[];
  proposed: string[];
  adu: string | null;
}

const value = (text: string, re: RegExp): string | null => {
  const m = findFirst(text, re);
  const v = m ? collapse(m.groups[0]).replace(/[\s,]+$/, "") : "";
  return v ? v.toUpperCase() : null;
};

// One area block of the cover ("(E) GROSS FLOOR AREA: ... TOTAL ..."), as print lines.
function areaBlock(text: string, which: "E" | "N"): string[] {
  const m = new RegExp(String.raw`\(${which}\)\s*GROSS\s+FLOOR\s+AREA\s*:?([\s\S]*?TOTAL\s+FLOOR\s+AREA[^\n]*)`, "i").exec(text);
  if (!m) return [];
  const block = m[1];
  const out: string[] = [];
  const pick = (label: string, re: RegExp) => {
    const hit = re.exec(block);
    if (hit) out.push(`${label} ${hit[1]} ± S.F.`);
  };
  pick("1ST FLOOR:", /\b1ST\s+FLOOR\s*:\s*([\d,]+)/i);
  pick("2ND FLOOR:", /\b2ND\s+FLOOR\s*:\s*([\d,]+)/i);
  pick("(GARAGE):", /\(GARAGE\)\s*:\s*([\d,]+)/i);
  pick("TOTAL FLOOR AREA (INC. GARAGE)", /TOTAL\s+FLOOR\s+AREA[^\d\n]*([\d,]+)/i);
  return out;
}

function readScope(text: string): string | null {
  const m = /SCOPE\s+OF\s+WORK\s*:?[ \t]*\n?([\s\S]*)/i.exec(text);
  if (!m) return null;
  const lines: string[] = [];
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/:\s*$/.test(line) || /^[A-Z][A-Z .'&/()-]+:/.test(line) || lines.length >= 8) break;
    lines.push(line);
  }
  const scope = collapse(lines.join(" "))
    .replace(/\(\s*SEE[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return scope ? scope.toUpperCase() : null;
}

/** Reads the project data the cover sheet states. */
export function readProjectFacts(cover: string): ProjectFacts {
  const adu = coverAreas(cover).adu;
  const zone = value(cover, /FIRE\s+HAZARD(?:\s+SEVERITY)?\s+ZONE\s*:?\s*(YES|NO|NONE|N\/A)\b/i);
  return {
    address: value(cover, /PROJECT\s+(?:DATA|ADDRESS)\s*:?[ \t]*\n?\s*(\d{1,6}\s[^\n]+)/i),
    owner: value(cover, /OWNER'?S?(?:\s+NAME)?\s*:[ \t]*(?:\n[^\n]*:[ \t]*)*\n?\s*([^\n:]+)\n/i),
    apn: value(cover, /(?:ASSESSOR'?S?\s+PARCEL\s+(?:NUMBER|NO\.?)|\bAPN)\s*:?\s*([\d-]{6,})/i),
    zoning: value(cover, /\bZONING\s*:\s*([A-Z0-9-]+)/i),
    occupancy: value(cover, /\bOCCUPANCY(?:\s+GROUP)?[^:\n]*:\s*([^\n]+)/i),
    construction: value(cover, /CONSTRUCTION\s+TYPE\s*:\s*([^\n]+)/i),
    stories: value(cover, /NUMBER\s+OF\s+STORIES\s*:\s*(\d+)/i),
    sprinklers: value(cover, /FIRE\s+SPRINKLER[^:\n]*:\s*([^\n]+)/i),
    fireZone: zone ? (zone === "YES" ? "YES" : "NO") : null,
    lotSize: value(cover, /LOT\s+SIZE[^:\n]*:\s*([\d,]+)/i),
    units: value(cover, /\(N\)\s*#\s*OF\s+UNITS\s*:\s*([^\n]+)/i),
    height: value(cover, /(?<!REQ\.\s)BUILDING\s+HEIGHT\s*:\s*([^\n]+)/i),
    scope: readScope(cover),
    existing: areaBlock(cover, "E"),
    proposed: areaBlock(cover, "N"),
    adu: adu ? formatNumber(adu.value) : null,
  };
}

function isoToSlash(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/** Splits an address after the street: "428 EL RIO RD," and "DANVILLE, CA 94526". */
function addressLines(address: string): string[] {
  const clean = collapse(address).toUpperCase();
  const comma = clean.indexOf(",");
  if (comma === -1) return [clean];
  return [`${clean.slice(0, comma + 1)}`, clean.slice(comma + 1).trim()];
}

function titleLines(title: string): string[] {
  const words = title.toUpperCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length && (out[out.length - 1] + " " + w).length <= 22) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  return out.slice(0, 4);
}

function agencyShort(pack: JurisdictionPack): string {
  return /\(([A-Z]+)\)/.exec(pack.fireAgency)?.[1] ?? pack.fireAgency.toUpperCase();
}

/**
 * Records that a sheet cites a code library entry and returns the text that cites it.
 * Every code reference on a regenerated sheet goes through this, so each one has a library id.
 */
type Cite = (id: string, text: string) => string;

function citer(): { c: Cite; ids: string[] } {
  const ids: string[] = [];
  const c: Cite = (id, text) => {
    getSection(id); // throws when the library has no such entry
    if (!ids.includes(id)) ids.push(id);
    return text;
  };
  return { c, ids };
}

function localCode(pack: JurisdictionPack, c: Cite): string {
  const id = pack.local.code;
  return id ? c(id, getSection(id).label.toUpperCase()) : `${pack.jurisdiction} municipal code`.toUpperCase();
}

// ---------------------------------------------------------------- sheet content

function coverSections(f: ProjectFacts, pack: JurisdictionPack, address: string, aduType: string, c: Cite): SheetSection[] {
  const y = pack.codeCycle;
  const town = pack.jurisdiction.toUpperCase();
  const or = (v: string | null) => v ?? TBC;
  const area: string[] = [];
  if (f.existing.length) area.push("(E) GROSS FLOOR AREA:", ...f.existing);
  if (f.proposed.length) area.push("(N) GROSS FLOOR AREA:", ...f.proposed);
  const kind = /^(ATTACHED|DETACHED) ADU$/.exec(aduType)?.[1];
  if (f.adu) area.push(`${kind ? `ADU (${kind})` : aduType}: ${f.adu} ± S.F.`);
  if (!area.length) area.push(`GROSS FLOOR AREAS: ${TBC}`);
  return [
    {
      heading: "PROJECT DATA",
      lines: [
        `PROJECT ADDRESS: ${address}`,
        `OWNER: ${or(f.owner)}`,
        `ASSESSOR PARCEL NUMBER: ${or(f.apn)}`,
        `JURISDICTION: ${town}`,
        `FIRE DISTRICT: ${pack.fireAgency.toUpperCase()}`,
        `ZONING: ${or(f.zoning)}`,
        `FIRE HAZARD SEVERITY ZONE: ${or(f.fireZone)}`,
      ],
    },
    {
      heading: "BUILDING DATA",
      lines: [
        `OCCUPANCY: ${or(f.occupancy)}`,
        `CONSTRUCTION TYPE: ${or(f.construction)}`,
        `NUMBER OF STORIES: ${f.stories ? `${f.stories} (NO CHANGE)` : TBC}`,
        `BUILDING HEIGHT: ${or(f.height)}`,
        `FIRE SPRINKLERS: ${or(f.sprinklers)}`,
        `(E) LOT SIZE: ${f.lotSize ? `${f.lotSize} ± S.F.` : TBC}`,
        `(N) # OF UNITS: ${or(f.units)}`,
        `ADU TYPE: ${aduType}`,
      ],
    },
    { heading: "AREA SUMMARY", lines: area },
    {
      heading: "APPLICABLE CODES",
      lines: [
        `ALL WORK SHALL COMPLY WITH THE FOLLOWING CODES, AS ADOPTED AND AMENDED BY THE ${town}:`,
        c("T24-P2", `${y} CALIFORNIA BUILDING CODE (CBC), TITLE 24 PART 2`),
        c("T24-P2.5", `${y} CALIFORNIA RESIDENTIAL CODE (CRC), TITLE 24 PART 2.5`),
        c("T24-P3", `${y} CALIFORNIA ELECTRICAL CODE (CEC), TITLE 24 PART 3`),
        c("T24-P4", `${y} CALIFORNIA MECHANICAL CODE (CMC), TITLE 24 PART 4`),
        c("T24-P5", `${y} CALIFORNIA PLUMBING CODE (CPC), TITLE 24 PART 5`),
        c("T24-P6", `${y} CALIFORNIA ENERGY CODE, TITLE 24 PART 6`),
        c("T24-P7", `${y} CALIFORNIA WILDLAND-URBAN INTERFACE CODE (CWUIC), TITLE 24 PART 7`),
        c("T24-P9", `${y} CALIFORNIA FIRE CODE (CFC), TITLE 24 PART 9, AS AMENDED BY ${agencyShort(pack)}`),
        c("T24-P10", `${y} CALIFORNIA EXISTING BUILDING CODE (CEBC), TITLE 24 PART 10`),
        c("T24-P11", `${y} CALIFORNIA GREEN BUILDING STANDARDS CODE (CALGREEN), TITLE 24 PART 11`),
        localCode(pack, c),
      ],
    },
    { heading: "SCOPE OF WORK", lines: [f.scope ?? TBC] },
  ];
}

function generalSections(pack: JurisdictionPack, c: Cite): SheetSection[] {
  const y = pack.codeCycle;
  const town = pack.jurisdiction.toUpperCase();
  const fire = agencyShort(pack);
  return [
    {
      heading: "ABBREVIATIONS",
      lines: [
        "(E) - EXISTING",
        "(N) - NEW",
        "ADU - ACCESSORY DWELLING UNIT",
        "A.F.F. - ABOVE FINISHED FLOOR",
        "CBC - CALIFORNIA BUILDING CODE",
        "CRC - CALIFORNIA RESIDENTIAL CODE",
        "CEC - CALIFORNIA ELECTRICAL CODE",
        "CMC - CALIFORNIA MECHANICAL CODE",
        "CPC - CALIFORNIA PLUMBING CODE",
        "CFC - CALIFORNIA FIRE CODE",
        "CALGREEN - CALIFORNIA GREEN BUILDING STANDARDS CODE",
        `${fire} - ${pack.fireAgency.replace(/\s*\([A-Z]+\)$/, "").toUpperCase()}`,
        "CLR. - CLEAR",
        "GYP. BD. - GYPSUM BOARD",
        "MAX. - MAXIMUM",
        "MIN. - MINIMUM",
        "O.C. - ON CENTER",
        "SIM. - SIMILAR",
        "SQ. FT. - SQUARE FEET",
        "TYP. - TYPICAL",
        "U.O.N. - UNLESS OTHERWISE NOTED",
      ],
    },
    {
      heading: "GENERAL NOTES",
      lines: [
        `1. ALL WORK SHALL CONFORM TO THE ${c("T24-2025", `${y} CALIFORNIA BUILDING STANDARDS CODE (TITLE 24)`)} AS ADOPTED AND AMENDED BY THE ${town}, AND TO THE ${localCode(pack, c)}.`,
        "2. THE CONTRACTOR SHALL VERIFY ALL DIMENSIONS AND EXISTING CONDITIONS ON SITE BEFORE STARTING WORK, AND SHALL REPORT ANY DIFFERENCE TO THE ARCHITECT.",
        "3. DO NOT SCALE THE DRAWINGS. WRITTEN DIMENSIONS GOVERN.",
        "4. KEEP THE APPROVED PLANS AND THE PERMIT CARD ON SITE AND AVAILABLE TO THE INSPECTOR.",
        `5. ANY CHANGE TO THE APPROVED PLANS NEEDS THE APPROVAL OF THE ${town} BUILDING DIVISION BEFORE THE WORK IS DONE.`,
        `6. CONSTRUCTION HOURS, NOISE AND DUST CONTROL SHALL FOLLOW THE ${localCode(pack, c)} AND THE CONDITIONS OF APPROVAL.`,
        `7. SPECIAL INSPECTIONS, WHERE THE STRUCTURAL DRAWINGS CALL FOR THEM, SHALL FOLLOW ${c("CBC-CH17", `${y} CBC CHAPTER 17`)}.`,
        `8. FIRE AND LIFE SAFETY WORK SHALL MEET THE ${c("T24-P9", `${y} CALIFORNIA FIRE CODE`)} AS AMENDED BY THE ${pack.fireAgency.toUpperCase()}.`,
        `9. NEW CONSTRUCTION SHALL MEET THE MANDATORY MEASURES OF THE ${c("T24-P11", `${y} CALIFORNIA GREEN BUILDING STANDARDS CODE (CALGREEN)`)} AND THE ${c("T24-P6", `${y} CALIFORNIA ENERGY CODE`)}.`,
        "10. PROTECT THE EXISTING BUILDING, TREES AND UTILITIES THAT STAY. REPAIR ANY DAMAGE THE WORK CAUSES.",
        "11. PROVIDE EROSION AND SEDIMENT CONTROL AND KEEP CONSTRUCTION DEBRIS OUT OF THE STORM DRAIN SYSTEM.",
      ],
    },
  ];
}

function empSections(pack: JurisdictionPack, c: Cite): SheetSection[] {
  const y = pack.codeCycle;
  const energy = () => c("ENERGY-150.0(o)", `${y} CALIFORNIA ENERGY CODE`);
  return [
    {
      heading: "GENERAL NOTE (1) - ELECTRICAL",
      lines: [
        `1. ALL ELECTRICAL WORK SHALL COMPLY WITH THE ${c("T24-P3", `${y} CALIFORNIA ELECTRICAL CODE (CEC)`)}.`,
        `2. PROVIDE TAMPER-RESISTANT RECEPTACLES IN ALL DWELLING AREAS, PER ${c("CEC-406.12", "CEC SECTION 406.12")}.`,
        `3. PROVIDE GFCI PROTECTION PER ${c("CEC-210.8", "CEC SECTION 210.8")} AND AFCI PROTECTION PER ${c("CEC-210.12", "CEC SECTION 210.12")}.`,
        `4. LIGHTING SHALL BE HIGH EFFICACY WITH CONTROLS AS REQUIRED BY THE ${c("ENERGY-150.0(k)", `${y} CALIFORNIA ENERGY CODE`)}.`,
        "5. THE ADU SHALL HAVE ITS OWN LABELED PANEL OR CIRCUITS, AS SHOWN ON THE ELECTRICAL PLAN.",
      ],
    },
    {
      heading: "GENERAL NOTE (1) - MECHANICAL",
      lines: [
        `1. ALL MECHANICAL WORK SHALL COMPLY WITH THE ${c("T24-P4", `${y} CALIFORNIA MECHANICAL CODE (CMC)`)} AND THE ${c("T24-P6", `${y} CALIFORNIA ENERGY CODE`)}.`,
        `2. BATHROOM EXHAUST FANS SHALL BE ENERGY STAR, DUCTED TO THE OUTSIDE AND CONTROLLED BY A HUMIDITY CONTROL, PER ${c("CALGREEN-4.506.1", "CALGREEN SECTION 4.506.1")}.`,
        `3. PROVIDE WHOLE-DWELLING MECHANICAL VENTILATION AND A KITCHEN RANGE HOOD AS REQUIRED BY THE ${energy()}.`,
        `4. CLOTHES DRYER EXHAUST SHALL BE DUCTED TO THE OUTSIDE WITH A BACKDRAFT DAMPER, PER ${c("CMC-504.4", "CMC SECTION 504.4")}.`,
        `5. SEAL DUCT AND EQUIPMENT OPENINGS DURING CONSTRUCTION, PER ${c("CALGREEN-4.504.1", "CALGREEN SECTION 4.504.1")}.`,
      ],
    },
    {
      heading: "GENERAL NOTE (1) - PLUMBING AND WATER CONSERVATION",
      lines: [
        `1. ALL PLUMBING WORK SHALL COMPLY WITH THE ${c("T24-P5", `${y} CALIFORNIA PLUMBING CODE (CPC)`)}.`,
        `2. NEW PLUMBING FIXTURES SHALL NOT EXCEED THE FLOW RATES OF ${c("CALGREEN-4.303.1", "CALGREEN SECTION 4.303.1")}: WATER CLOSETS 1.28 GALLONS PER FLUSH, LAVATORY FAUCETS 1.2 GPM, KITCHEN FAUCETS 1.8 GPM, SHOWERHEADS 1.8 GPM.`,
        `3. SHOWER AND TUB-SHOWER VALVES SHALL BE PRESSURE BALANCE OR THERMOSTATIC MIXING TYPE, PER ${c("CPC-408.3", "CPC SECTION 408.3")}.`,
        `4. STRAP THE WATER HEATER FOR SEISMIC FORCES IN THE UPPER AND LOWER THIRD OF ITS HEIGHT, PER ${c("CPC-507.2", "CPC SECTION 507.2")}.`,
      ],
    },
    {
      heading: "GENERAL NOTE (1) - CALGREEN",
      lines: [
        `1. RECYCLE OR SALVAGE AT LEAST 65 PERCENT OF THE NONHAZARDOUS CONSTRUCTION AND DEMOLITION WASTE, PER ${c("CALGREEN-4.408.1", "CALGREEN SECTION 4.408.1")}.`,
        `2. ADHESIVES, SEALANTS, PAINTS AND COATINGS SHALL MEET THE VOC LIMITS OF ${c("CALGREEN-4.504.2", "CALGREEN SECTION 4.504.2")}.`,
        `3. CHECK THE MOISTURE CONTENT OF FRAMING BEFORE ENCLOSURE, PER ${c("CALGREEN-4.505.3", "CALGREEN SECTION 4.505.3")}.`,
        `4. GIVE THE OWNER AN OPERATION AND MAINTENANCE MANUAL AT FINAL INSPECTION, PER ${c("CALGREEN-4.410.1", "CALGREEN SECTION 4.410.1")}.`,
      ],
    },
  ];
}

function fireSections(f: ProjectFacts, pack: JurisdictionPack, c: Cite): SheetSection[] {
  const y = pack.codeCycle;
  const agency = pack.fireAgency.toUpperCase();
  const short = agencyShort(pack);
  const wui = (text: string) => c("T24-P7", text);
  const zone =
    f.fireZone === "YES"
      ? `THE PROJECT DATA STATES THAT THE SITE IS IN A FIRE HAZARD SEVERITY ZONE. EXTERIOR WALLS, ROOF, VENTS, WINDOWS AND DECKS SHALL COMPLY WITH THE ${wui(`${y} CALIFORNIA WILDLAND-URBAN INTERFACE CODE (CWUIC)`)}.`
      : f.fireZone === "NO"
        ? `THE PROJECT DATA STATES THAT THE SITE IS NOT IN A FIRE HAZARD SEVERITY ZONE, SO NO WILDFIRE CONSTRUCTION MEASURES ARE SHOWN. IF ${short} OR THE STATE MAPS THE PARCEL IN A ZONE, ADD THE ${wui(`${y} CWUIC`)} MEASURES BEFORE THE PERMIT IS ISSUED.`
        : `CONFIRM THE FIRE HAZARD SEVERITY ZONE OF THE PARCEL. IF THE PARCEL IS IN A ZONE, ADD THE ${wui(`${y} CWUIC`)} MEASURES BEFORE THE PERMIT IS ISSUED.`;
  return [
    {
      heading: "GENERAL NOTE (2) - FIRE",
      lines: [
        `1. ALL WORK SHALL COMPLY WITH THE ${c("T24-P9", `${y} CALIFORNIA FIRE CODE (CFC)`)} AS AMENDED BY THE ${agency}, AND WITH ${short} STANDARDS.`,
        `2. FIRE HAZARD SEVERITY ZONE: ${zone}`,
        `3. FIRE SPRINKLERS: ${f.sprinklers && !/NONE|NO\b/.test(f.sprinklers) ? `${f.sprinklers}. ` : ""}AN ADU DOES NOT NEED FIRE SPRINKLERS WHEN THEY ARE NOT REQUIRED FOR THE PRIMARY RESIDENCE (${c("GOV-66314", "CALIFORNIA GOVERNMENT CODE SECTION 66314")}). CONFIRM WITH ${short}.`,
      ],
    },
    {
      heading: "SMOKE AND CARBON MONOXIDE ALARMS",
      lines: [
        `1. PROVIDE SMOKE ALARMS IN EACH SLEEPING ROOM, OUTSIDE EACH SLEEPING AREA AND ON EACH STORY OF THE DWELLING UNITS, PER ${c("CRC-R314", `${y} CRC SECTION R314`)}. ALARMS SHALL BE HARDWIRED WITH BATTERY BACKUP AND INTERCONNECTED.`,
        `2. PROVIDE CARBON MONOXIDE ALARMS OUTSIDE EACH SLEEPING AREA AND ON EACH STORY, PER ${c("CRC-R315", `${y} CRC SECTION R315`)}.`,
      ],
    },
    {
      heading: "ADDRESS AND ACCESS",
      lines: [
        `1. POST ADDRESS NUMBERS FOR THE MAIN HOUSE AND THE ADU, CLEARLY VISIBLE FROM THE STREET AND CONTRASTING WITH THEIR BACKGROUND, PER ${c("CFC-505.1", `${y} CFC SECTION 505.1`)} AND ${short} STANDARDS.`,
        `2. FIRE ACCESS AND WATER SUPPLY SHALL MEET ${c("CFC-CH5", `${y} CFC CHAPTER 5`)} AS AMENDED BY ${short}.`,
      ],
    },
    {
      heading: "FIRE SAFETY DURING CONSTRUCTION",
      lines: [
        `1. FIRE SAFETY DURING CONSTRUCTION SHALL COMPLY WITH ${c("CFC-CH33", `${y} CFC CHAPTER 33`)}.`,
        "2. KEEP A PORTABLE FIRE EXTINGUISHER ON SITE DURING CONSTRUCTION.",
        "3. KEEP COMBUSTIBLE DEBRIS AWAY FROM THE BUILDING AND REMOVE IT FROM THE SITE OFTEN.",
      ],
    },
  ];
}

// ---------------------------------------------------------------- assembly

/**
 * Writes A-0.1, A-0.2, A-5.2 and A-5.3 again for the project. Returns null when the set has
 * no architectural cover to read the project data from.
 */
export function regenerateSheets(input: PageText[], options: EngineOptions = {}): RegeneratedSet | null {
  const { pages } = classifyPages(input);
  const arch = pages.filter((p) => p.kind === "architectural");
  const cover = pages.find((p) => p.sheet === "A-0.1") ?? arch[0];
  if (!cover) return null;
  const pack = getPack(options.jurisdiction);
  const facts = readProjectFacts(cover.text);
  const address = collapse(options.address?.trim() || facts.address || TBC).toUpperCase();
  const aduType = (options.aduType ?? "ADU").toUpperCase();
  const setDate = mostCommon(arch.map((p) => p.date ?? "").filter(Boolean));
  const jobOf = (p: ClassifiedPage | undefined) => (p ? (/^\s*(\d{2}-\d{3,5})\s*$/m.exec(p.text)?.[1] ?? null) : null);
  const setJob = jobOf(cover) ?? arch.map(jobOf).find((j) => j !== null) ?? null;

  const to_confirm: string[] = [];
  const missing: Array<[string, unknown]> = [
    ["owner", facts.owner],
    ["assessor parcel number", facts.apn],
    ["zoning", facts.zoning],
    ["occupancy", facts.occupancy],
    ["construction type", facts.construction],
    ["number of stories", facts.stories],
    ["building height", facts.height],
    ["fire sprinklers", facts.sprinklers],
    ["fire hazard severity zone", facts.fireZone],
    ["scope of work", facts.scope],
  ];
  for (const [label, v] of missing) if (!v) to_confirm.push(`The cover does not state the ${label}. Fill it in on A-0.1.`);
  if (!options.address && !facts.address) to_confirm.push("Enter the project address.");
  to_confirm.push("The areas are copied from the original cover. Fix any area finding on the plans and the cover together.");
  to_confirm.push(
    "Check the cited code sections against the adopted local amendments before the sheets are issued. Each sheet lists its sections, with links to the official source.",
  );

  const build: Record<string, (c: Cite) => SheetSection[]> = {
    "A-0.1": (c) => coverSections(facts, pack, address, aduType, c),
    "A-0.2": (c) => generalSections(pack, c),
    "A-5.2": (c) => empSections(pack, c),
    "A-5.3": (c) => fireSections(facts, pack, c),
  };

  const sheets: RegeneratedSheet[] = REGENERATED_SHEETS.map((id) => {
    const original = pages.find((p) => p.sheet === id);
    const title = (original?.title || DEFAULT_TITLES[id]).toUpperCase();
    const date = isoToSlash(original?.date ?? null) ?? isoToSlash(setDate) ?? isoToSlash(new Date().toISOString().slice(0, 10))!;
    const job = jobOf(original) ?? setJob;
    const addr = addressLines(address);
    const title_block = [
      "PROJECT NAME",
      "SHEET TITLE",
      "DATE",
      "JOB NO.",
      "SHEET NO.",
      "",
      id,
      "",
      date,
      ...(job ? [job] : []),
      ...titleLines(title),
      ...addr,
      "",
      "REGENERATED SHEET",
      `${pack.codeCycle} CODE CYCLE`,
      pack.jurisdiction.toUpperCase(),
    ];
    const { c, ids } = citer();
    const sections = build[id](c);
    const text = layoutText(layoutSheet({ titleBlock: title_block, sections }));
    const citations = ids.map(cite);
    return { sheet: id, title, original_page: original?.page ?? null, date, job, address: addr, title_block, sections, text, citations };
  });

  return { pack: pack.id, pack_name: pack.name, code_cycle: pack.codeCycle, address, sheets, to_confirm, findings: [] };
}

/** The regenerated sheets as one PDF file, one 11 x 17 page per sheet. */
export function regeneratedPdf(set: RegeneratedSet): Uint8Array {
  return writePdf(
    set.sheets.map((s) => layoutSheet({ titleBlock: s.title_block, sections: s.sections })),
    `Regenerated sheets - ${set.address}`,
  );
}

/** A data: link to the regenerated PDF, for a download in the browser. */
export function regeneratedPdfDataUrl(set: RegeneratedSet): string {
  return `data:application/pdf;base64,${toBase64(regeneratedPdf(set))}`;
}
