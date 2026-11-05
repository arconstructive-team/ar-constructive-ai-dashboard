import { bounds, fmt, niceStep, toFeet, type XY } from "./geometry";
import type { LatLng, TerrainSection } from "./types";

const W = 640;
const H = 460;
const PAD = 56;

/**
 * The lot as a site plan: the parcel outline to scale, the address point, a north arrow, a scale
 * bar, the overall dimensions, and the cut lines of the terrain sections (A, B) drawn below it.
 */
export function SitePlan(props: { outline: LatLng[]; at: LatLng; sections?: TerrainSection[]; apn?: string }) {
  const { outline, at, sections = [] } = props;
  const project = toFeet(at);
  const ring = outline.map(project);
  const lot = bounds(ring);
  const cx = (lot.minX + lot.maxX) / 2;
  const cy = (lot.minY + lot.maxY) / 2;

  // The same cut lines the API sampled: through the middle of the lot's box.
  const cuts = sections.map((s, i) => {
    const half = s.lengthFeet / 2;
    const [a, b]: [XY, XY] =
      s.axis === "west-east"
        ? [{ x: cx - half, y: cy }, { x: cx + half, y: cy }]
        : [{ x: cx, y: cy - half }, { x: cx, y: cy + half }];
    return { letter: String.fromCharCode(65 + i), a, b, axis: s.axis };
  });

  const all = bounds([...ring, ...cuts.flatMap((c) => [c.a, c.b]), { x: 0, y: 0 }]);
  const spanX = Math.max(all.maxX - all.minX, 1);
  const spanY = Math.max(all.maxY - all.minY, 1);
  const s = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const ox = (W - spanX * s) / 2;
  const oy = (H - spanY * s) / 2;
  const px = (p: XY) => ({ x: ox + (p.x - all.minX) * s, y: H - (oy + (p.y - all.minY) * s) });
  const path = ring.map((p, i) => `${i ? "L" : "M"}${px(p).x.toFixed(1)},${px(p).y.toFixed(1)}`).join(" ") + " Z";
  const pin = px({ x: 0, y: 0 });

  const perimeter = ring.reduce((sum, p, i) => sum + Math.hypot(ring[(i + 1) % ring.length]!.x - p.x, ring[(i + 1) % ring.length]!.y - p.y), 0);
  const centre = px({ x: cx, y: cy });
  const edges = ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    const feet = Math.hypot(q.x - p.x, q.y - p.y);
    // Short jogs would crowd the drawing; the outline already shows them.
    if (feet < Math.max(12, perimeter * 0.04)) return [];
    const a = px(p);
    const b = px(q);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    // Point the label away from the middle of the lot.
    if ((mx + nx - centre.x) ** 2 + (my + ny - centre.y) ** 2 < (mx - centre.x) ** 2 + (my - centre.y) ** 2) {
      nx = -nx;
      ny = -ny;
    }
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return [{ x: mx + nx * 14, y: my + ny * 14, angle, feet }];
  });

  const bar = niceStep(spanX, 3);
  const barPx = bar * s;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Site plan of the parcel${props.apn ? ` ${props.apn}` : ""}, north up: lot lines of ${edges.map((e) => `${fmt(e.feet)} ft`).join(", ")}`}
      className="block h-auto w-full"
    >
      <defs>
        <pattern id="plan-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0V16" fill="none" stroke="var(--color-border)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#plan-grid)" />

      {/* Section cut lines, drawn the way a plan marks them: dash-dot with a lettered tag at each end. */}
      {cuts.map((c) => {
        const a = px(c.a);
        const b = px(c.b);
        return (
          <g key={c.letter} aria-hidden>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="14 4 2 4" />
            {[a, b].map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="12" fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="1.25" />
                <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--color-ink)">
                  {c.letter}
                </text>
              </g>
            ))}
          </g>
        );
      })}

      <path d={path} fill="var(--color-surface)" fillOpacity="0.85" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="miter" />

      {/* Each lot line labelled with its length, outside the lot, the way a plat shows it. */}
      <g aria-hidden fontSize="12" fill="var(--color-ink)">
        {edges.map((e, i) => (
          <text
            key={i}
            x={e.x}
            y={e.y}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${e.angle} ${e.x} ${e.y})`}
            paintOrder="stroke"
            stroke="var(--color-bg)"
            strokeWidth="4"
          >
            {fmt(e.feet)} ft
          </text>
        ))}
      </g>

      {/* The address point Google or the Census geocoder returned. */}
      <g aria-hidden>
        <circle cx={pin.x} cy={pin.y} r="9" fill="none" stroke="var(--color-ink)" strokeWidth="1.25" />
        <circle cx={pin.x} cy={pin.y} r="3.5" fill="var(--color-ink)" />
      </g>

      {/* North arrow. */}
      <g aria-hidden transform={`translate(${W - 34} 40)`}>
        <circle r="18" fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="1" />
        <path d="M0 -14 L6 6 L0 2 L-6 6 Z" fill="var(--color-ink)" />
        <text y="-23" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-ink)">
          N
        </text>
      </g>

      {/* Scale bar: two halves, black and white, the way a drawing sheet shows it. */}
      <g aria-hidden transform={`translate(20 ${H - 22})`} fontSize="11" fill="var(--color-ink)">
        <rect width={barPx / 2} height="6" fill="var(--color-ink)" />
        <rect x={barPx / 2} width={barPx / 2} height="6" fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="1" />
        <text y="-5">0</text>
        <text x={barPx} y="-5" textAnchor="middle">
          {fmt(bar)} ft
        </text>
      </g>
    </svg>
  );
}
