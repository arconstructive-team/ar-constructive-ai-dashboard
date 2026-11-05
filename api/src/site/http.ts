import type { LatLng, SourceRef } from "./types";

export type Fetch = typeof fetch;

export interface HttpOptions {
  fetch: Fetch;
  /** Per request. Default 12 s. */
  timeoutMs?: number;
  /**
   * Extra tries after a failure that came back fast: the source could not be reached, or it
   * answered HTTP 5xx. A timeout is not tried again, so a slow source costs one timeout at most.
   * Default 0.
   */
  retries?: number;
  /** Wait before each extra try. Default 500 ms. */
  retryDelayMs?: number;
}

/** A source that could not be read. The message is plain words for the Site page. */
export class SourceError extends Error {}

class RetryableError extends SourceError {}

/** Reads one JSON answer. 404 resolves with null so a source can say "no data here". */
export async function getJson(url: string, http: HttpOptions): Promise<unknown | null> {
  const tries = 1 + Math.max(0, Math.floor(http.retries ?? 0));
  for (let attempt = 1; ; attempt++) {
    try {
      return await getJsonOnce(url, http);
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt >= tries) {
        throw err instanceof RetryableError ? new SourceError(err.message) : err;
      }
      await new Promise((resolve) => setTimeout(resolve, http.retryDelayMs ?? 500));
    }
  }
}

async function getJsonOnce(url: string, http: HttpOptions): Promise<unknown | null> {
  let res: Response;
  try {
    res = await http.fetch(url, { signal: AbortSignal.timeout(http.timeoutMs ?? 12_000), headers: { accept: "application/json" } });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (timedOut) throw new SourceError("The source did not answer in time.");
    throw new RetryableError("The source could not be reached.");
  }
  if (res.status === 404) return null;
  if (res.status >= 500) throw new RetryableError(`The source answered with HTTP ${res.status}.`);
  if (!res.ok) throw new SourceError(`The source answered with HTTP ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new SourceError("The source answered with something that is not JSON.");
  }
}

/** The same URL with its key parameter taken out, safe to store and show. */
export function withoutKey(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("key");
  return u.toString();
}

export function sourceRef(name: string, url: string, now: () => Date): SourceRef {
  return { name, url: withoutKey(url), fetchedAt: now().toISOString() };
}

export type Attributes = Record<string, unknown>;

export interface ArcgisFeature {
  attributes: Attributes;
  geometry?: { rings?: number[][][] };
}

/** An ArcGIS REST query that finds the features under one point (WGS 84). */
export function arcgisPointQuery(layerUrl: string, at: LatLng, outFields: string[], extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    geometry: `${at.lng},${at.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: outFields.join(","),
    returnGeometry: "false",
    f: "json",
    ...extra,
  });
  return `${layerUrl}/query?${params}`;
}

/** Reads the features of an ArcGIS query answer. ArcGIS reports errors inside a 200 answer. */
export function arcgisFeatures(body: unknown): ArcgisFeature[] {
  if (body === null || typeof body !== "object") throw new SourceError("The map service answered with no data.");
  const b = body as { error?: { message?: string }; features?: unknown };
  if (b.error) throw new SourceError(`The map service refused the query${b.error.message ? `: ${b.error.message}` : "."}`);
  if (!Array.isArray(b.features)) throw new SourceError("The map service answered without a feature list.");
  return b.features.filter(
    (f): f is ArcgisFeature => typeof f === "object" && f !== null && typeof (f as ArcgisFeature).attributes === "object",
  );
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const round = (v: number, digits = 0) => Math.round(v * 10 ** digits) / 10 ** digits;

export const SQFT_PER_M2 = 10.7639;
export const FEET_PER_M = 3.28084;

/** Distance between two points, in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const r = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Compass bearing from one point to another, 0 to 359 degrees. */
export function bearing(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  return (Math.round(Math.atan2(y, x) / rad) + 360) % 360;
}

/** Area of a ring of points, in square meters (small-area equirectangular projection). */
export function ringAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const rad = Math.PI / 180;
  const lat0 = (ring.reduce((s, p) => s + p.lat, 0) / ring.length) * rad;
  const r = 6_371_008.8;
  const xy = ring.map((p) => ({ x: p.lng * rad * r * Math.cos(lat0), y: p.lat * rad * r }));
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!;
    const b = xy[(i + 1) % xy.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
