// Terrain sections: the ground profile along two lines cut through the lot (west–east and
// south–north), like the site sections on a drawing set. Read from the Google Elevation API
// (one "path" request per line), so they need the server's Google key.
import { SourceError, num, round } from "./http";
import type { LatLng, TerrainSection } from "./types";

export const GOOGLE_ELEVATION_PATH = "https://maps.googleapis.com/maps/api/elevation/json";

/** Feet per degree of latitude (WGS84, mean). A degree of longitude is this times cos(latitude). */
const FEET_PER_DEGREE = 364_610;
const FEET_PER_METER = 3.28084;
/** Samples along each line: about every 5–10 ft on a typical lot. */
export const SECTION_SAMPLES = 41;
/** Without a parcel outline, each line runs this far on both sides of the address point. */
const DEFAULT_HALF_FEET = 150;
/** The line reaches this share of the lot's width past each lot line, so the neighbours' grade shows. */
const MARGIN = 0.3;
const MIN_HALF_FEET = 80;

export type Axis = TerrainSection["axis"];

interface Plane {
  toXY(p: LatLng): { x: number; y: number };
  toLatLng(x: number, y: number): LatLng;
}

/** A flat x (east) / y (north) plane in feet around a point; exact enough across one lot. */
function plane(origin: LatLng): Plane {
  const fx = FEET_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toXY: (p) => ({ x: (p.lng - origin.lng) * fx, y: (p.lat - origin.lat) * FEET_PER_DEGREE }),
    toLatLng: (x, y) => ({ lat: origin.lat + y / FEET_PER_DEGREE, lng: origin.lng + x / fx }),
  };
}

export interface SectionLine {
  axis: Axis;
  from: LatLng;
  to: LatLng;
  lengthFeet: number;
  /** Where the line crosses the lot lines, in feet from its start. */
  lot?: { startFeet: number; endFeet: number };
}

/** The two section lines through the lot (or through the address point when there is no outline). */
export function sectionLines(at: LatLng, outline?: LatLng[]): SectionLine[] {
  const ring = outline && outline.length >= 3 ? outline : undefined;
  const p = plane(at);
  const pts = ring?.map((q) => p.toXY(q));
  // The lot's middle (the box centre) keeps the cut inside odd-shaped lots better than the address point.
  const cx = pts ? (Math.min(...pts.map((q) => q.x)) + Math.max(...pts.map((q) => q.x))) / 2 : 0;
  const cy = pts ? (Math.min(...pts.map((q) => q.y)) + Math.max(...pts.map((q) => q.y))) / 2 : 0;

  return (["west-east", "south-north"] as const).map((axis) => {
    const along = (q: { x: number; y: number }) => (axis === "west-east" ? q.x - cx : q.y - cy);
    let half = DEFAULT_HALF_FEET;
    if (pts) {
      const span = Math.max(...pts.map(along)) - Math.min(...pts.map(along));
      half = Math.max(MIN_HALF_FEET, Math.max(...pts.map((q) => Math.abs(along(q)))) + span * MARGIN);
    }
    const [x0, y0, x1, y1] = axis === "west-east" ? [cx - half, cy, cx + half, cy] : [cx, cy - half, cx, cy + half];
    const line: SectionLine = { axis, from: p.toLatLng(x0, y0), to: p.toLatLng(x1, y1), lengthFeet: round(2 * half, 1) };
    if (pts) {
      const ts = crossings({ x: x0, y: y0 }, { x: x1, y: y1 }, pts);
      if (ts.length >= 2) line.lot = { startFeet: round(Math.min(...ts) * 2 * half, 1), endFeet: round(Math.max(...ts) * 2 * half, 1) };
    }
    return line;
  });
}

/** Where segment a→b crosses the polygon's edges, as fractions 0..1 of a→b. */
function crossings(a: { x: number; y: number }, b: { x: number; y: number }, poly: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(t);
  }
  return out;
}

export function sectionUrl(line: SectionLine, apiKey: string, samples = SECTION_SAMPLES): string {
  const ll = (q: LatLng) => `${q.lat.toFixed(7)},${q.lng.toFixed(7)}`;
  return `${GOOGLE_ELEVATION_PATH}?${new URLSearchParams({ path: `${ll(line.from)}|${ll(line.to)}`, samples: String(samples), key: apiKey })}`;
}

/** Ground height (ft) at a distance along the section, read between the two nearest samples. */
function heightAt(points: TerrainSection["points"], d: number): number {
  const i = points.findIndex((q) => q.distanceFeet >= d);
  if (i <= 0) return points[i === 0 ? 0 : points.length - 1]!.feet;
  const a = points[i - 1]!;
  const b = points[i]!;
  return a.feet + ((b.feet - a.feet) * (d - a.distanceFeet)) / (b.distanceFeet - a.distanceFeet);
}

const DOWNHILL: Record<Axis, [TerrainSection["downhill"], TerrainSection["downhill"]]> ={ "west-east": ["west", "east"], "south-north": ["south", "north"] };

/** Reads a Google Elevation "path" answer for one section line. */
export function parseSection(body: unknown, line: SectionLine): TerrainSection {
  const b = (body ?? {}) as { status?: string; error_message?: string; results?: { elevation?: unknown }[] };
  if (b.status !== "OK" || !Array.isArray(b.results) || b.results.length < 2) {
    throw new SourceError(`Google Elevation answered ${b.status ?? "with no status"}${b.error_message ? `: ${b.error_message}` : "."}`);
  }
  const n = b.results.length;
  const points = b.results.map((r, i) => {
    const meters = num(r.elevation);
    if (meters === undefined) throw new SourceError("Google Elevation answered a point without a height.");
    return { distanceFeet: round((line.lengthFeet * i) / (n - 1), 1), feet: round(meters * FEET_PER_METER, 1) };
  });
  const start = line.lot?.startFeet ?? 0;
  const end = line.lot?.endFeet ?? line.lengthFeet;
  const rise = heightAt(points, end) - heightAt(points, start);
  const run = end - start;
  const heights = points.map((q) => q.feet);
  const section: TerrainSection = {
    axis: line.axis,
    lengthFeet: line.lengthFeet,
    points,
    lowFeet: Math.min(...heights),
    highFeet: Math.max(...heights),
    slopePercent: run > 0 ? round(Math.abs((rise / run) * 100), 1) : 0,
    downhill: rise > 0 ? DOWNHILL[line.axis][0] : DOWNHILL[line.axis][1],
  };
  if (line.lot) section.lot = line.lot;
  return section;
}
