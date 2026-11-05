import type { LatLng } from "./types";

/** Feet per degree of latitude; a degree of longitude is this times cos(latitude). Same as the API. */
const FEET_PER_DEGREE = 364_610;

export interface XY {
  x: number;
  y: number;
}

/** A flat plane in feet around a point: x east, y north. Exact enough across one lot. */
export function toFeet(origin: LatLng) {
  const fx = FEET_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  return (p: LatLng): XY => ({ x: (p.lng - origin.lng) * fx, y: (p.lat - origin.lat) * FEET_PER_DEGREE });
}

export function bounds(points: XY[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A round step (1, 2 or 5 times a power of ten) for scale bars and axis ticks. */
export function niceStep(span: number, ticks = 4): number {
  const raw = span / Math.max(1, ticks);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

/** Area of a ring in square feet (shoelace). */
export function areaSqft(points: XY[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** "SE" for 127°. */
export function compassPoint(azimuth: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8]!;
}

const NAMES: Record<(typeof COMPASS)[number], string> = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
};

export const compassName = (azimuth: number) => NAMES[compassPoint(azimuth)];

/** Roof pitch as rise in 12 (the way architects write it): 18.4° → "4:12". */
export function pitchIn12(degrees: number): string {
  const rise = Math.tan((degrees * Math.PI) / 180) * 12;
  return `${Math.round(rise * 2) / 2}:12`;
}

export const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
