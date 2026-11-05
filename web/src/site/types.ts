/**
 * The site report as the web app reads it. The API builds it (api/src/site/types.ts); this is
 * the part of its shape the Site section shows. Keep the two in step.
 */
export type StepStatus = "ok" | "failed" | "unknown";

export interface SourceRef {
  name: string;
  url: string;
  /** ISO date and time the source was read. */
  fetchedAt: string;
}

export interface SiteImage {
  /** A signed path on the API, e.g. /api/site/image?kind=streetview&...&sig=... */
  path: string;
  label: string;
  heading?: number;
  zoom?: number;
}

export interface ImageSet {
  copyright: string;
  images: SiteImage[];
  date?: string;
}

export interface Step<T = unknown> {
  status: StepStatus;
  sources: SourceRef[];
  data?: T;
  error?: string;
  note?: string;
  checkUrl?: string;
  /** The facts in one plain line. */
  summary?: string;
}

export const STEP_NAMES = [
  "geocode",
  "streetView",
  "satellite",
  "solar",
  "parcel",
  "jurisdiction",
  "zoning",
  "flood",
  "fire",
  "seismic",
  "elevation",
  "climateZone",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export const STEP_LABEL: Record<StepName, string> = {
  geocode: "Address location",
  streetView: "Street View",
  satellite: "Satellite view",
  solar: "Roof (Google Solar)",
  parcel: "Parcel",
  jurisdiction: "Jurisdiction",
  zoning: "Zoning",
  flood: "FEMA flood zone",
  fire: "CAL FIRE hazard zone",
  seismic: "CGS earthquake zones",
  elevation: "Elevation",
  climateZone: "Energy code climate zone",
};

export type SiteSteps = Record<StepName, Step> & {
  streetView: Step<ImageSet>;
  satellite: Step<ImageSet>;
};

export interface SiteReport {
  version: 1;
  address: string;
  generatedAt: string;
  links?: { maps: string; streetView: string; earth: string };
  steps: SiteSteps;
}

/** Checks the shape of a stored report before the page shows it. */
export function isSiteReport(value: unknown): value is SiteReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SiteReport>;
  if (v.version !== 1 || typeof v.address !== "string" || typeof v.generatedAt !== "string" || !v.steps) return false;
  return STEP_NAMES.every((n) => {
    const step = (v.steps as Record<string, Partial<Step> | undefined>)[n];
    return !!step && typeof step.status === "string" && Array.isArray(step.sources);
  });
}
