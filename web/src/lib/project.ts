// Project data and permit-set file rules for the "Check a permit set" screen.
// Jurisdictions and rule families come from the product spec (ARCO-5).

export const JURISDICTIONS = [
  "Town of Danville",
  "City of San Ramon",
  "City of Lafayette",
  "City of Walnut Creek",
  "City of Orinda",
  "Town of Moraga",
  "Unincorporated Contra Costa County",
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const ADU_TYPES = ["No ADU", "Attached ADU", "Detached ADU", "JADU"] as const;
export type AduType = (typeof ADU_TYPES)[number];

export const CODE_CYCLE = 2025;
export const MAX_SET_BYTES = 200 * 1024 * 1024;
export const HEADER_BYTES = 1024;

export interface ProjectData {
  address: string;
  jurisdiction: Jurisdiction | "";
  aduType: AduType;
}

export type ProjectErrors = Partial<Record<"address" | "jurisdiction", string>>;

export const RULE_FAMILIES = [
  { code: "JB", name: "Jurisdiction boilerplate", text: "Code, ordinance or fire agency names from another city." },
  { code: "CD", name: "Contradictions", text: "Sheets that disagree, such as fire-zone status or ADU type." },
  { code: "CY", name: "Code year", text: "Citations from a code cycle other than 2025." },
  { code: "AR", name: "Areas", text: "Floor, garage and ADU areas that differ between sheets, or totals that do not add up." },
  { code: "XR", name: "Cross-references", text: "Indexed or cited sheets that are not in the set." },
  { code: "TB", name: "Title blocks", text: "Another project's address, owner or name left in a title block." },
  { code: "DT", name: "Dates", text: "A set dated before the survey or structural sheets it depends on." },
  { code: "TP", name: "Third-party documents", text: "Survey, Title 24, manufacturer sheets and soils report against your sheets." },
] as const;

export function validateProject(project: ProjectData): ProjectErrors {
  const errors: ProjectErrors = {};
  if (project.address.trim().length < 5) {
    errors.address = "Enter the project street address, for example 428 El Rio Rd, Danville.";
  }
  if (!project.jurisdiction) {
    errors.jurisdiction = "Choose the jurisdiction that reviews this permit.";
  }
  return errors;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when "%PDF-" appears in the first bytes, as PDF readers accept it. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, HEADER_BYTES);
  for (let start = 0; start + PDF_MAGIC.length <= limit; start++) {
    let match = true;
    for (let i = 0; i < PDF_MAGIC.length; i++) {
      if (bytes[start + i] !== PDF_MAGIC[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/** Returns what is wrong with the chosen file and how to fix it, or null when it is a usable set. */
export function checkSetFile(file: { size: number }, header: Uint8Array): string | null {
  if (file.size === 0) {
    return "This file is empty. Export the set from your CAD tool again and choose the new file.";
  }
  if (file.size > MAX_SET_BYTES) {
    return `This file is ${formatBytes(file.size)} and the limit is 200 MB. Export the PDF with lower image resolution and try again.`;
  }
  if (!hasPdfHeader(header)) {
    return "This file is not a PDF. Export the full permit set as one PDF and choose that file.";
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reads the first bytes of a file, enough to check the PDF header. */
export function readHeader(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error("The file could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(file.slice(0, HEADER_BYTES));
  });
}
