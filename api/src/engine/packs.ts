import type { JurisdictionPack } from "./types";

export const CODE_CYCLE = 2025;

/** Jurisdictions whose codes or names turn up as copied boilerplate in Bay Area permit sets. */
export const KNOWN_JURISDICTIONS: Array<{ name: string; patterns: RegExp[] }> = [
  { name: "Town of Tiburon", patterns: [/\bTMC\s*\d/, /\bTiburon\b/i] },
  {
    name: "City of Berkeley",
    patterns: [/\bBMC\s*\d/, /\bBerkeley\s+Municipal\s+Code\b/i, /\bCity\s+of\s+Berkeley\b/i],
  },
  { name: "City and County of San Francisco", patterns: [/\bSF(?:BC|EC|MC|PC|HC|FC)\b/, /\bSan\s+Francisco\b/i] },
  { name: "City of Redwood City", patterns: [/\bRedwood\s+City\b/i] },
  { name: "City of Oakland", patterns: [/\bOMC\s*\d/, /\bCity\s+of\s+Oakland\b/i] },
  { name: "City of Los Angeles", patterns: [/\bLAMC\b/, /\bLADBS\b/] },
  { name: "City of San Jose", patterns: [/\bSJMC\b/, /\bCity\s+of\s+San\s+Jose\b/i] },
  { name: "City of Palo Alto", patterns: [/\bPAMC\b/, /\bCity\s+of\s+Palo\s+Alto\b/i] },
  { name: "City of Lafayette", patterns: [/\bLafayette\s+Municipal\s+Code\b/i, /\bCity\s+of\s+Lafayette\b/i] },
  { name: "City of Walnut Creek", patterns: [/\bWalnut\s+Creek\s+Municipal\s+Code\b/i, /\bCity\s+of\s+Walnut\s+Creek\b/i] },
  { name: "City of San Ramon", patterns: [/\bCity\s+of\s+San\s+Ramon\b/i, /\bSan\s+Ramon\s+Municipal\s+Code\b/i] },
  { name: "City of Orinda", patterns: [/\bCity\s+of\s+Orinda\b/i, /\bOrinda\s+Municipal\s+Code\b/i] },
  { name: "Town of Moraga", patterns: [/\bTown\s+of\s+Moraga\b/i, /\bMoraga\s+Municipal\s+Code\b/i] },
  { name: "Town of Danville", patterns: [/\bTown\s+of\s+Danville\b/i, /\bDanville\s+Municipal\s+Code\b/i] },
];

/** Fire agencies. A set may only name the agency of its own jurisdiction. */
export const KNOWN_FIRE_AGENCIES: Array<{ name: string; pattern: RegExp }> = [
  { name: "Sonoma Valley Fire", pattern: /\bSonoma\s+Valley\s+Fire\b/i },
  {
    name: "San Ramon Valley Fire Protection District",
    pattern: /\bSan\s+Ramon\s+Valley\s+Fire\b|\bSRVFPD\b/i,
  },
  {
    name: "Contra Costa County Fire Protection District",
    pattern: /\bContra\s+Costa\s+(?:County\s+)?Fire\b|\bCCCFPD\b/i,
  },
  { name: "Moraga-Orinda Fire District", pattern: /\bMoraga[- ]Orinda\s+Fire\b|\bMOFD\b/ },
  { name: "Southern Marin Fire Protection District", pattern: /\bSouthern\s+Marin\s+Fire\b/i },
  { name: "Tiburon Fire Protection District", pattern: /\bTiburon\s+Fire\b/i },
  { name: "Marin County Fire Department", pattern: /\bMarin\s+County\s+Fire\b/i },
  { name: "Alameda County Fire Department", pattern: /\bAlameda\s+County\s+Fire\b/i },
  { name: "San Francisco Fire Department", pattern: /\bSan\s+Francisco\s+Fire\b|\bSFFD\b/i },
  { name: "Oakland Fire Department", pattern: /\bOakland\s+Fire\b/i },
  { name: "Menlo Park Fire Protection District", pattern: /\bMenlo\s+Park\s+Fire\b/i },
  { name: "Santa Clara County Fire Department", pattern: /\bSanta\s+Clara\s+County\s+Fire\b/i },
];

export const DANVILLE_2025: JurisdictionPack = {
  id: "danville-2025",
  name: "Town of Danville, 2025 California codes",
  jurisdiction: "Town of Danville",
  codeCycle: CODE_CYCLE,
  allowedJurisdictions: ["Town of Danville"],
  allowedAgencies: ["San Ramon Valley Fire Protection District"],
  fireAgency: "San Ramon Valley Fire Protection District (SRVFPD)",
  codePacks: ["ca-2025", "danville-2025"],
  // Danville Municipal Code entries in the code library (library/data.ts).
  local: {
    code: "DMC",
    building: "DMC-10-1",
    residential: "DMC-10-2",
    electrical: "DMC-10-3",
    fire: "DMC-10-6",
    green: "DMC-10-7",
    energy: "DMC-10-14",
    existing: "DMC-10-19",
    wui: "DMC-10-20",
    adu: "DMC-32-76",
    trees: "DMC-32-79",
  },
};

const FIRE_BY_JURISDICTION: Record<string, string> = {
  "City of San Ramon": "San Ramon Valley Fire Protection District",
  "City of Lafayette": "Contra Costa County Fire Protection District",
  "City of Walnut Creek": "Contra Costa County Fire Protection District",
  "City of Orinda": "Moraga-Orinda Fire District",
  "Town of Moraga": "Moraga-Orinda Fire District",
  "Unincorporated Contra Costa County": "Contra Costa County Fire Protection District",
};

/** The rule pack for a jurisdiction. Danville has the full pack; others get the 2025 base. */
export function getPack(jurisdiction?: string): JurisdictionPack {
  if (!jurisdiction || jurisdiction === DANVILLE_2025.jurisdiction) return DANVILLE_2025;
  const fire = FIRE_BY_JURISDICTION[jurisdiction];
  return {
    id: "california-2025-base",
    name: `${jurisdiction}, 2025 California codes (base pack)`,
    jurisdiction,
    codeCycle: CODE_CYCLE,
    allowedJurisdictions: [jurisdiction],
    allowedAgencies: fire ? [fire] : [],
    fireAgency: fire ?? "the local fire authority",
    // The library has no municipal code entries for this jurisdiction yet: state sections only.
    codePacks: ["ca-2025"],
    local: {},
  };
}
