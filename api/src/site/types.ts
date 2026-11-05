/**
 * The site report: public facts about a project's address, gathered step by step on the server.
 * Every step keeps its own status and source, so one failing source never hides the others.
 * The report is plain JSON (no undefined values, no nested arrays) so Firestore can store it.
 */

/** ok: the source answered. failed: the source could not be read. unknown: it answered, but has no answer here. */
export type StepStatus = "ok" | "failed" | "unknown";

export interface SourceRef {
  /** The agency or dataset, e.g. "FEMA National Flood Hazard Layer". */
  name: string;
  /** The exact request (never with an API key) or the page a person can check. */
  url: string;
  /** ISO time the source was read. */
  fetchedAt: string;
}

export interface Step<T> {
  status: StepStatus;
  /** The steps that read more than one source list them all. */
  sources: SourceRef[];
  data?: T;
  /** Why the step failed, in plain words. */
  error?: string;
  /** A short remark, e.g. why the answer is unknown and where to check by hand. */
  note?: string;
  /** A page where a person can check this fact by hand. */
  checkUrl?: string;
  /** The facts of this step in one plain line (the Site page shows it; the chat tool reads the same words). */
  summary?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Geocode extends LatLng {
  formattedAddress: string;
  placeId?: string;
  /** Google: ROOFTOP, RANGE_INTERPOLATED ...; Census: "street interpolation". */
  accuracy: string;
  streetNumber?: string;
  street?: string;
  city?: string;
  /** e.g. "Contra Costa County". */
  county?: string;
  state?: string;
  zip?: string;
  provider: "google" | "census";
}

export interface SiteImage {
  /** Path on the site API that forwards the Google image; signed, never stored as a copy. */
  path: string;
  /** What the camera faces, in plain words. */
  label: string;
  heading?: number;
  zoom?: number;
}

export interface StreetView {
  panoId: string;
  location: LatLng;
  /** Month of capture, e.g. "2023-05". */
  date?: string;
  copyright: string;
  images: SiteImage[];
}

export interface Satellite {
  copyright: string;
  images: SiteImage[];
}

export interface RoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaSqft: number;
  /** Median sunshine hours per year on this segment. */
  sunshineHoursPerYear: number;
}

export interface SolarRoof {
  imageryDate?: string;
  imageryQuality?: string;
  roofAreaSqft: number;
  maxSunshineHoursPerYear: number;
  maxPanels?: number;
  segments: RoofSegment[];
  /** Distance from the address point to the building Google picked. */
  distanceFeet: number;
}

export interface Parcel {
  apn: string;
  county: string;
  situsAddress?: string;
  situsCity?: string;
  /** Acreage on the assessor roll. */
  assessorAcres?: number;
  /** Area computed from the parcel outline. */
  lotAreaSqft?: number;
  useCode?: string;
  useDescription?: string;
  /** Outer ring of the parcel outline. */
  outline: LatLng[];
  /** How the parcel was found: "point" (the address point lies in it) or "address" (matched by address). */
  matchedBy: "point" | "address";
}

export interface Jurisdiction {
  kind: "city" | "unincorporated";
  /** e.g. "Town of Danville" or "Unincorporated Contra Costa County". */
  name: string;
  county?: string;
}

export interface Zoning {
  district?: string;
  description?: string;
  overlay?: string;
  /** The jurisdiction's zoning map, for a check by hand. */
  mapUrl?: string;
}

export interface FloodZone {
  zone: string;
  subtype?: string;
  /** Special Flood Hazard Area (the 1% annual chance floodplain). */
  inSpecialFloodHazardArea: boolean;
  baseFloodElevationFeet?: number;
  firmPanelId?: string;
}

export type FireHazardClass = "Very High" | "High" | "Moderate";

export interface FireZone {
  /** Who is responsible for fire protection: SRA (state), LRA (local) or FRA (federal). */
  responsibility: "SRA" | "LRA" | "FRA" | "unknown";
  /** The Fire Hazard Severity Zone class, or null when the point is in no zone. */
  hazardClass: FireHazardClass | null;
  /** Whether CBC Chapter 7A (wildland-urban interface building rules) applies, as the state maps show it. */
  chapter7A: "applies" | "check" | "not indicated";
}

export interface SeismicZones {
  liquefaction: boolean;
  landslide: boolean;
  /** Alquist-Priolo Earthquake Fault Zone. */
  faultZone: boolean;
}

/** The ground along one line cut through the lot, like a site section. */
export interface TerrainSection {
  axis: "west-east" | "south-north";
  lengthFeet: number;
  /** Ground height (ft above sea level) every few feet from the line's west or south end. */
  points: { distanceFeet: number; feet: number }[];
  /** Where the line crosses the lot lines (feet from its start); missing without a parcel outline. */
  lot?: { startFeet: number; endFeet: number };
  lowFeet: number;
  highFeet: number;
  /** Average slope across the lot (or the whole line without one), percent. */
  slopePercent: number;
  /** The direction the ground falls along this line. */
  downhill: "west" | "east" | "south" | "north";
}

export interface Elevation {
  feet: number;
  /** West–east and south–north sections through the lot (Google Elevation API; needs the key). */
  sections?: TerrainSection[];
}

export interface ClimateZone {
  /** California Energy Code building climate zone, "1" to "16". */
  zone: string;
}

export interface MapLinks {
  maps: string;
  streetView: string;
  earth: string;
}

export interface SiteSteps {
  geocode: Step<Geocode>;
  streetView: Step<StreetView>;
  satellite: Step<Satellite>;
  solar: Step<SolarRoof>;
  parcel: Step<Parcel>;
  jurisdiction: Step<Jurisdiction>;
  zoning: Step<Zoning>;
  flood: Step<FloodZone>;
  fire: Step<FireZone>;
  seismic: Step<SeismicZones>;
  elevation: Step<Elevation>;
  climateZone: Step<ClimateZone>;
}

export type StepName = keyof SiteSteps;

export const STEP_NAMES: StepName[] = [
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
];

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

export interface SiteReport {
  version: 1;
  /** The address as the project has it. */
  address: string;
  generatedAt: string;
  links?: MapLinks;
  steps: SiteSteps;
}
