/**
 * Jurisdiction: the incorporated city or town (US Census TIGERweb), else the unincorporated county.
 * Zoning: a county zoning layer for unincorporated land; for cities without a public zoning
 * service, "unknown" with a link to the city's zoning map. Add cities and counties to the tables.
 */
import { arcgisFeatures, arcgisPointQuery, str } from "./http";
import type { Jurisdiction, LatLng, Zoning } from "./types";

export const TIGER_PLACES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4";

export function placeUrl(at: LatLng): string {
  return arcgisPointQuery(TIGER_PLACES, at, ["NAME", "BASENAME", "LSADC", "GEOID"]);
}

/** TIGER legal/statistical area codes for California places. */
const PLACE_KIND: Record<string, string> = { "25": "City", "43": "Town" };

export function parseJurisdiction(body: unknown, county: string | undefined): Jurisdiction {
  const place = arcgisFeatures(body)[0]?.attributes;
  const base = str(place?.BASENAME);
  if (place && base) {
    const kind = PLACE_KIND[String(place.LSADC ?? "")] ?? "City";
    return county ? { kind: "city", name: `${kind} of ${base}`, county } : { kind: "city", name: `${kind} of ${base}` };
  }
  const name = county ? `Unincorporated ${county}` : "Unincorporated county";
  return county ? { kind: "unincorporated", name, county } : { kind: "unincorporated", name };
}

export interface CountyZoningSource {
  county: string;
  name: string;
  layerUrl: string;
  fields: { district: string; description?: string; overlay?: string };
  mapUrl: string;
}

export const COUNTY_ZONING: CountyZoningSource[] = [
  {
    county: "Contra Costa County",
    name: "Contra Costa County Department of Conservation and Development zoning",
    layerUrl: "https://services.arcgis.com/jDGuO8tYggdCCnUJ/ArcGIS/rest/services/ContraCostaCountyPlanningLayers/FeatureServer/1",
    fields: { district: "ZONING", description: "ZONING_TEX", overlay: "OVERLAY_TE" },
    mapUrl: "https://www.contracosta.ca.gov/552/Maps-Property-Information",
  },
];

/** Zoning maps of incorporated cities and towns, keyed by the jurisdiction name. */
export const CITY_ZONING_MAPS: Record<string, string> = {
  "Town of Danville": "https://danville.ca.gov/540/Zoning-Ordinance-Map",
};

/** Where to look when a city has no entry above: the county property map service. */
export const COUNTY_PROPERTY_MAPS: Record<string, string> = {
  "Contra Costa County": "https://www.contracosta.ca.gov/552/Maps-Property-Information",
};

export function countyZoningFor(county: string | undefined): CountyZoningSource | undefined {
  return county ? COUNTY_ZONING.find((z) => z.county.toLowerCase() === county.toLowerCase()) : undefined;
}

export function zoningUrl(src: CountyZoningSource, at: LatLng): string {
  return arcgisPointQuery(src.layerUrl, at, Object.values(src.fields).filter((f): f is string => Boolean(f)));
}

/** Reads a county zoning answer. Null when no zoning polygon covers the point. */
export function parseCountyZoning(body: unknown, src: CountyZoningSource): Zoning | null {
  const a = arcgisFeatures(body)[0]?.attributes;
  const district = str(a?.[src.fields.district]);
  if (!a || !district) return null;
  const zoning: Zoning = { district, mapUrl: src.mapUrl };
  const description = src.fields.description ? str(a[src.fields.description]) : undefined;
  const overlay = src.fields.overlay ? str(a[src.fields.overlay]) : undefined;
  if (description) zoning.description = description;
  if (overlay) zoning.overlay = overlay;
  return zoning;
}
