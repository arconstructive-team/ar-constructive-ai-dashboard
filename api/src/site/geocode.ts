import { SourceError, num, str } from "./http";
import type { Geocode } from "./types";

export const GOOGLE_GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";
export const CENSUS_GEOCODE = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

export function googleGeocodeUrl(address: string, apiKey: string): string {
  return `${GOOGLE_GEOCODE}?${new URLSearchParams({ address, region: "us", key: apiKey })}`;
}

interface GoogleComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

/** Reads a Google Geocoding answer. Throws when Google found no place. */
export function parseGoogleGeocode(body: unknown): Geocode {
  const b = (body ?? {}) as { status?: string; error_message?: string; results?: unknown[] };
  if (b.status === "ZERO_RESULTS") throw new SourceError("Google found no place for this address.");
  if (b.status !== "OK" || !Array.isArray(b.results) || b.results.length === 0) {
    throw new SourceError(`Google Geocoding answered ${b.status ?? "with no status"}${b.error_message ? `: ${b.error_message}` : "."}`);
  }
  const r = b.results[0] as {
    formatted_address?: string;
    place_id?: string;
    geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
    address_components?: GoogleComponent[];
  };
  const lat = num(r.geometry?.location?.lat);
  const lng = num(r.geometry?.location?.lng);
  if (lat === undefined || lng === undefined) throw new SourceError("Google Geocoding answered without a location.");
  const part = (type: string, short = false) => {
    const c = (r.address_components ?? []).find((x) => x.types?.includes(type));
    return str(short ? c?.short_name : c?.long_name);
  };
  return clean({
    lat,
    lng,
    formattedAddress: str(r.formatted_address) ?? "",
    placeId: str(r.place_id),
    accuracy: str(r.geometry?.location_type) ?? "unknown",
    streetNumber: part("street_number"),
    street: part("route", true),
    city: part("locality") ?? part("sublocality"),
    county: part("administrative_area_level_2"),
    state: part("administrative_area_level_1", true),
    zip: part("postal_code"),
    provider: "google",
  });
}

export function censusGeocodeUrl(address: string): string {
  return `${CENSUS_GEOCODE}?${new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "Counties",
    format: "json",
  })}`;
}

interface CensusMatch {
  matchedAddress?: string;
  coordinates?: { x?: number; y?: number };
  addressComponents?: Record<string, unknown>;
  geographies?: { Counties?: { NAME?: string }[] };
}

const norm = (s: string | undefined) => s?.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() || undefined;

/**
 * The city and ZIP the architect typed ("street, city, state zip"). Either may be missing: then
 * it is not checked.
 */
export function addressPlace(address: string): { city?: string; zip?: string } {
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts.length >= 3 ? norm(parts[parts.length - 2]) : undefined;
  return { city, zip };
}

/**
 * True when a Census match is in the place the architect asked for. The Census geocoder's fuzzy
 * matching can answer with the same street number in another city ("456 Oak Ave, San Ramon" →
 * "456 OAK ST, RAMONA"), so a match counts only when its ZIP or its city agrees with the address.
 * The postal city can differ from the city the architect wrote, so one of the two is enough.
 */
function samePlace(m: CensusMatch, want: { city?: string; zip?: string }): boolean {
  if (!want.city && !want.zip) return true;
  const c = m.addressComponents ?? {};
  const zip = str(c.zip);
  const city = norm(str(c.city));
  return (want.zip !== undefined && zip === want.zip) || (want.city !== undefined && city === want.city);
}

/**
 * Reads a US Census Geocoder answer (the backup when Google is not available). With the address
 * that was asked for, it takes the first match in that city or ZIP, and throws when every match
 * is somewhere else.
 */
export function parseCensusGeocode(body: unknown, address?: string): Geocode {
  const matches = (body as { result?: { addressMatches?: unknown[] } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) throw new SourceError("The Census geocoder found no match for this address.");
  const want = address ? addressPlace(address) : {};
  const m = (matches as CensusMatch[]).find((x) => samePlace(x, want));
  if (!m) {
    const got = str((matches[0] as CensusMatch).matchedAddress) ?? "another place";
    throw new SourceError(`The Census geocoder found no match in this city or ZIP; its closest match was ${got}.`);
  }
  const lng = num(m.coordinates?.x);
  const lat = num(m.coordinates?.y);
  if (lat === undefined || lng === undefined) throw new SourceError("The Census geocoder answered without a location.");
  const c = m.addressComponents ?? {};
  const formatted = str(m.matchedAddress) ?? "";
  const street = [c.preDirection, c.preType, c.streetName, c.suffixType, c.suffixDirection].map(str).filter(Boolean).join(" ");
  return clean({
    lat,
    lng,
    formattedAddress: formatted,
    accuracy: "street interpolation",
    streetNumber: formatted.match(/^(\d+[A-Z]?)\s/i)?.[1],
    street: street || undefined,
    city: str(c.city),
    county: str(m.geographies?.Counties?.[0]?.NAME),
    state: str(c.state),
    zip: str(c.zip),
    provider: "census",
  });
}

/** Drops undefined fields: Firestore refuses them. */
export function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
