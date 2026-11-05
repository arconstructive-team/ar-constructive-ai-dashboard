// Shared types of the permit-set check engine. The engine is pure TypeScript with no
// dependencies, so the API server and the dashboard (in the browser) run the same code.

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
  /** Local code names that are correct for this jurisdiction (for reference in fixes). */
  localCodeNames: string[];
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
