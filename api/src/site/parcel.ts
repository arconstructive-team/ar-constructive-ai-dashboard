/**
 * Parcels come from each county's assessor map service. To add a county, add one entry to
 * PARCEL_SOURCES: its layer URL, the field names it uses, and a page where a person can look
 * the parcel up by hand.
 */
import { SQFT_PER_M2, arcgisFeatures, arcgisPointQuery, num, ringAreaM2, round, str, type ArcgisFeature } from "./http";
import type { Geocode, LatLng, Parcel } from "./types";

export interface ParcelSource {
  /** Matches the geocoder's county name, e.g. "Contra Costa County". */
  county: string;
  name: string;
  layerUrl: string;
  fields: {
    apn: string;
    apnDisplay?: string;
    situsAddress?: string;
    situsCity?: string;
    acres?: string;
    useCode?: string;
    useDescription?: string;
  };
  /** The field that holds "<number> <street name>" for an address match, and how it is written. */
  addressSearch?: { field: string; format: (streetNumber: string, streetName: string) => string };
  /** Where a person can look up the parcel by hand. */
  viewerUrl: string;
}

export const PARCEL_SOURCES: ParcelSource[] = [
  {
    county: "Contra Costa County",
    name: "Contra Costa County Assessor parcels (CCMAP)",
    layerUrl: "https://gis.cccounty.us/arcgis/rest/services/CCMAP/Assessment_Parcels_ArcPro/MapServer/0",
    fields: {
      apn: "APN",
      apnDisplay: "parcel_dashes",
      situsAddress: "full_address_display",
      situsCity: "s_city",
      acres: "ACREAGE",
      useCode: "USE_CODE",
      useDescription: "Description",
    },
    addressSearch: { field: "full_address_search", format: (n, s) => `${n} ${s}` },
    viewerUrl: "https://www.contracosta.ca.gov/552/Maps-Property-Information",
  },
];

export function parcelSourceFor(county: string | undefined): ParcelSource | undefined {
  if (!county) return undefined;
  const want = county.toLowerCase().replace(/\s+county$/, "");
  return PARCEL_SOURCES.find((s) => s.county.toLowerCase().replace(/\s+county$/, "") === want);
}

const STREET_SUFFIXES = new Set([
  "RD", "ROAD", "ST", "STREET", "AVE", "AV", "AVENUE", "DR", "DRIVE", "CT", "COURT", "LN", "LANE", "WAY", "PL", "PLACE",
  "BLVD", "BOULEVARD", "CIR", "CIRCLE", "TER", "TERRACE", "PKWY", "PARKWAY", "HWY", "HIGHWAY", "LOOP", "TRL", "TRAIL",
]);

/** "El Rio Rd" becomes "EL RIO": assessor rolls often leave out the suffix. */
export function streetName(street: string): string {
  const words = street.toUpperCase().replace(/[.,']/g, "").split(/\s+/).filter(Boolean);
  if (words.length > 1 && STREET_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

const outFields = (s: ParcelSource) => Object.values(s.fields).filter((f): f is string => Boolean(f));

export function parcelPointUrl(s: ParcelSource, at: LatLng): string {
  return arcgisPointQuery(s.layerUrl, at, outFields(s), { returnGeometry: "true", outSR: "4326" });
}

/** A query by address, for when the address point falls in the street rather than on the lot. */
export function parcelAddressUrl(s: ParcelSource, geo: Pick<Geocode, "streetNumber" | "street">): string | null {
  if (!s.addressSearch || !geo.streetNumber || !geo.street) return null;
  const value = s.addressSearch.format(geo.streetNumber, streetName(geo.street)).replace(/'/g, "''");
  const params = new URLSearchParams({
    where: `${s.addressSearch.field} LIKE '${value}%'`,
    outFields: outFields(s).join(","),
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  return `${s.layerUrl}/query?${params}`;
}

/** Reads the first parcel of an ArcGIS answer, or null when there is none. */
export function parseParcel(body: unknown, s: ParcelSource, matchedBy: Parcel["matchedBy"]): Parcel | null {
  const feature: ArcgisFeature | undefined = arcgisFeatures(body)[0];
  if (!feature) return null;
  const a = feature.attributes;
  const f = s.fields;
  const pick = (name?: string) => (name ? a[name] : undefined);
  const apn = str(pick(f.apnDisplay)) ?? str(pick(f.apn)) ?? (typeof pick(f.apn) === "number" ? String(pick(f.apn)) : undefined);
  if (!apn) return null;
  const ring = feature.geometry?.rings?.[0] ?? [];
  const outline = ring
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map(([lng, lat]) => ({ lat: round(lat!, 6), lng: round(lng!, 6) }));
  const parcel: Parcel = { apn, county: s.county, outline, matchedBy };
  const set = <K extends keyof Parcel>(key: K, value: Parcel[K] | undefined) => {
    if (value !== undefined) parcel[key] = value;
  };
  set("situsAddress", str(pick(f.situsAddress)));
  set("situsCity", str(pick(f.situsCity)));
  set("assessorAcres", num(pick(f.acres)));
  const code = pick(f.useCode);
  set("useCode", typeof code === "number" ? String(code) : str(code));
  set("useDescription", str(pick(f.useDescription)));
  if (outline.length >= 3) set("lotAreaSqft", round(ringAreaM2(outline) * SQFT_PER_M2));
  return parcel;
}
