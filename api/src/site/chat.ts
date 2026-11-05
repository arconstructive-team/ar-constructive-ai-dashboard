/**
 * The site report for the team chat assistant: a read-only tool and a plain-text rendering.
 * Claude answers questions such as "is this lot in a fire zone?" from this text, and cites the
 * sources it lists.
 */
import { STEP_LABEL, STEP_NAMES, type SiteReport, type Step, type StepName } from "./types";

export const READ_SITE_REPORT_TOOL = {
  name: "read_site_report",
  description:
    "Read the saved site report of this project: address location, parcel (APN, lot size), jurisdiction and zoning, " +
    "FEMA flood zone, CAL FIRE fire hazard severity zone with SRA/LRA and CBC Chapter 7A, CGS liquefaction, landslide " +
    "and Alquist-Priolo fault zones, elevation, California energy code climate zone and Google Solar roof data. " +
    "Each fact lists its source and the date it was read. Read-only.",
  input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
};

const yesNo = (v: boolean) => (v ? "yes" : "no");

/** The facts of one step in a line, or null when the step has no data. */
export function stepFacts(report: SiteReport, name: StepName): string | null {
  const s = report.steps;
  switch (name) {
    case "geocode": {
      const g = s.geocode.data;
      return g ? `${g.formattedAddress} (lat ${g.lat.toFixed(6)}, lng ${g.lng.toFixed(6)}; ${g.accuracy}${g.placeId ? `; Google place id ${g.placeId}` : ""})` : null;
    }
    case "streetView": {
      const v = s.streetView.data;
      return v ? `${v.images.length} Street View images, panorama ${v.panoId}${v.date ? ` captured ${v.date}` : ""}` : null;
    }
    case "satellite": {
      const v = s.satellite.data;
      return v ? `${v.images.length} satellite images (zoom ${v.images.map((i) => i.zoom).join(" and ")})` : null;
    }
    case "solar": {
      const r = s.solar.data;
      if (!r) return null;
      const segments = r.segments
        .map((g, i) => `segment ${i + 1}: pitch ${g.pitchDegrees}°, azimuth ${g.azimuthDegrees}°, ${g.areaSqft} sq ft, ${g.sunshineHoursPerYear} sun h/yr`)
        .join("; ");
      return `roof ${r.roofAreaSqft} sq ft, up to ${r.maxSunshineHoursPerYear} sunshine hours per year${r.imageryDate ? `, imagery ${r.imageryDate}` : ""}${segments ? `. ${segments}` : ""}`;
    }
    case "parcel": {
      const p = s.parcel.data;
      if (!p) return null;
      const size = [p.assessorAcres !== undefined ? `${p.assessorAcres} acres on the assessor roll` : "", p.lotAreaSqft ? `about ${p.lotAreaSqft} sq ft from the parcel outline` : ""]
        .filter(Boolean)
        .join(", ");
      return `APN ${p.apn} (${p.county})${p.situsAddress ? `, ${p.situsAddress}` : ""}${size ? `; ${size}` : ""}${p.useDescription ? `; use: ${p.useDescription}` : ""}`;
    }
    case "jurisdiction": {
      const j = s.jurisdiction.data;
      return j ? `${j.name} (${j.kind === "city" ? "incorporated" : "unincorporated"})` : null;
    }
    case "zoning": {
      const z = s.zoning.data;
      if (!z?.district) return z?.mapUrl ? `zoning district unknown; zoning map: ${z.mapUrl}` : null;
      return `${z.district}${z.description ? ` (${z.description})` : ""}${z.overlay ? `; overlay ${z.overlay}` : ""}`;
    }
    case "flood": {
      const f = s.flood.data;
      if (!f) return null;
      return `Zone ${f.zone}${f.subtype ? ` (${f.subtype.toLowerCase()})` : ""}; in Special Flood Hazard Area: ${yesNo(f.inSpecialFloodHazardArea)}${
        f.baseFloodElevationFeet !== undefined ? `; base flood elevation ${f.baseFloodElevationFeet} ft` : ""
      }${f.firmPanelId ? `; FIRM ${f.firmPanelId}` : ""}`;
    }
    case "fire": {
      const f = s.fire.data;
      if (!f) return null;
      const zone = f.hazardClass ? `${f.hazardClass} Fire Hazard Severity Zone` : "not in a mapped Fire Hazard Severity Zone";
      const chapter = { applies: "applies", check: "check with the building department", "not indicated": "not indicated by the state maps" }[f.chapter7A];
      return `${zone}; responsibility area ${f.responsibility}; CBC Chapter 7A (WUI): ${chapter}`;
    }
    case "seismic": {
      const z = s.seismic.data;
      return z ? `liquefaction zone: ${yesNo(z.liquefaction)}; landslide zone: ${yesNo(z.landslide)}; Alquist-Priolo fault zone: ${yesNo(z.faultZone)}` : null;
    }
    case "elevation": {
      const e = s.elevation.data;
      if (!e) return null;
      const across = (e.sections ?? []).map(
        (t) => `${t.axis === "west-east" ? "west–east" : "south–north"} the ground falls ${t.slopePercent}% toward the ${t.downhill}`,
      );
      return `${e.feet} ft above sea level${across.length ? `; across the ${e.sections?.some((t) => t.lot) ? "lot" : "site"}: ${across.join(", ")}` : ""}`;
    }
    case "climateZone": {
      const c = s.climateZone.data;
      return c ? `California energy code climate zone ${c.zone}` : null;
    }
  }
}

const day = (iso: string) => iso.slice(0, 10);

function stepLine(report: SiteReport, name: StepName): string {
  const step = report.steps[name] as Step<unknown>;
  const facts = stepFacts(report, name);
  const head = `- ${STEP_LABEL[name]}: `;
  let body: string;
  if (step.status === "failed") body = `FAILED (${step.error ?? "no reason given"})`;
  else if (step.status === "unknown") body = `unknown${step.note ? ` (${step.note})` : ""}${facts ? `; ${facts}` : ""}`;
  else body = `${facts ?? "ok"}${step.note ? ` (note: ${step.note})` : ""}`;
  const sources = step.sources.map((src) => `${src.name}, read ${day(src.fetchedAt)}: ${src.url}`);
  if (step.checkUrl) sources.push(`check by hand: ${step.checkUrl}`);
  return `${head}${body}${sources.length ? `\n  Sources: ${sources.join(" | ")}` : ""}`;
}

/** The whole report as text for the assistant, or a clear line when there is none. */
export function siteReportText(report: SiteReport | null): string {
  if (!report) {
    return "This project has no site report yet. Ask the team to open the project's Site section and press \"Refresh site info\".";
  }
  const failed = STEP_NAMES.filter((n) => report.steps[n].status === "failed").map((n) => STEP_LABEL[n]);
  return [
    `Site report for ${report.address}, generated ${report.generatedAt}.`,
    ...STEP_NAMES.map((n) => stepLine(report, n)),
    failed.length ? `Failed steps: ${failed.join(", ")}. Say these facts are missing; do not guess them.` : "Every step answered.",
    report.links ? `Open in Google Maps: ${report.links.maps} | Street View: ${report.links.streetView} | Google Earth: ${report.links.earth}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A short summary for the assistant's project context block. */
export function siteSummary(report: SiteReport | null): string {
  if (!report) return "Site report: none yet.";
  const pick = (n: StepName) => stepFacts(report, n) ?? (report.steps[n].status === "failed" ? "failed" : "unknown");
  return `Site report (${day(report.generatedAt)}): ${pick("jurisdiction")}; parcel ${pick("parcel")}; fire: ${pick("fire")}; flood: ${pick("flood")}; climate: ${pick("climateZone")}. Use read_site_report for every fact and its source.`;
}

/** Runs the read_site_report tool. */
export async function runReadSiteReport(load: () => Promise<SiteReport | null>): Promise<{ content: string; isError: boolean }> {
  try {
    return { content: siteReportText(await load()), isError: false };
  } catch {
    return { content: "The site report could not be read. Try again.", isError: true };
  }
}
