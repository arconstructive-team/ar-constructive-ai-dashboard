// Shared types of the permit-set check engine. The engine is pure TypeScript with no
// dependencies, so the API server and the dashboard (in the browser) run the same code.
import type { Citation } from "./library/types";

export type { Citation, CodeLibraryData, CodePack, CodeSection } from "./library/types";

export type RuleFamily = "JB" | "CD" | "CY" | "AR" | "XR" | "TB" | "DT" | "TP";
export type Severity = "high" | "medium" | "low";
export type PageKind = "architectural" | "structural" | "title24" | "survey" | "general" | "other";
export type ClassifyMethod = "title-block" | "index-order" | "unknown";

/** The text of one PDF page, as the PDF reader extracts it. Pages count from 1. */
export interface PageText {
  page: number;
  text: string;
}

export interface PageSummary {
  page: number;
  /** Sheet number, e.g. "A-2.3". Title 24 pages keep "T-1" here. */
  sheet: string;
  /** Sheet number as shown to people: "T-1 (ADU)" for the ADU Title 24 pages. */
  label: string;
  kind: PageKind;
  title: string;
  /** The primary title-block date (the revised date when there is one), as yyyy-mm-dd. */
  date: string | null;
  /** The project address line of the title block, when the page has one. */
  address: string | null;
  method: ClassifyMethod;
}

export interface ClassifiedPage extends PageSummary {
  text: string;
}

export interface Finding {
  rule_id: string;
  family: RuleFamily;
  severity: Severity;
  title: string;
  /** What the finding is about: a jurisdiction, a missing sheet, an area line. */
  subject: string;
  /** Sheet labels in page order. The first one is where the dashboard lists the finding. */
  sheets: string[];
  pages: number[];
  evidence: string;
  suggested_fix: string;
  /** The code sections behind the finding, from the code library. */
  citations?: Citation[];
}

export interface MissingItem {
  item: string;
  reason: string;
  cited_on: string[];
}

export interface EngineOptions {
  jurisdiction?: string;
  aduType?: string;
  address?: string;
}

export interface JurisdictionPack {
  id: string;
  name: string;
  jurisdiction: string;
  codeCycle: number;
  /** Agencies and jurisdictions a set for this jurisdiction may name. */
  allowedJurisdictions: string[];
  allowedAgencies: string[];
  fireAgency: string;
  /** The code library packs whose sections this pack cites (state first, then local). */
  codePacks: string[];
  /** The jurisdiction's own municipal code entries in the code library, by role. */
  local: Partial<Record<LocalRole, string>>;
}

/** What a local code library entry is for, so rules and sheets can cite it by role. */
export type LocalRole =
  | "code"
  | "building"
  | "residential"
  | "electrical"
  | "fire"
  | "green"
  | "energy"
  | "existing"
  | "wui"
  | "adu"
  | "trees";

/** The jurisdiction the set itself names, next to the one the user selected. */
export interface JurisdictionCheck {
  selected: string;
  /** null when the set names no jurisdiction we know. */
  detected: string | null;
  /** The text that names it, e.g. "PROJECT DATA: 428 EL RIO RD, DANVILLE, 94526". */
  evidence: string | null;
  sheet: string | null;
  page: number | null;
  /** false when the set names another jurisdiction than the selected one. */
  matches: boolean;
}

export interface EngineResult {
  pack: string;
  pack_name: string;
  code_cycle: number;
  pages: PageSummary[];
  sheet_index: string[];
  findings: Finding[];
  missing: MissingItem[];
  counts: Record<RuleFamily, number>;
  jurisdiction?: JurisdictionCheck;
}

/** One titled block of notes on a regenerated sheet. Each line is one paragraph. */
export interface SheetSection {
  heading: string;
  lines: string[];
}

/** A sheet the engine wrote again from the project data and the jurisdiction pack. */
export interface RegeneratedSheet {
  sheet: string;
  title: string;
  /** The page of the original set that this sheet replaces, or null when the set has none. */
  original_page: number | null;
  /** Title-block date, mm/dd/yyyy. */
  date: string;
  job: string | null;
  /** Title-block address lines; the first one starts with the street number. */
  address: string[];
  /** The title-block lines in print order (blank strings are spacers). */
  title_block: string[];
  sections: SheetSection[];
  /** The page text in reading order, as a PDF reader extracts it from the generated PDF. */
  text: string;
  /** Every code library section the sheet cites, in the order it first cites them. */
  citations?: Citation[];
}

export interface RegeneratedSet {
  pack: string;
  pack_name: string;
  code_cycle: number;
  address: string;
  sheets: RegeneratedSheet[];
  /** What the architect must check or fill in before the sheets are issued. */
  to_confirm: string[];
  /** What the engine still finds when it checks the regenerated sheets on their own. */
  findings: Finding[];
}

/** The engine result plus the regenerated sheets (null when the set has no architectural cover). */
export interface CheckResult extends EngineResult {
  regenerated?: RegeneratedSet | null;
}

export interface RuleContext {
  pages: ClassifiedPage[];
  index: string[];
  cover: ClassifiedPage | undefined;
  pack: JurisdictionPack;
  options: EngineOptions;
  /** Street number of the project, e.g. "428". */
  projectNumber: string | null;
  /** Number of stories the cover sheet states. */
  stories: number | null;
}
