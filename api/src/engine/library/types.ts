/** One stored pack of code sections: the state codes, or one jurisdiction's local code. */
export interface CodePack {
  id: string;
  jurisdiction: string;
  name: string;
  /** "2025", or the local amendment it belongs to, e.g. "Danville amendment (2025 cycle)". */
  edition: string;
  /** The date the edition takes effect, yyyy-mm-dd. */
  effective: string;
  /** The date a person or the monthly check last compared the pack with its source, yyyy-mm-dd. */
  last_checked: string;
  source_url: string;
  /** How the pack is checked, and what is not checked yet. */
  check_note: string;
}

/**
 * One code section. For copyrighted codes (ICC, NFPA, IAPMO, municipal codes) we store only
 * the number, the title, our own summary and a link. `text` (the official words) is allowed
 * only for the Energy Code (Title 24 Part 6), a free state publication.
 */
export interface CodeSection {
  /** Stable id that rules and sheets cite, e.g. "CRC-R314". */
  id: string;
  /** The pack id it belongs to. */
  pack: string;
  /** Short code name, e.g. "CRC". */
  code: string;
  /** The code part, e.g. "Title 24, Part 2.5". */
  part: string;
  /** Section or chapter number as the code prints it, e.g. "R314" or "Chapter 17". */
  section: string;
  title: string;
  /** How a sheet or a finding names it, e.g. "CRC Section R314". */
  label: string;
  /** Our own plain summary, never the code's words. */
  summary: string;
  source_url: string;
  edition: string;
  last_checked: string;
  text?: string;
}

export interface CodeLibraryData {
  /** Changes each time an entry changes: yyyy-mm-dd.n */
  version: string;
  packs: CodePack[];
  sections: CodeSection[];
}

/** A section as a finding or a sheet cites it. */
export interface Citation {
  id: string;
  label: string;
  title: string;
  source_url: string;
  edition: string;
}
