import { useId, useState, type PointerEvent } from "react";
import { fmt, niceStep } from "./geometry";
import type { TerrainSection } from "./types";

const W = 720;
const H = 240;
const L = 52; // left gutter for the elevation ticks
const R = 16;
const T = 28;
const B = 36;

const ENDS: Record<TerrainSection["axis"], [string, string]> = {
  "west-east": ["West", "East"],
  "south-north": ["South", "North"],
};

/**
 * A terrain section drawn like a site section: the ground line over an earth hatch, the lot lines,
 * the slope across the lot, and a readout that follows the pointer.
 */
export function TerrainSectionView({ section, letter }: { section: TerrainSection; letter: string }) {
  const hatch = useId();
  const [hover, setHover] = useState<number | null>(null);
  const { points, lengthFeet, lot } = section;
  const [startName, endName] = ENDS[section.axis];

  // Keep at least 12 ft of height so a flat lot does not look like a cliff.
  const mid = (section.lowFeet + section.highFeet) / 2;
  const range = Math.max(section.highFeet - section.lowFeet, 12) * 1.35;
  const yMin = mid - range / 2;
  const yMax = mid + range / 2;
  const sx = (W - L - R) / lengthFeet;
  const sy = (H - T - B) / range;
  const x = (d: number) => L + d * sx;
  const y = (ft: number) => T + (yMax - ft) * sy;
  const exaggeration = sy / sx;

  const ground = points.map((p, i) => `${i ? "L" : "M"}${x(p.distanceFeet).toFixed(1)},${y(p.feet).toFixed(1)}`).join(" ");
  const earth = `${ground} L${x(lengthFeet)},${H - B} L${x(0)},${H - B} Z`;

  const yStep = niceStep(range, 3);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);
  const xStep = niceStep(lengthFeet, 4);
  const xTicks: number[] = [];
  for (let d = 0; d <= lengthFeet + 0.01; d += xStep) xTicks.push(d);

  const lotMid = lot ? (lot.startFeet + lot.endFeet) / 2 : lengthFeet / 2;
  const hovered = hover === null ? null : points[hover]!;

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const d = (((event.clientX - box.left) / box.width) * W - L) / sx;
    if (d < 0 || d > lengthFeet) return setHover(null);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.distanceFeet - d) < Math.abs(points[best]!.distanceFeet - d)) best = i;
    setHover(best);
  }

  const title = `Section ${letter}, ${startName.toLowerCase()} to ${endName.toLowerCase()}`;
  const slope = `${lot ? "Across the lot the ground falls" : "The ground falls"} ${fmt(section.slopePercent, 1)}% toward the ${section.downhill}`;

  return (
    <figure className="grid gap-2" aria-label={title}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="inline-flex size-6 items-center justify-center rounded-full border border-ink text-[13px] font-semibold"
          >
            {letter}
          </span>
          <span className="font-display text-base font-semibold">{title}</span>
        </span>
        <span className="text-sm text-ink">{slope}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}. ${slope}. Ground from ${fmt(section.lowFeet, 1)} to ${fmt(section.highFeet, 1)} ft above sea level over ${fmt(lengthFeet)} ft.`}
        className="block h-auto w-full touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <pattern id={hatch} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--color-muted)" strokeWidth="0.75" />
          </pattern>
        </defs>

        {yTicks.map((v) => (
          <g key={v} aria-hidden>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeWidth="0.75" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {fmt(v)} ft
            </text>
          </g>
        ))}

        {lot && (
          <g aria-hidden>
            <rect x={x(lot.startFeet)} y={T - 6} width={x(lot.endFeet) - x(lot.startFeet)} height={H - B - T + 6} fill="var(--color-surface)" />
            {[lot.startFeet, lot.endFeet].map((d) => (
              <line key={d} x1={x(d)} x2={x(d)} y1={T - 10} y2={H - B} stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="6 4" />
            ))}
            <text x={x(lotMid)} y={T - 12} textAnchor="middle" fontSize="11" fill="var(--color-ink)">
              Lot, {fmt(lot.endFeet - lot.startFeet)} ft
            </text>
          </g>
        )}

        <path d={earth} fill={`url(#${hatch})`} />
        <path d={ground} fill="none" stroke="var(--color-ink)" strokeWidth="2.25" strokeLinejoin="round" />

        {xTicks.map((d) => (
          <text key={d} aria-hidden x={x(d)} y={H - B + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
            {fmt(d)}
          </text>
        ))}
        <text aria-hidden x={L} y={H - 4} fontSize="11" fontWeight="600" fill="var(--color-ink)">
          {startName}
        </text>
        <text aria-hidden x={W - R} y={H - 4} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--color-ink)">
          {endName}
        </text>
        <text aria-hidden x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
          feet along the section
        </text>

        {hovered && (
          <g aria-hidden>
            <line x1={x(hovered.distanceFeet)} x2={x(hovered.distanceFeet)} y1={T} y2={H - B} stroke="var(--color-ink)" strokeWidth="0.75" />
            <circle cx={x(hovered.distanceFeet)} cy={y(hovered.feet)} r="4" fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="1.5" />
            <g transform={`translate(${Math.min(x(hovered.distanceFeet) + 8, W - R - 150)} ${T + 4})`}>
              <rect width="150" height="38" fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="1" />
              <text x="8" y="16" fontSize="12" fontWeight="600" fill="var(--color-ink)">
                {fmt(hovered.feet, 1)} ft above sea level
              </text>
              <text x="8" y="30" fontSize="11" fill="var(--color-muted)">
                {fmt(hovered.distanceFeet)} ft from the {startName.toLowerCase()} end
              </text>
            </g>
          </g>
        )}
      </svg>
      {exaggeration > 1.25 && (
        <p className="text-xs text-muted">Height drawn {fmt(exaggeration, 1)} times the horizontal scale, so slopes read clearly.</p>
      )}
    </figure>
  );
}
