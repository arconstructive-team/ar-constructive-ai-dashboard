// The code sections behind each rule. Every id here is a code library entry (library/data.ts).
// `state` ids apply in every jurisdiction. `local` names a role in the jurisdiction pack
// (pack.local); the pack maps it to its own municipal code entry, when it has one.
import type { Citation } from "./library";
import { cite } from "./library";
import type { JurisdictionPack, LocalRole } from "./types";

export interface RuleCitation {
  state: string[];
  local: LocalRole[];
}

const DRAWINGS = "CRC-R106.1.1";

export const RULE_CITATIONS: Record<string, RuleCitation> = {
  // A set names another jurisdiction's codes or agencies.
  "JB-001": { state: [DRAWINGS], local: ["code", "building", "residential"] },
  // A set names another fire agency.
  "JB-002": { state: ["T24-P9"], local: ["fire"] },
  // The fire hazard zone statements contradict each other.
  "CD-001": { state: ["T24-P7", DRAWINGS], local: ["wui"] },
  // Two sheets state different project data.
  "CD-002": { state: [DRAWINGS], local: [] },
  // ADU and JADU rules are mixed up.
  "CD-003": { state: ["GOV-66314", "GOV-66333"], local: ["adu"] },
  // An old code cycle is cited.
  "CY-001": { state: ["T24-2025"], local: ["building", "residential"] },
  // Areas do not add up or do not match between sheets.
  "AR-001": { state: [DRAWINGS], local: [] },
  "AR-002": { state: [DRAWINGS], local: [] },
  "AR-003": { state: [DRAWINGS], local: [] },
  // Sheet index and cross references.
  "XR-001": { state: [DRAWINGS], local: [] },
  "XR-002": { state: [DRAWINGS], local: [] },
  "XR-003": { state: [DRAWINGS], local: [] },
  "XR-004": { state: [DRAWINGS], local: [] },
  // Title blocks.
  "TB-001": { state: [DRAWINGS], local: [] },
  // Dates.
  "DT-001": { state: [DRAWINGS], local: [] },
  "DT-002": { state: [DRAWINGS], local: [] },
  // The Title 24 energy report is for another project.
  "TP-001": { state: ["ENERGY-10-103"], local: ["energy"] },
  // The soils report is missing.
  "TP-004": { state: ["CRC-R401.4", "CBC-1803"], local: [] },
};

/** The library ids a rule cites in a jurisdiction: the state sections, then the local ones. */
export function citationIds(ruleId: string, pack: JurisdictionPack): string[] {
  const entry = RULE_CITATIONS[ruleId];
  if (!entry) throw new Error(`Rule ${ruleId} has no code citations. Add it to RULE_CITATIONS.`);
  const local = entry.local.map((role) => pack.local[role]).filter((id): id is string => Boolean(id));
  return [...new Set([...entry.state, ...local])];
}

/** The citations a finding of this rule carries, resolved from the code library. */
export function citationsFor(ruleId: string, pack: JurisdictionPack): Citation[] {
  return citationIds(ruleId, pack).map(cite);
}
