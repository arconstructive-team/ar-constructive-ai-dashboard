/**
 * Google Street View and satellite images. The report keeps only the request parameters and a
 * signed path on our API; the API fetches the image from Google with the server's key each time
 * it is shown. No image is copied or stored.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SourceError, bearing, num, str } from "./http";
import type { LatLng, MapLinks, Satellite, SiteImage, StreetView } from "./types";

export const STREETVIEW_METADATA = "https://maps.googleapis.com/maps/api/streetview/metadata";
export const STREETVIEW_IMAGE = "https://maps.googleapis.com/maps/api/streetview";
export const STATIC_MAP = "https://maps.googleapis.com/maps/api/staticmap";
export const IMAGE_PATH = "/api/site/image";

const IMAGE_SIZE = "640x400";
export const SATELLITE_ZOOMS = [18, 20] as const;

/** The parameters each image kind may carry. Anything else is refused by the image route. */
const ALLOWED: Record<string, string[]> = {
  streetview: ["pano", "heading", "pitch", "fov", "size"],
  satellite: ["center", "zoom", "size"],
};

/** The signing key comes from the API key, so a new API key also retires every old image path. */
function signingKey(apiKey: string): Buffer {
  return createHash("sha256").update(`arconstructive-site-image:${apiKey}`).digest();
}

function canonical(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "sig")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export function signImage(params: Record<string, string>, apiKey: string): string {
  return createHmac("sha256", signingKey(apiKey)).update(canonical(params)).digest("base64url").slice(0, 32);
}

export function imagePath(params: Record<string, string>, apiKey: string): string {
  return `${IMAGE_PATH}?${new URLSearchParams({ ...params, sig: signImage(params, apiKey) })}`;
}

/** Checks a signed image request and gives back the Google URL to fetch, or null when it is not one we issued. */
export function googleImageUrl(query: URLSearchParams, apiKey: string): string | null {
  const params = Object.fromEntries(query.entries());
  const kind = params.kind;
  const allowed = kind ? ALLOWED[kind] : undefined;
  if (!allowed || !params.sig) return null;
  if (Object.keys(params).some((k) => k !== "kind" && k !== "sig" && !allowed.includes(k))) return null;
  const expected = Buffer.from(signImage(params, apiKey));
  const given = Buffer.from(params.sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const google = new URLSearchParams();
  for (const k of allowed) if (params[k] !== undefined) google.set(k, params[k]!);
  if (kind === "satellite") {
    google.set("maptype", "satellite");
    google.set("markers", `color:red|${params.center}`);
    google.set("scale", "2");
  } else {
    google.set("source", "outdoor");
  }
  google.set("key", apiKey);
  return `${kind === "satellite" ? STATIC_MAP : STREETVIEW_IMAGE}?${google}`;
}

export function streetViewMetadataUrl(at: LatLng, apiKey: string): string {
  return `${STREETVIEW_METADATA}?${new URLSearchParams({ location: `${at.lat},${at.lng}`, source: "outdoor", radius: "60", key: apiKey })}`;
}

const SIDE = ["Facing the property", "Right of the property", "Away from the property", "Left of the property"];

/**
 * Reads the Street View metadata answer. Returns null when Google has no Street View near the
 * address. The first image faces the property; the other three turn 90 degrees each.
 */
export function parseStreetViewMetadata(body: unknown, site: LatLng, apiKey: string): StreetView | null {
  const b = (body ?? {}) as { status?: string; pano_id?: string; location?: { lat?: number; lng?: number }; date?: string; copyright?: string; error_message?: string };
  if (b.status === "ZERO_RESULTS" || b.status === "NOT_FOUND") return null;
  if (b.status !== "OK") throw new SourceError(`Street View answered ${b.status ?? "with no status"}${b.error_message ? `: ${b.error_message}` : "."}`);
  const panoId = str(b.pano_id);
  const lat = num(b.location?.lat);
  const lng = num(b.location?.lng);
  if (!panoId || lat === undefined || lng === undefined) throw new SourceError("Street View answered without a panorama.");
  const location = { lat, lng };
  const toSite = bearing(location, site);
  const images: SiteImage[] = SIDE.map((label, i) => {
    const heading = (toSite + i * 90) % 360;
    const params = { kind: "streetview", pano: panoId, heading: String(heading), pitch: "0", fov: "90", size: IMAGE_SIZE };
    return { path: imagePath(params, apiKey), label, heading };
  });
  const view: StreetView = { panoId, location, copyright: str(b.copyright) ?? "© Google", images };
  const date = str(b.date);
  if (date) view.date = date;
  return view;
}

export function satelliteImages(at: LatLng, apiKey: string): Satellite {
  const center = `${at.lat.toFixed(6)},${at.lng.toFixed(6)}`;
  return {
    copyright: "Imagery © Google",
    images: SATELLITE_ZOOMS.map((zoom) => ({
      path: imagePath({ kind: "satellite", center, zoom: String(zoom), size: IMAGE_SIZE }, apiKey),
      label: zoom >= 20 ? "Satellite, close" : "Satellite, neighborhood",
      zoom,
    })),
  };
}

/** Links that open the place in Google Maps, Street View and Google Earth (no key needed). */
export function mapLinks(at: LatLng, placeId?: string, pano?: { panoId: string; heading?: number }): MapLinks {
  const point = `${at.lat.toFixed(6)},${at.lng.toFixed(6)}`;
  const maps = new URLSearchParams({ api: "1", query: point });
  if (placeId) maps.set("query_place_id", placeId);
  const sv = new URLSearchParams({ api: "1", map_action: "pano", viewpoint: point });
  if (pano) {
    sv.set("pano", pano.panoId);
    if (pano.heading !== undefined) sv.set("heading", String(pano.heading));
  }
  return {
    maps: `https://www.google.com/maps/search/?${maps}`,
    streetView: `https://www.google.com/maps/@?${sv}`,
    earth: `https://earth.google.com/web/@${point},120a,250d,35y,0h,45t,0r`,
  };
}
