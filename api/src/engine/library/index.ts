import { CODE_LIBRARY_DATA } from "./data";
import type { Citation, CodeLibraryData, CodePack, CodeSection } from "./types";

export type { Citation, CodeLibraryData, CodePack, CodeSection } from "./types";

export const CODE_LIBRARY: CodeLibraryData = CODE_LIBRARY_DATA;

/** Parts whose official text we may store word for word (free state publications). */
export const TEXT_ALLOWED_CODES = ["Energy Code"];

const BY_ID = new Map(CODE_LIBRARY.sections.map((s) => [s.id, s]));
const PACK_BY_ID = new Map(CODE_LIBRARY.packs.map((p) => [p.id, p]));

export function hasSection(id: string): boolean {
  return BY_ID.has(id);
}

/** The section with this id. Throws when the library has no such entry. */
export function getSection(id: string): CodeSection {
  const section = BY_ID.get(id);
  if (!section) throw new Error(`The code library has no section "${id}".`);
  return section;
}

export function getCodePack(id: string): CodePack | undefined {
  return PACK_BY_ID.get(id);
}

/** The citation a finding or a sheet carries for one library id. */
export function cite(id: string): Citation {
  const s = getSection(id);
  return { id: s.id, label: s.label, title: s.title, source_url: s.source_url, edition: s.edition };
}

/** Problems in the library data: duplicate ids, unknown packs, missing fields, stored ICC text. */
export function validateLibrary(data: CodeLibraryData = CODE_LIBRARY): string[] {
  const problems: string[] = [];
  const packs = new Set(data.packs.map((p) => p.id));
  const seen = new Set<string>();
  const date = /^\d{4}-\d{2}-\d{2}$/;
  for (const p of data.packs) {
    if (!/^https:\/\//.test(p.source_url)) problems.push(`Pack ${p.id} has no https source link.`);
    if (!date.test(p.last_checked)) problems.push(`Pack ${p.id} has no last-checked date.`);
  }
  for (const s of data.sections) {
    if (seen.has(s.id)) problems.push(`Section id ${s.id} is used twice.`);
    seen.add(s.id);
    if (!packs.has(s.pack)) problems.push(`Section ${s.id} names an unknown pack ${s.pack}.`);
    for (const field of ["code", "part", "section", "title", "label", "summary", "edition"] as const) {
      if (!s[field]?.trim()) problems.push(`Section ${s.id} has no ${field}.`);
    }
    if (!/^https:\/\//.test(s.source_url)) problems.push(`Section ${s.id} has no https source link.`);
    if (!date.test(s.last_checked)) problems.push(`Section ${s.id} has no last-checked date.`);
    if (s.text !== undefined && !TEXT_ALLOWED_CODES.includes(s.code)) {
      problems.push(`Section ${s.id} stores code text, but only Energy Code text may be stored.`);
    }
  }
  return problems;
}

export interface LibraryGroup {
  jurisdiction: string;
  pack: CodePack;
  parts: Array<{ part: string; sections: CodeSection[] }>;
}

/** The library grouped by jurisdiction (pack), then code part, in the data file's order. */
export function groupLibrary(
  sections: CodeSection[] = CODE_LIBRARY.sections,
  packs: CodePack[] = CODE_LIBRARY.packs,
): LibraryGroup[] {
  const groups: LibraryGroup[] = [];
  for (const pack of packs) {
    const parts: LibraryGroup["parts"] = [];
    for (const s of sections.filter((x) => x.pack === pack.id)) {
      let part = parts.find((p) => p.part === s.part);
      if (!part) parts.push((part = { part: s.part, sections: [] }));
      part.sections.push(s);
    }
    if (parts.length > 0) groups.push({ jurisdiction: pack.jurisdiction, pack, parts });
  }
  return groups;
}
