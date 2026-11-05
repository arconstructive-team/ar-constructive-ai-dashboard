// Reads what a chat message asks for. The check engine is rule based, so the
// assistant understands a fixed set of requests and says so for anything else.
import { JURISDICTIONS, type AduType, type Jurisdiction, type ProjectData } from "../lib/project";

export interface Instruction {
  /** "Regenerate the sheets": write the sheet set artifact. */
  regenerate: boolean;
  /** "Check the set": run the permit check and write the issue report. */
  check: boolean;
  /** Project data to change before the set is checked again. */
  changes: Partial<ProjectData>;
  /** The message talks about the sheets, so a follow-up edits the sheet set first. */
  aboutSheets: boolean;
}

/** The words of each jurisdiction name that tell it apart, e.g. "San Ramon". */
const JURISDICTION_WORDS: Array<[Jurisdiction, RegExp]> = JURISDICTIONS.map((j) => {
  const place = j
    .replace(/^(Town|City) of /, "")
    .replace(/^Unincorporated /, "")
    .replace(/ County$/, "");
  return [j, new RegExp(`\\b${place.replace(/ /g, "\\s+")}\\b`, "i")];
});

const ADU_WORDS: Array<[AduType, RegExp]> = [
  ["JADU", /\b(jadu|junior adu|junior accessory)\b/i],
  ["Detached ADU", /\bdetached\s+adu\b/i],
  ["Attached ADU", /\battached\s+adu\b/i],
  ["No ADU", /\b(no adu|without (an )?adu)\b/i],
];

const REGENERATE = /\b(re-?generate|re-?generating|regeneration|redo|rewrite|redraw|re-?write)\b/i;
const MAKE_SHEETS = /\b(make|create|generate|build|write|draft)\b[^.]*\b(sheets?|cover|general notes|calgreen)\b/i;
const CHECK = /\b(check|re-?check|review|issue report|issues|plan check)\b/i;
const SHEET_WORDS = /\b(sheets?|cover|notes|calgreen|a-0\.\d)\b/i;
const FIX_JURISDICTION = /\bjurisdiction\b/i;
const FIX_WORDS = /\b(fix|correct|wrong|right|update|change)\b/i;
const ADDRESS = /\baddress\s*(?:is|to|should be|:)\s*(.+?)\s*\.?$/i;

/**
 * Reads one message. `detected` is the jurisdiction the uploaded set names, so
 * "fix the jurisdiction notes" can switch to it.
 */
export function readInstruction(text: string, detected: string | null): Instruction {
  const changes: Partial<ProjectData> = {};

  const named = JURISDICTION_WORDS.find(([, pattern]) => pattern.test(text));
  if (named) {
    changes.jurisdiction = named[0];
  } else if (FIX_JURISDICTION.test(text) && FIX_WORDS.test(text) && detected) {
    const match = JURISDICTIONS.find((j) => j === detected);
    if (match) changes.jurisdiction = match;
  }

  const adu = ADU_WORDS.find(([, pattern]) => pattern.test(text));
  if (adu) changes.aduType = adu[0];

  const address = ADDRESS.exec(text);
  if (address && address[1].trim().length >= 5) changes.address = address[1].trim();

  return {
    regenerate: REGENERATE.test(text) || MAKE_SHEETS.test(text),
    check: CHECK.test(text),
    changes,
    aboutSheets: SHEET_WORDS.test(text),
  };
}

export function hasChanges(instruction: Instruction): boolean {
  return Object.keys(instruction.changes).length > 0;
}

/** Applies the changes and says what changed, e.g. "jurisdiction to City of San Ramon". */
export function applyChanges(project: ProjectData, changes: Partial<ProjectData>): { project: ProjectData; said: string[] } {
  const next = { ...project, ...changes };
  const said: string[] = [];
  if (changes.jurisdiction && changes.jurisdiction !== project.jurisdiction) said.push(`jurisdiction to ${changes.jurisdiction}`);
  if (changes.aduType && changes.aduType !== project.aduType) said.push(`ADU type to ${changes.aduType}`);
  if (changes.address && changes.address !== project.address) said.push(`address to ${changes.address}`);
  return { project: next, said };
}

export const HELP_TEXT =
  "I can do these things in this chat:\n" +
  "1. Work on a permit set: select + and choose the PDF. I read it, keep it for the team and ask what to do with it.\n" +
  "   Write \"check the set\" for an issue report.\n" +
  "2. Regenerate the sheets: write \"regenerate the sheets\". I write the cover data and notes sheets.\n" +
  "3. Change the project and check again: name a jurisdiction (\"check it as San Ramon\"), an ADU type (\"detached ADU\") or \"the address is …\". " +
  "I write a new version of the open artifact.\n" +
  "For other changes, edit the artifact text directly.";
