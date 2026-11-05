import { compassName, compassPoint, fmt, pitchIn12 } from "./geometry";
import type { SolarRoof } from "./types";

const SIZE = 260;
const C = SIZE / 2;
const R = 100;

/** A wedge of the compass rose, `width` degrees wide, pointing at `azimuth` (0 = north, clockwise). */
function wedge(azimuth: number, width: number, radius: number): string {
  const at = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(C + r * Math.cos(rad)).toFixed(1)},${(C + r * Math.sin(rad)).toFixed(1)}`;
  };
  return `M${C},${C} L${at(azimuth - width / 2, radius)} A${radius},${radius} 0 0 1 ${at(azimuth + width / 2, radius)} Z`;
}

/**
 * Google Solar's roof planes: an orientation diagram (each plane a wedge facing its direction,
 * longer for more area, darker for more sun) and a table with pitch in rise per 12.
 */
export function RoofView({ roof }: { roof: SolarRoof }) {
  const planes = [...roof.segments].sort((a, b) => b.sunshineHoursPerYear - a.sunshineHoursPerYear);
  const maxArea = Math.max(...planes.map((p) => p.areaSqft), 1);
  const sun = planes.map((p) => p.sunshineHoursPerYear);
  const lo = Math.min(...sun);
  const hi = Math.max(...sun);
  const shade = (h: number) => (hi > lo ? 0.2 + (0.75 * (h - lo)) / (hi - lo) : 0.6);
  const best = planes[0];

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-start">
      <figure className="grid gap-2" aria-label="Roof planes by direction">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" className="block h-auto w-full max-w-[260px]" aria-label={
          best
            ? `${planes.length} roof planes. The sunniest faces ${compassName(best.azimuthDegrees)} with ${fmt(best.sunshineHoursPerYear)} sun hours a year.`
            : "No roof planes."
        }>
          {[R, R * 0.66, R * 0.33].map((r) => (
            <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="var(--color-border)" strokeWidth="1" />
          ))}
          <line x1={C} x2={C} y1={C - R - 6} y2={C + R + 6} stroke="var(--color-border)" strokeWidth="1" />
          <line y1={C} y2={C} x1={C - R - 6} x2={C + R + 6} stroke="var(--color-border)" strokeWidth="1" />
          {planes.map((p, i) => (
            <path
              key={i}
              d={wedge(p.azimuthDegrees, 26, 18 + (R - 18) * Math.sqrt(p.areaSqft / maxArea))}
              fill="var(--color-ink)"
              fillOpacity={shade(p.sunshineHoursPerYear)}
              stroke="var(--color-bg)"
              strokeWidth="1"
            />
          ))}
          {(
            [
              ["N", C, C - R - 12],
              ["E", C + R + 13, C + 4],
              ["S", C, C + R + 20],
              ["W", C - R - 13, C + 4],
            ] as const
          ).map(([label, x, y]) => (
            <text key={label} x={x} y={y} textAnchor="middle" fontSize="12" fontWeight={label === "N" ? 700 : 500} fill="var(--color-ink)">
              {label}
            </text>
          ))}
        </svg>
        <figcaption className="text-xs text-muted">Longer wedges are larger planes; darker wedges get more sun.</figcaption>
      </figure>

      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Roof planes, sunniest first</caption>
        <thead>
          <tr className="border-b border-ink text-left text-xs text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Faces</th>
            <th scope="col" className="py-2 pr-3 font-medium">Pitch</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Area</th>
            <th scope="col" className="w-[38%] py-2 font-medium">Sun hours a year</th>
          </tr>
        </thead>
        <tbody>
          {planes.map((p, i) => (
            <tr key={i} className="border-b border-border">
              <td className="py-2 pr-3">
                {compassPoint(p.azimuthDegrees)} <span className="text-muted">{fmt(p.azimuthDegrees)}°</span>
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {pitchIn12(p.pitchDegrees)} <span className="text-muted">{fmt(p.pitchDegrees, 1)}°</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt(p.areaSqft)} sq ft</td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-2 bg-ink" style={{ width: `${(70 * p.sunshineHoursPerYear) / Math.max(hi, 1)}%`, opacity: shade(p.sunshineHoursPerYear) }} />
                  <span className="tabular-nums">{fmt(p.sunshineHoursPerYear)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
