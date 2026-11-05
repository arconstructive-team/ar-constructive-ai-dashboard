import { FEET_PER_M, SQFT_PER_M2, SourceError, distanceMeters, num, round, str } from "./http";
import type { LatLng, RoofSegment, SolarRoof } from "./types";

export const SOLAR_BUILDING = "https://solar.googleapis.com/v1/buildingInsights:findClosest";

export function solarUrl(at: LatLng, apiKey: string): string {
  return `${SOLAR_BUILDING}?${new URLSearchParams({
    "location.latitude": at.lat.toFixed(6),
    "location.longitude": at.lng.toFixed(6),
    requiredQuality: "LOW",
    key: apiKey,
  })}`;
}

interface Stats {
  areaMeters2?: number;
  sunshineQuantiles?: number[];
}

/** The median of Google's 11 sunshine quantiles. */
const median = (q?: number[]) => (Array.isArray(q) && q.length > 0 ? num(q[Math.floor(q.length / 2)]) ?? 0 : 0);

/** Reads a Solar API buildingInsights answer. Returns null when Google has no building data (404). */
export function parseSolar(body: unknown, site: LatLng): SolarRoof | null {
  if (body === null) return null;
  const b = body as {
    error?: { message?: string };
    center?: { latitude?: number; longitude?: number };
    imageryDate?: { year?: number; month?: number; day?: number };
    imageryQuality?: string;
    solarPotential?: {
      maxArrayPanelsCount?: number;
      maxSunshineHoursPerYear?: number;
      wholeRoofStats?: Stats;
      roofSegmentStats?: { pitchDegrees?: number; azimuthDegrees?: number; stats?: Stats }[];
    };
  };
  if (b.error) throw new SourceError(`The Solar API refused the request${b.error.message ? `: ${b.error.message}` : "."}`);
  const potential = b.solarPotential;
  if (!potential) throw new SourceError("The Solar API answered without roof data.");
  const segments: RoofSegment[] = (potential.roofSegmentStats ?? []).map((s) => ({
    pitchDegrees: round(num(s.pitchDegrees) ?? 0, 1),
    azimuthDegrees: round(num(s.azimuthDegrees) ?? 0),
    areaSqft: round((num(s.stats?.areaMeters2) ?? 0) * SQFT_PER_M2),
    sunshineHoursPerYear: round(median(s.stats?.sunshineQuantiles)),
  }));
  const centerLat = num(b.center?.latitude);
  const centerLng = num(b.center?.longitude);
  const roof: SolarRoof = {
    roofAreaSqft: round((num(potential.wholeRoofStats?.areaMeters2) ?? 0) * SQFT_PER_M2),
    maxSunshineHoursPerYear: round(num(potential.maxSunshineHoursPerYear) ?? 0),
    segments,
    distanceFeet:
      centerLat !== undefined && centerLng !== undefined
        ? round(distanceMeters(site, { lat: centerLat, lng: centerLng }) * FEET_PER_M)
        : 0,
  };
  const d = b.imageryDate;
  if (d?.year) roof.imageryDate = [d.year, d.month, d.day].filter((x) => x).map((x, i) => (i ? String(x).padStart(2, "0") : String(x))).join("-");
  const quality = str(b.imageryQuality);
  if (quality) roof.imageryQuality = quality;
  const panels = num(potential.maxArrayPanelsCount);
  if (panels !== undefined) roof.maxPanels = panels;
  return roof;
}
