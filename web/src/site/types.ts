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
  /** Street View only: the panorama the photos come from. */
  panoId?: string;
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

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Geocode extends LatLng {
  formattedAddress: string;
  accuracy: string;
  provider: "google" | "census";
}

export interface RoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaSqft: number;
  sunshineHoursPerYear: number;
}

export interface SolarRoof {
  imageryDate?: string;
  roofAreaSqft: number;
  maxSunshineHoursPerYear: number;
  maxPanels?: number;
  segments: RoofSegment[];
  distanceFeet: number;
}

export interface Parcel {
  apn: string;
  county: string;
  assessorAcres?: number;
  lotAreaSqft?: number;
  useDescription?: string;
  outline: LatLng[];
  matchedBy: "point" | "address";
}

export interface Jurisdiction {
  kind: "city" | "unincorporated";
  name: string;
}

export interface Zoning {
  district?: string;
  description?: string;
  overlay?: string;
  mapUrl?: string;
}

export interface FloodZone {
  zone: string;
  subtype?: string;
  inSpecialFloodHazardArea: boolean;
  baseFloodElevationFeet?: number;
  firmPanelId?: string;
}

export interface FireZone {
  responsibility: "SRA" | "LRA" | "FRA" | "unknown";
  hazardClass: "Very High" | "High" | "Moderate" | null;
  chapter7A: "applies" | "check" | "not indicated";
}

export interface SeismicZones {
  liquefaction: boolean;
  landslide: boolean;
  faultZone: boolean;
}

/** The ground along one line cut through the lot (api/src/site/terrain.ts). */
export interface TerrainSection {
  axis: "west-east" | "south-north";
  lengthFeet: number;
  points: { distanceFeet: number; feet: number }[];
  lot?: { startFeet: number; endFeet: number };
  lowFeet: number;
  highFeet: number;
  slopePercent: number;
  downhill: "west" | "east" | "south" | "north";
}

export interface Elevation {
  feet: number;
  sections?: TerrainSection[];
}

export interface ClimateZone {
  zone: string;
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

/**
 * Steps carry their data as the API wrote it. Reports saved before a field existed lack it, so
 * every view checks the data it reads and falls back to the step's summary line.
 */
export type SiteSteps = Record<StepName, Step> & {
  geocode: Step<Geocode>;
  streetView: Step<ImageSet>;
  satellite: Step<ImageSet>;
  solar: Step<SolarRoof>;
  parcel: Step<Parcel>;
  jurisdiction: Step<Jurisdiction>;
  zoning: Step<Zoning>;
  flood: Step<FloodZone>;
  fire: Step<FireZone>;
  seismic: Step<SeismicZones>;
  elevation: Step<Elevation>;
  climateZone: Step<ClimateZone>;
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
