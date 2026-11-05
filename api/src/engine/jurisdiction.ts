// Reads which jurisdiction the permit set is for, from the set itself, so the report can warn
// when the user checked it against another jurisdiction. Copied boilerplate (an old project's
// address in the background, the engineer's office address) must not count, so only these
// places are read, in this order:
//   1. the cover's "JURISDICTION:" line,
//   2. the cover's project address,
//   3. the city line under the project address in the architectural title blocks (most common).
import type { ClassifiedPage, JurisdictionCheck } from "./types";
import { readProjectFacts } from "./regenerate";
import { collapse } from "./text";

/** City or area names on a set, and the jurisdiction (as the dashboard lists it) they belong to. */
export const CITY_PATTERNS: Array<{ jurisdiction: string; pattern: RegExp }> = [
  { jurisdiction: "Town of Danville", pattern: /\bDANVILLE\b/i },
  { jurisdiction: "City of San Ramon", pattern: /\bSAN\s+RAMON\b(?!\s+VALLEY)/i },
  { jurisdiction: "City of Lafayette", pattern: /\bLAFAYETTE\b/i },
  { jurisdiction: "City of Walnut Creek", pattern: /\bWALNUT\s+CREEK\b/i },
  { jurisdiction: "City of Orinda", pattern: /\bORINDA\b/i },
  { jurisdiction: "Town of Moraga", pattern: /\bMORAGA\b/i },
  { jurisdiction: "Unincorporated Contra Costa County", pattern: /\b(?:ALAMO|DIABLO|BLACKHAWK)\b/i },
];

/** The jurisdiction a piece of text names, or null. */
export function jurisdictionIn(text: string): string | null {
  for (const { jurisdiction, pattern } of CITY_PATTERNS) if (pattern.test(text)) return jurisdiction;
  return null;
}

interface Hit {
  jurisdiction: string;
  evidence: string;
  page: ClassifiedPage;
}

function fromCover(cover: ClassifiedPage): Hit | null {
  const line = /^[ \t]*JURISDICTION\s*:[ \t]*([^\n]+)/im.exec(cover.text);
  const named = line ? jurisdictionIn(line[1]) : null;
  if (line && named) return { jurisdiction: named, evidence: collapse(line[0]), page: cover };
  const address = readProjectFacts(cover.text).address;
  const comma = address?.indexOf(",") ?? -1;
  if (address && comma !== -1) {
    const city = jurisdictionIn(address.slice(comma + 1));
    if (city) return { jurisdiction: city, evidence: `PROJECT ADDRESS: ${address}`, page: cover };
  }
  return null;
}

// The two lines after the title-block address line ("428 EL RIO ," then "DANVILLE, CA").
function titleBlockCity(page: ClassifiedPage): Hit | null {
  if (!page.address) return null;
  const lines = page.text.split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => l === page.address || l.startsWith(page.address!));
  if (at === -1) return null;
  const after = lines.slice(at + 1, at + 3).filter(Boolean);
  for (const line of after) {
    const city = jurisdictionIn(line);
    if (city) return { jurisdiction: city, evidence: collapse(`${lines[at]} ${line}`), page };
  }
  return null;
}

/** Compares the jurisdiction the set names with the one the user selected. */
export function detectJurisdiction(
  pages: ClassifiedPage[],
  cover: ClassifiedPage | undefined,
  selected: string,
): JurisdictionCheck {
  let hit = cover ? fromCover(cover) : null;
  if (!hit) {
    const votes = pages.filter((p) => p.kind === "architectural").map(titleBlockCity).filter((h): h is Hit => h !== null);
    const counts = new Map<string, number>();
    for (const v of votes) counts.set(v.jurisdiction, (counts.get(v.jurisdiction) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    hit = votes.find((v) => v.jurisdiction === best) ?? null;
  }
  return {
    selected,
    detected: hit?.jurisdiction ?? null,
    evidence: hit?.evidence ?? null,
    sheet: hit?.page.label ?? null,
    page: hit?.page.page ?? null,
    matches: !hit || hit.jurisdiction === selected,
  };
}
