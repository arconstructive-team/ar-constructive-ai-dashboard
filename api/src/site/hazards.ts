/**
 * Public hazard and climate layers, each read with one point query:
 * FEMA flood zone, CAL FIRE hazard zone and responsibility area, CGS earthquake zones,
 * USGS elevation and the California Energy Commission building climate zone.
 */
import { SourceError, arcgisFeatures, arcgisPointQuery, num, round, str } from "./http";
import type { ClimateZone, Elevation, FireHazardClass, FireZone, FloodZone, LatLng, SeismicZones } from "./types";

export const FEMA_NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";
export const FEMA_CHECK = "https://msc.fema.gov/portal/search";

export function floodUrl(at: LatLng): string {
  return arcgisPointQuery(FEMA_NFHL, at, ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "DFIRM_ID"]);
}

/** Reads the FEMA flood hazard answer. Null when no flood map covers the point. */
export function parseFlood(body: unknown): FloodZone | null {
  const a = arcgisFeatures(body)[0]?.attributes;
  const zone = str(a?.FLD_ZONE);
  if (!a || !zone) return null;
  const flood: FloodZone = { zone, inSpecialFloodHazardArea: str(a.SFHA_TF) === "T" };
  const subtype = str(a.ZONE_SUBTY);
  if (subtype) flood.subtype = subtype;
  const bfe = num(a.STATIC_BFE);
  if (bfe !== undefined && bfe > -9000) flood.baseFloodElevationFeet = bfe;
  const panel = str(a.DFIRM_ID);
  if (panel) flood.firmPanelId = panel;
  return flood;
}

/** CAL FIRE Fire Hazard Severity Zones in State and Local Responsibility Areas (2024-2025 maps). */
export const CALFIRE_FHSZ = "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/fhsz24_5/FeatureServer/0";
export const CALFIRE_SRA = "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/State_Responsibility_Area/FeatureServer/0";
export const CALFIRE_CHECK = "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones";

export const fireZoneUrl = (at: LatLng) => arcgisPointQuery(CALFIRE_FHSZ, at, ["FHSZ", "FHSZ_Description", "SRA22_2"]);
export const responsibilityUrl = (at: LatLng) => arcgisPointQuery(CALFIRE_SRA, at, ["SRA"]);

const CLASS_BY_NUMBER: Record<number, FireHazardClass> = { 1: "Moderate", 2: "High", 3: "Very High" };

function hazardClass(a: Record<string, unknown>): FireHazardClass | null {
  const text = (str(a.FHSZ_Description) ?? "").toLowerCase();
  if (text.includes("very high")) return "Very High";
  if (text.includes("high")) return "High";
  if (text.includes("moderate")) return "Moderate";
  const n = num(a.FHSZ) ?? Number(str(a.FHSZ));
  return CLASS_BY_NUMBER[n] ?? null;
}

/**
 * Combines the hazard zone and the responsibility area. CBC Chapter 7A applies in any zone in
 * an SRA and in Very High zones in an LRA; other LRA zones depend on the local adoption.
 */
export function parseFire(zoneBody: unknown, sraBody: unknown): FireZone {
  const zone = arcgisFeatures(zoneBody)[0]?.attributes;
  const sra = str(arcgisFeatures(sraBody)[0]?.attributes.SRA) ?? (zone ? str(zone.SRA22_2) : undefined);
  const responsibility: FireZone["responsibility"] = sra === "SRA" || sra === "LRA" || sra === "FRA" ? sra : "unknown";
  const cls = zone ? hazardClass(zone) : null;
  let chapter7A: FireZone["chapter7A"] = "not indicated";
  if (cls && (responsibility === "SRA" || cls === "Very High")) chapter7A = "applies";
  else if (cls) chapter7A = "check";
  return { responsibility, hazardClass: cls, chapter7A };
}

/** California Geological Survey Seismic Hazards Program layers (Department of Conservation). */
export const CGS_LIQUEFACTION = "https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/CGS_Liquefaction_Zones/FeatureServer/0";
export const CGS_LANDSLIDE = "https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/CGS_Landslide_Zones/FeatureServer/0";
export const CGS_FAULT = "https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/CGS_Alquist_Priolo_Fault_Zones/FeatureServer/0";
export const CGS_CHECK = "https://maps.conservation.ca.gov/cgs/EQZApp/app/";

export const seismicUrls = (at: LatLng) => ({
  liquefaction: arcgisPointQuery(CGS_LIQUEFACTION, at, ["OBJECTID"]),
  landslide: arcgisPointQuery(CGS_LANDSLIDE, at, ["OBJECTID"]),
  faultZone: arcgisPointQuery(CGS_FAULT, at, ["OBJECTID"]),
});

/** A point is in a zone when any zone polygon covers it. */
export function parseSeismic(bodies: { liquefaction: unknown; landslide: unknown; faultZone: unknown }): SeismicZones {
  return {
    liquefaction: arcgisFeatures(bodies.liquefaction).length > 0,
    landslide: arcgisFeatures(bodies.landslide).length > 0,
    faultZone: arcgisFeatures(bodies.faultZone).length > 0,
  };
}

export const USGS_EPQS = "https://epqs.nationalmap.gov/v1/json";

export function elevationUrl(at: LatLng): string {
  return `${USGS_EPQS}?${new URLSearchParams({ x: String(at.lng), y: String(at.lat), units: "Feet", wkid: "4326", includeDate: "false" })}`;
}

export function parseElevation(body: unknown): Elevation {
  const raw = (body as { value?: unknown } | null)?.value;
  const value = typeof raw === "string" ? Number(raw) : num(raw);
  if (value === undefined || !Number.isFinite(value) || value < -1000) throw new SourceError("USGS has no elevation for this point.");
  return { feet: round(value, 1) };
}

export const CEC_CLIMATE_ZONES = "https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/BuildingClimateZones_CEC_2015/FeatureServer/0";
export const CEC_CHECK = "https://www.energy.ca.gov/programs-and-topics/programs/building-energy-efficiency-standards/climate-zone-tool-maps-and";

export const climateZoneUrl = (at: LatLng) => arcgisPointQuery(CEC_CLIMATE_ZONES, at, ["BZone"]);

/** Reads the building climate zone. Null when the point is outside California. */
export function parseClimateZone(body: unknown): ClimateZone | null {
  const a = arcgisFeatures(body)[0]?.attributes;
  const raw = a?.BZone;
  const zone = typeof raw === "number" ? String(raw) : str(raw);
  return zone ? { zone: String(Number(zone)) } : null;
}
