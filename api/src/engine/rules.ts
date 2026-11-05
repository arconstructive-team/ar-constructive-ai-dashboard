// The eight rule families. Every rule is deterministic: plain pattern matching on page text.
import type { ClassifiedPage, Finding, MissingItem, RuleContext } from "./types";
import { KNOWN_FIRE_AGENCIES, KNOWN_JURISDICTIONS } from "./packs";
import {
  DESIGN_KINDS,
  collapse,
  findAll,
  findFirst,
  firstOf,
  formatDate,
  formatNumber,
  listSheets,
  makeFinding,
  snippet,
  toNumber,
  unique,
} from "./text";

export interface RuleOutput {
  findings: Finding[];
  missing: MissingItem[];
}

const designPages = (ctx: RuleContext) => ctx.pages.filter((p) => DESIGN_KINDS.has(p.kind));

// ---------------------------------------------------------------- JB: jurisdiction boilerplate

export function jurisdictionRules(ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  const allowed = new Set(ctx.pack.allowedJurisdictions);
  const allowedFire = new Set(ctx.pack.allowedAgencies);
  for (const page of ctx.pages) {
    for (const j of KNOWN_JURISDICTIONS) {
      if (allowed.has(j.name)) continue;
      const m = firstOf(page.text, j.patterns);
      if (!m) continue;
      out.push(
        makeFinding({
          rule_id: "JB-001",
          severity: "high",
          title: `Code or ordinance from ${j.name}`,
          subject: j.name,
          pages: [page],
          evidence: `${page.label} cites "${collapse(m.text)}" (${j.name}): ${snippet(page.text, m.index, m.text.length)}`,
          suggested_fix: `Replace the ${j.name} reference with the matching ${ctx.pack.jurisdiction} requirement, or delete the note.`,
        }),
      );
    }
    for (const agency of KNOWN_FIRE_AGENCIES) {
      if (allowedFire.has(agency.name)) continue;
      const m = findFirst(page.text, agency.pattern);
      if (!m) continue;
      out.push(
        makeFinding({
          rule_id: "JB-002",
          severity: "high",
          title: `Fire agency from another jurisdiction: ${agency.name}`,
          subject: agency.name,
          pages: [page],
          evidence: `${page.label} names "${collapse(m.text)}": ${snippet(page.text, m.index, m.text.length)}`,
          suggested_fix: `Name ${ctx.pack.fireAgency} as the fire authority, with its inspection contact.`,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------- CD: contradictions

const FIRE_ZONE_NO = /FIRE\s+HAZARD(?:\s+SEVERITY)?\s+ZONE\s*:?\s*(?:NO|NONE|N\/A)\b/i;
const WUI_YES = [/IN\s+A\s+WILDLAND[- ]URBAN\s+INTERFACE\s+FIRE\s+AREA/i, /CHAPTER\s+R337\b/i, /\bR337\s+IN\s+THE\s+CRC/i];
const WORD_NUMBERS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const MANY_FLOORS = /\b(?:ALL\s+)?(TWO|THREE|FOUR|FIVE|[2-5])\s+(?:FLOORS|STORIES|LEVELS)\b/i;

type AduKind = "attached ADU" | "detached ADU" | "JADU";
const ADU_PATTERNS: Array<[AduKind, RegExp]> = [
  ["attached ADU", /\bATTACHED\s+ADU\b|\bADU\s*\(ATTACHED\)/i],
  ["detached ADU", /\bDETACHED\s+ADU\b|\bADU\s*\(DETACHED\)/i],
  ["JADU", /\bJADU\b|\bJUNIOR\s+ACCESSORY\s+DWELLING/i],
];
const ADU_OPTION: Record<string, AduKind> = {
  "Attached ADU": "attached ADU",
  "Detached ADU": "detached ADU",
  JADU: "JADU",
};

export function contradictionRules(ctx: RuleContext): Finding[] {
  const out: Finding[] = [];

  // CD-001: the cover says "not in a fire hazard zone" while notes apply wildland-urban interface rules.
  const claims = ctx.pages.map((p) => ({ p, m: findFirst(p.text, FIRE_ZONE_NO) })).filter((x) => x.m);
  const counters = ctx.pages.map((p) => ({ p, m: firstOf(p.text, WUI_YES) })).filter((x) => x.m);
  if (claims.length > 0 && counters.length > 0) {
    const c = claims[0];
    const w = counters[0];
    out.push(
      makeFinding({
        rule_id: "CD-001",
        severity: "high",
        title: "Fire hazard zone status contradicts the wildfire notes",
        subject: "fire hazard zone",
        pages: [...claims.map((x) => x.p), ...counters.map((x) => x.p)],
        evidence: `${c.p.label}: "${collapse(c.m!.text)}". ${w.p.label}: ${snippet(w.p.text, w.m!.index, w.m!.text.length, 60)}`,
        suggested_fix:
          "Check the parcel on the CAL FIRE hazard map. Then make the cover data and the fire notes agree, and keep the Chapter R337 notes only if the site is in a wildland-urban interface area.",
      }),
    );
  }

  // CD-002: notes describe more floors (or an elevator) than the stories on the cover.
  if (ctx.stories !== null) {
    const hits: Array<{ p: ClassifiedPage; text: string; index: number }> = [];
    for (const p of ctx.pages.filter((x) => x.kind === "architectural")) {
      const m = findFirst(p.text, MANY_FLOORS);
      if (!m) continue;
      const raw = m.groups[0].toUpperCase();
      const n = WORD_NUMBERS[raw] ?? Number(raw);
      if (n > ctx.stories) hits.push({ p, text: m.text, index: m.index });
    }
    if (hits.length > 0) {
      const elevator = hits.some((h) => /ELEVATOR/i.test(h.p.text));
      out.push(
        makeFinding({
          rule_id: "CD-002",
          severity: "high",
          title: `Notes describe more floors${elevator ? " and an elevator" : ""} than the ${ctx.stories}-story building`,
          subject: "number of floors",
          pages: hits.map((h) => h.p),
          evidence: `The cover states ${ctx.stories} stories. ${listSheets(hits.map((h) => h.p.label))}: ${snippet(hits[0].p.text, hits[0].index, hits[0].text.length, 80)}`,
          suggested_fix: elevator
            ? "Delete the elevator shaft note, or show the elevator on the plans, and describe the real number of floors."
            : "Correct the note to the real number of floors.",
        }),
      );
    }
  }

  // CD-003: the set names more than one ADU type, or a type other than the project's.
  const typed = ctx.pages
    .map((p) => ({ p, kinds: ADU_PATTERNS.filter(([, re]) => re.test(p.text)).map(([k]) => k) }))
    .filter((x) => x.kinds.length > 0);
  const kinds = unique(typed.flatMap((x) => x.kinds));
  const declared = ctx.options.aduType ? ADU_OPTION[ctx.options.aduType] : undefined;
  if (kinds.length > 1 || (declared && kinds.length === 1 && kinds[0] !== declared)) {
    out.push(
      makeFinding({
        rule_id: "CD-003",
        severity: "high",
        title: "Sheets disagree on the ADU type",
        subject: "ADU type",
        pages: typed.map((x) => x.p),
        evidence: typed.map((x) => `${x.p.label}: ${x.kinds.join(" and ")}`).join("; ") +
          (declared ? `. The project is entered as ${declared}.` : "."),
        suggested_fix:
          "Use one ADU type on every sheet, including the Title 24 report. An attached ADU and a JADU have different rules and fees.",
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- CY: code year

const CA_CODE_YEAR =
  /\b(20\d{2})\s+(?:CALIFORNIA|CA\.?)\s+(?:BUILDING|RESIDENTIAL|ENERGY|FIRE|PLUMBING|MECHANICAL|ELECTRICAL|GREEN\s+BUILDING(?:\s+STANDARDS)?|EXISTING\s+BUILDING|WILDLAND[- ]URBAN\s+INTERFACE)\s+CODE\b/gi;
const CA_ABBR_YEAR = /\b(20\d{2}|\d{2})\s+(CBC|CRC|CFC|CEC|CPC|CMC|CALGREEN|CGBSC)\b/g;

export function codeYearRules(ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const page of ctx.pages) {
    const hits = [...findAll(page.text, CA_CODE_YEAR), ...findAll(page.text, CA_ABBR_YEAR)]
      .map((m) => ({ m, year: m.groups[0].length === 2 ? 2000 + Number(m.groups[0]) : Number(m.groups[0]) }))
      .filter((h) => h.year !== ctx.pack.codeCycle)
      .sort((a, b) => a.m.index - b.m.index);
    if (hits.length === 0) continue;
    const cited = unique(hits.map((h) => collapse(h.m.text)));
    out.push(
      makeFinding({
        rule_id: "CY-001",
        severity: "medium",
        title: `Citations from an older code cycle (${unique(hits.map((h) => h.year)).join(", ")})`,
        subject: "code year",
        pages: [page],
        evidence: `${page.label} cites ${cited.map((c) => `"${c}"`).join(", ")}: ${snippet(page.text, hits[0].m.index, hits[0].m.text.length, 60)}`,
        suggested_fix: `Update every citation on this sheet to the ${ctx.pack.codeCycle} California code and check that the section numbers still match.`,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- AR: areas

interface AreaLine {
  label: string;
  value: number;
  text: string;
}

export function coverAreas(text: string): {
  lines: AreaLine[];
  first: AreaLine | null;
  second: AreaLine | null;
  garage: AreaLine | null;
  existingGarage: AreaLine | null;
  adu: AreaLine | null;
  total: AreaLine | null;
} {
  const pick = (source: string, label: string, re: RegExp): AreaLine | null => {
    const m = findFirst(source, re);
    return m ? { label, value: toNumber(m.groups[0]), text: collapse(m.text) } : null;
  };
  // The cover has an "(E) GROSS FLOOR AREA" block and an "(N) GROSS FLOOR AREA" block,
  // each ending with a total. The new (N) block is the one the plans must match.
  const blocks = new Map<string, string>();
  for (const m of findAll(text, /\((E|N)\)\s*GROSS\s+FLOOR\s+AREA\s*:?([\s\S]*?TOTAL\s+FLOOR\s+AREA[^\n]*)/i)) {
    const key = m.groups[0].toUpperCase();
    if (!blocks.has(key)) blocks.set(key, m.groups[1]);
  }
  const proposed = blocks.get("N") ?? text;
  const existing = blocks.get("E");
  const first = pick(proposed, "1st floor", /\b1ST\s+FLOOR\s*:\s*([\d,]+)/i);
  const second = pick(proposed, "2nd floor", /\b2ND\s+FLOOR\s*:\s*([\d,]+)/i);
  const garage = pick(proposed, "garage", /\(GARAGE\)\s*:\s*([\d,]+)/i);
  const total = pick(proposed, "total floor area", /\bTOTAL\s+FLOOR\s+AREA[^\d\n]*([\d,]+)/i);
  const existingGarage = existing
    ? pick(existing, "existing garage", /\(GARAGE\)\s*:\s*([\d,]+)/i)
    : pick(text, "existing garage", /\(E\)\s*\(?GARAGE\)?\s*:\s*([\d,]+)/i);
  const adu = pick(text, "ADU", /\bJ?ADU(?:\s*\((?:ATTACHED|DETACHED)\))?\s*:\s*([\d,]+)/i);
  const lines = [first, second, garage, total, adu, existingGarage].filter((l): l is AreaLine => l !== null);
  return { lines, first, second, garage, existingGarage, adu, total };
}

const PLAN_AREA = [/(\d[\d,]*)\s*sq\.?\s*ft\.?\s*Gr\.?\s*Area/gi, /Gr\.?\s*Area\s*:?\s*(\d[\d,]*)\s*sq/gi];

export function areaRules(ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  if (!ctx.cover) return out;
  const cover = coverAreas(ctx.cover.text);

  // AR-001: an area on a plan sheet that nearly, but not exactly, matches a cover area.
  const exact = new Set(cover.lines.map((l) => l.value));
  const mismatches = new Map<string, { line: AreaLine; values: Set<number>; pages: ClassifiedPage[] }>();
  for (const page of ctx.pages.filter((p) => p.kind === "architectural" && p !== ctx.cover)) {
    for (const re of PLAN_AREA) {
      for (const m of findAll(page.text, re)) {
        const v = toNumber(m.groups[0]);
        if (!v || exact.has(v)) continue;
        const near = cover.lines.find((l) => Math.abs(l.value - v) / l.value <= 0.05);
        if (!near) continue;
        const entry = mismatches.get(near.label) ?? { line: near, values: new Set<number>(), pages: [] };
        entry.values.add(v);
        entry.pages.push(page);
        mismatches.set(near.label, entry);
      }
    }
  }
  for (const { line, values, pages } of mismatches.values()) {
    const shown = [...values].map(formatNumber).join(" / ");
    out.push(
      makeFinding({
        rule_id: "AR-001",
        severity: "medium",
        title: `${line.label[0].toUpperCase()}${line.label.slice(1)} area differs between the cover and the plans`,
        subject: line.label,
        pages: [ctx.cover, ...pages],
        evidence: `${ctx.cover.label} states "${line.text}" (${formatNumber(line.value)} sq ft). ${listSheets(unique(pages.map((p) => p.label)))} show${pages.length === 1 ? "s" : ""} ${shown} sq ft.`,
        suggested_fix: "Measure the area again and use the same number on the cover and on every plan.",
      }),
    );
  }

  // AR-002: the scope of work and the area table disagree on the existing garage.
  const scope = findFirst(ctx.cover.text, /EXISTING\s+(\d[\d,]*)\s*SQ\.?\s*FT\.?\s+(?:ATTACHED\s+|DETACHED\s+)?GARAGE/i);
  if (scope && cover.existingGarage && toNumber(scope.groups[0]) !== cover.existingGarage.value) {
    out.push(
      makeFinding({
        rule_id: "AR-002",
        severity: "medium",
        title: "Existing garage area differs between the scope of work and the area table",
        subject: "existing garage",
        pages: [ctx.cover],
        evidence: `Scope of work: "${collapse(scope.text)}". Area table: "${cover.existingGarage.text}".`,
        suggested_fix: "Use one measured area for the existing garage in the scope of work, the area table and the ADU area.",
      }),
    );
  }

  // AR-003: the total does not add up.
  if (cover.total && cover.first && cover.second) {
    const base = cover.first.value + cover.second.value + (cover.garage?.value ?? 0);
    const sums = [base, base + (cover.adu?.value ?? 0)];
    if (!sums.includes(cover.total.value)) {
      out.push(
        makeFinding({
          rule_id: "AR-003",
          severity: "medium",
          title: "Total floor area does not add up",
          subject: "total floor area",
          pages: [ctx.cover],
          evidence: `"${cover.total.text}", but the floors and garage add up to ${formatNumber(base)} sq ft.`,
          suggested_fix: "Add the floor areas again and correct the total.",
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------- XR: cross-references

const CITED = /\bsheets?\s*[:-]?\s*((?:AD|A|G|S|T)-\d+(?:\.\d+)?(?:\s*(?:,|&|and)\s*(?:AD|A|G|S|T)-\d+(?:\.\d+)?)*)/gi;
const SEE_KIND = /\bSEE\s+(RENDER(?:ING)?|ELEVATION|SECTION)S?\s+((?:AD|A|G|S|T)-\d+(?:\.\d+)?)/gi;
const LEVEL = /\b(\d)(?:ST|ND|RD|TH)\s+(?:LEVEL|FLOOR|STORY)\b/gi;

export function crossReferenceRules(ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  const missing: MissingItem[] = [];
  const inSet = new Set(ctx.pages.map((p) => p.sheet));
  const bySheet = new Map(ctx.pages.map((p) => [p.sheet, p] as const));

  // XR-001: listed in the sheet index, not in the set.
  const notInSet = unique(ctx.index.filter((s) => !inSet.has(s)));
  for (const sheet of notInSet) {
    const where = ctx.cover ? [ctx.cover] : [];
    findings.push(
      makeFinding({
        rule_id: "XR-001",
        severity: "high",
        title: `Sheet ${sheet} is in the sheet index but not in the set`,
        subject: sheet,
        pages: where,
        evidence: `The sheet index on ${ctx.cover?.label ?? "the cover"} lists ${sheet}. No page of the set has ${sheet} in its title block.`,
        suggested_fix: `Add sheet ${sheet} to the set, or remove it from the sheet index.`,
      }),
    );
    missing.push({ item: sheet, reason: "Listed in the sheet index", cited_on: where.map((p) => p.label) });
  }

  // XR-002: cited in a note, not in the set.
  const cited = new Map<string, Array<{ p: ClassifiedPage; index: number; text: string }>>();
  for (const page of ctx.pages) {
    for (const m of findAll(page.text, CITED)) {
      for (const id of unique(findAll(m.groups[0], /(?:AD|A|G|S|T)-\d+(?:\.\d+)?/i).map((x) => x.text.toUpperCase()))) {
        if (inSet.has(id) || notInSet.includes(id)) continue;
        const list = cited.get(id) ?? [];
        list.push({ p: page, index: m.index, text: m.text });
        cited.set(id, list);
      }
    }
  }
  for (const [sheet, refs] of cited) {
    const labels = unique(refs.map((r) => r.p.label));
    findings.push(
      makeFinding({
        rule_id: "XR-002",
        severity: "high",
        title: `Notes refer to sheet ${sheet}, which is not in the set`,
        subject: sheet,
        pages: refs.map((r) => r.p),
        evidence: `${listSheets(labels)} cite${labels.length === 1 ? "s" : ""} ${sheet}: ${snippet(refs[0].p.text, refs[0].index, refs[0].text.length, 60)}`,
        suggested_fix: `Add sheet ${sheet}, or point the note to the sheet that has the detail.`,
      }),
    );
    missing.push({ item: sheet, reason: "Cited in a note", cited_on: labels });
  }

  // XR-003: "SEE RENDER A-0.2" where A-0.2 has no render. One finding per target and kind.
  const wrong = new Map<string, { kind: string; target: ClassifiedPage; refs: Array<{ p: ClassifiedPage; text: string }> }>();
  for (const page of ctx.pages) {
    for (const m of findAll(page.text, SEE_KIND)) {
      const kind = m.groups[0].toUpperCase().replace(/ING$/, "");
      const target = bySheet.get(m.groups[1].toUpperCase());
      const word = new RegExp(`\\b${kind}(?:ING)?S?\\b`, "i");
      if (!target || target === page || word.test(target.text)) continue;
      const key = `${kind} ${target.sheet}`;
      const entry = wrong.get(key) ?? { kind, target, refs: [] };
      entry.refs.push({ p: page, text: m.text });
      wrong.set(key, entry);
    }
  }
  for (const { kind, target, refs } of wrong.values()) {
    const word = new RegExp(`\\b${kind}(?:ING)?S?\\b`, "i");
    const referring = new Set(refs.map((r) => r.p));
    const holder = ctx.pages.find((p) => !referring.has(p) && p !== target && word.test(p.text));
    const labels = unique(refs.map((r) => r.p.label));
    findings.push(
      makeFinding({
        rule_id: "XR-003",
        severity: "medium",
        title: `Notes point to a ${kind.toLowerCase()} on ${target.label}, which has none`,
        subject: `${kind.toLowerCase()} ${target.label}`,
        pages: [target, ...referring, ...(holder ? [holder] : [])],
        evidence: `${listSheets(labels)}: "${collapse(refs[0].text)}". ${target.label} has no ${kind.toLowerCase()}${holder ? `; it is on ${holder.label}` : ""}.`,
        suggested_fix: `Point the notes to ${holder ? holder.label : "the sheet that has it"}.`,
      }),
    );
  }

  // XR-004: structural sheets that name a level the building does not have.
  if (ctx.stories !== null) {
    for (const page of ctx.pages.filter((p) => p.kind === "structural")) {
      const m = findAll(page.text, LEVEL).find((x) => Number(x.groups[0]) > (ctx.stories ?? 99));
      if (!m) continue;
      findings.push(
        makeFinding({
          rule_id: "XR-004",
          severity: "high",
          title: `Structural sheet shows a level the ${ctx.stories}-story building does not have`,
          subject: "levels",
          pages: [page],
          evidence: `${page.label}: "${collapse(m.text)}". The cover states ${ctx.stories} stories.`,
          suggested_fix: "Ask the structural engineer to correct the level names, or check that the sheet belongs to this project.",
        }),
      );
    }
  }
  return { findings, missing };
}

// ---------------------------------------------------------------- TB: title blocks

const STREET =
  /\b(\d{2,6})\s+((?:[A-Za-z]+\s+){0,3}?)(ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|LANE|LN|COURT|CT|WAY|BOULEVARD|BLVD|PLACE|PL|CIRCLE|CIR)\b\.?,?[ \t]*\n?[ \t]*([A-Za-z][A-Za-z ]*?)?(?=[ ,]*(?:CA|CALIFORNIA)\b|\n|$)/gi;
// Consultant contact data near an address: the address is the consultant's, not a project's.
const CONTACT = /@|\(?\b\d{3}\)?[-. ]\d{3}[-.]\d{4}\b|ENGINEERS?\b|HERS\s+RATER|LICENSE|LIC\./i;
const TRUST = /\b([A-Z]+(?:\s+[A-Z]+){0,3})\s+(?:LIVING|FAMILY|REVOCABLE)\s+TRUST\b/g;
const LEFTOVER_BLOCK = /SHEET NO\.[ \t]*\n\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\n/g;

export function titleBlockRules(ctx: RuleContext): Finding[] {
  const signals = new Map<string, ClassifiedPage[]>();
  const add = (signal: string, page: ClassifiedPage) => {
    const list = signals.get(signal) ?? [];
    list.push(page);
    signals.set(signal, list);
  };
  const owner = ctx.cover ? (findFirst(ctx.cover.text, /\bOWNER\b[^\n]*\n([^\n]+)/i)?.groups[0] ?? "") : "";
  for (const page of designPages(ctx)) {
    for (const m of findAll(page.text, STREET)) {
      if (ctx.projectNumber && m.groups[0] === ctx.projectNumber) continue;
      const around = page.text.slice(Math.max(0, m.index - 60), m.index + m.text.length + 60);
      if (CONTACT.test(around)) continue;
      add(`address "${collapse(m.text).replace(/,$/, "")}"`, page);
    }
    for (const m of findAll(page.text, TRUST)) {
      if (owner && collapse(owner).toUpperCase().includes(collapse(m.groups[0]).toUpperCase())) continue;
      add(`owner "${collapse(m.text)}"`, page);
    }
    for (const m of findAll(page.text, LEFTOVER_BLOCK)) {
      add(`a second title block dated ${m.groups[0]}`, page);
    }
  }
  if (signals.size === 0) return [];
  const pages = unique([...signals.values()].flat());
  const labels = unique(pages.sort((a, b) => a.page - b.page).map((p) => p.label));
  return [
    makeFinding({
      rule_id: "TB-001",
      severity: "high",
      title: "Another project's data is left in the title blocks",
      subject: "title block",
      pages,
      evidence: `${listSheets(labels)} carry ${[...signals.keys()].join(", ")}.`,
      suggested_fix:
        "Delete the old project's title block, address, owner and site plan from the sheet template, then print the set again.",
    }),
  ];
}

// ---------------------------------------------------------------- DT: dates

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

export function dateRules(ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  const arch = ctx.pages.filter((p) => p.kind === "architectural" && p.date);
  const setDate = mode(arch.map((p) => p.date!));
  if (!setDate) return out;
  const deps = ctx.pages.filter((p) => (p.kind === "survey" || p.kind === "structural") && p.date && p.date > setDate);
  if (deps.length > 0) {
    const survey = deps.filter((p) => p.kind === "survey");
    const struct = deps.filter((p) => p.kind === "structural");
    const parts = [
      survey.length ? `the survey (${survey.map((p) => formatDate(p.date!)).join(", ")})` : "",
      struct.length ? `the structural sheets (${unique(struct.map((p) => formatDate(p.date!))).join(", ")})` : "",
    ].filter(Boolean);
    out.push(
      makeFinding({
        rule_id: "DT-001",
        severity: "medium",
        title: "The architectural set is dated before the documents it depends on",
        subject: "set date",
        pages: [ctx.cover ?? arch[0], ...deps],
        evidence: `The architectural sheets are dated ${formatDate(setDate)}, before ${parts.join(" and ")}.`,
        suggested_fix: "Update the architectural sheets to match the current survey and structural design, then re-date and re-issue them.",
      }),
    );
  }
  for (const kind of ["architectural", "structural"] as const) {
    const pages = ctx.pages.filter((p) => p.kind === kind && p.date);
    const common = mode(pages.map((p) => p.date!));
    const odd = pages.filter((p) => p.date !== common);
    if (!common || odd.length === 0) continue;
    out.push(
      makeFinding({
        rule_id: "DT-002",
        severity: "low",
        title: `${kind === "architectural" ? "Architectural" : "Structural"} sheets carry different dates`,
        subject: `${kind} dates`,
        pages: odd,
        evidence: `Most ${kind} sheets are dated ${formatDate(common)}. ${odd.map((p) => `${p.label}: ${formatDate(p.date!)}`).join("; ")}.`,
        suggested_fix: "Re-issue the set with one current date in every title block, or list the revision on the sheets that changed.",
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- TP: third-party documents

const SOILS_CITED = /SOILS?\s+(?:REPORT|INVESTIGATION)|GEOTECHNICAL\s+(?:REPORT|INVESTIGATION)/i;
const SOILS_PAGE = /GEOTECHNICAL\s+(?:INVESTIGATION|ENGINEERING\s+REPORT|REPORT)|SOILS?\s+(?:INVESTIGATION|ENGINEERING)\s+REPORT/i;

export function thirdPartyRules(ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  const missing: MissingItem[] = [];

  // TP-001: a Title 24 report for another address.
  for (const page of ctx.pages.filter((p) => p.kind === "title24" && p.address)) {
    const num = /^(\d+)/.exec(page.address!)?.[1];
    if (!ctx.projectNumber || !num || num === ctx.projectNumber) continue;
    findings.push(
      makeFinding({
        rule_id: "TP-001",
        severity: "high",
        title: "Title 24 report is for another address",
        subject: "Title 24 address",
        pages: [page],
        evidence: `${page.label} is for "${page.address}".`,
        suggested_fix: "Ask the energy consultant for a Title 24 report for this project.",
      }),
    );
  }

  // TP-004: a soils report is cited but not included.
  const citing = designPages(ctx)
    .map((p) => ({ p, m: findFirst(p.text, SOILS_CITED) }))
    .filter((x) => x.m);
  const included = ctx.pages.some((p) => !DESIGN_KINDS.has(p.kind) && p.kind !== "title24" && SOILS_PAGE.test(p.text));
  if (citing.length > 0 && !included) {
    const basis = citing
      .map((x) => findFirst(x.p.text, /BASED\s+ON[\s\S]{0,160}?DATED\s+[A-Za-z]+\s+\d{1,2},\s*\d{4}/i))
      .find((m) => m);
    const labels = unique(citing.map((x) => x.p.label));
    findings.push(
      makeFinding({
        rule_id: "TP-004",
        severity: "high",
        title: "The soils report is cited but not in the set",
        subject: "Soils report",
        pages: citing.map((x) => x.p),
        evidence: `${listSheets(labels)}: ${basis ? `"${collapse(basis.text)}"` : snippet(citing[0].p.text, citing[0].m!.index, citing[0].m!.text.length, 60)}. No page of the set is the soils report.`,
        suggested_fix: "Add the soils report (or the geotechnical engineer's foundation letter) to the submittal.",
      }),
    );
    missing.push({ item: "Soils report", reason: "Cited by the structural notes", cited_on: labels });
  }
  return { findings, missing };
}
