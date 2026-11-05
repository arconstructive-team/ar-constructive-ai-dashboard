// Turns a site report into the markdown of the project's "Site report" artifact, so the team
// can read it in Documents, attach it in a chat with Sources, edit it and export it.
import { fmt } from "./geometry";
import { STEP_LABEL, STEP_NAMES, type SiteReport, type Step } from "./types";

/** The site report artifact has this id in every project, so a refresh adds a version to it. */
export const SITE_ARTIFACT_ID = "site-report";

export function siteArtifactTitle(address: string): string {
  return `Site report: ${address.trim() || "no address"}`;
}

/** Escapes pipes and line breaks so a value stays inside its table cell. */
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || "—";

function value(step: Step, read: string | undefined): string {
  if (step.status === "failed") return "Not read";
  return read ?? step.summary ?? "Unknown";
}

function table(rows: [string, string][]): string {
  return ["| Item | Value |", "| --- | --- |", ...rows.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`)].join("\n");
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function siteReportMarkdown(report: SiteReport): string {
  const s = report.steps;
  const parcel = s.parcel.data;
  const zoning = s.zoning.data;
  const flood = s.flood.data;
  const fire = s.fire.data;
  const quake = s.seismic.data;
  const elevation = s.elevation.data;
  const roof = s.solar.data;
  const at = s.geocode.data;

  const lot =
    parcel?.assessorAcres !== undefined
      ? `${fmt(parcel.assessorAcres, 2)} ac${parcel.lotAreaSqft ? ` (${fmt(parcel.lotAreaSqft)} sq ft from the outline)` : ""}`
      : parcel?.lotAreaSqft
        ? `${fmt(parcel.lotAreaSqft)} sq ft`
        : parcel
          ? "Unknown"
          : undefined;

  const out: string[] = [
    `# ${siteArtifactTitle(report.address)}`,
    `Gathered ${day(report.generatedAt)} from public records and Google. Edit this document to add notes or correct a value; ` +
      `refreshing the site info on the project page saves a new version and keeps this one in the version history.`,
  ];

  const failed = STEP_NAMES.filter((n) => s[n].status === "failed");
  if (failed.length > 0) out.push(`**Not read:** ${failed.map((n) => STEP_LABEL[n]).join(", ")}. Check these by hand.`);

  out.push(
    "## Summary",
    table([
      ["Address", at?.formattedAddress ?? report.address],
      ...(at ? ([["Location", `${at.lat.toFixed(6)}, ${at.lng.toFixed(6)}`]] as [string, string][]) : []),
      ["Parcel (APN)", value(s.parcel, parcel ? `${parcel.apn}${parcel.county ? `, ${parcel.county}` : ""}` : undefined)],
      ["Lot area", value(s.parcel, lot)],
      ["Use on the assessor roll", value(s.parcel, parcel ? (parcel.useDescription ?? "Unknown") : undefined)],
      [
        "Jurisdiction",
        value(s.jurisdiction, s.jurisdiction.data ? `${s.jurisdiction.data.name} (${s.jurisdiction.data.kind === "city" ? "incorporated" : "unincorporated"})` : undefined),
      ],
      [
        "Zoning",
        value(
          s.zoning,
          zoning?.district
            ? [zoning.district, zoning.description, zoning.overlay ? `overlay ${zoning.overlay}` : ""].filter(Boolean).join(", ")
            : s.zoning.status === "unknown"
              ? "Not published"
              : undefined,
        ),
      ],
      ["Energy code climate zone", value(s.climateZone, s.climateZone.data ? `Zone ${s.climateZone.data.zone}` : undefined)],
      ["Ground at the address", value(s.elevation, elevation ? `${fmt(elevation.feet)} ft above sea level` : undefined)],
      ["Roof area", value(s.solar, roof ? `${fmt(roof.roofAreaSqft)} sq ft in ${roof.segments.length} planes` : undefined)],
    ]),
  );

  const yesNo = (inZone: boolean) => (inZone ? "In the zone" : "Outside the zone");
  out.push(
    "## Site constraints",
    table([
      [
        "Flood (FEMA)",
        value(
          s.flood,
          flood
            ? [
                `Zone ${flood.zone}${flood.inSpecialFloodHazardArea ? ", in the 1% annual-chance floodplain" : ", outside the special flood hazard area"}`,
                flood.baseFloodElevationFeet !== undefined ? `base flood elevation ${flood.baseFloodElevationFeet} ft` : "",
                flood.firmPanelId ? `FIRM panel ${flood.firmPanelId}` : "",
              ]
                .filter(Boolean)
                .join(", ")
            : undefined,
        ),
      ],
      [
        "Wildfire (CAL FIRE)",
        value(
          s.fire,
          fire ? `${fire.hazardClass ? `${fire.hazardClass} fire hazard severity zone` : "Not in a mapped fire hazard severity zone"}, ${fire.responsibility}` : undefined,
        ),
      ],
      [
        "Wildland-urban interface (CBC Chapter 7A)",
        value(s.fire, fire ? { applies: "Applies", check: "Check whether it applies", "not indicated": "Not indicated by the state maps" }[fire.chapter7A] : undefined),
      ],
      ["Liquefaction zone", value(s.seismic, quake ? yesNo(quake.liquefaction) : undefined)],
      ["Landslide zone", value(s.seismic, quake ? yesNo(quake.landslide) : undefined)],
      ["Alquist-Priolo fault zone", value(s.seismic, quake ? yesNo(quake.faultZone) : undefined)],
    ]),
  );

  const sections = elevation?.sections ?? [];
  if (sections.length > 0) {
    out.push(
      "## Ground and slope",
      [
        "| Section | Length | Low | High | Slope | Downhill |",
        "| --- | --- | --- | --- | --- | --- |",
        ...sections.map(
          (t) =>
            `| ${t.axis} | ${fmt(t.lengthFeet)} ft | ${fmt(t.lowFeet)} ft | ${fmt(t.highFeet)} ft | ${fmt(t.slopePercent, 1)}% | ${t.downhill} |`,
        ),
      ].join("\n"),
    );
    if (s.elevation.note) out.push(s.elevation.note);
  }

  if (roof && roof.segments.length > 0) {
    out.push(
      "## Roof and sun",
      `${fmt(roof.roofAreaSqft)} sq ft of roof, up to ${fmt(roof.maxSunshineHoursPerYear)} sun hours a year` +
        `${roof.maxPanels ? `, room for up to ${fmt(roof.maxPanels)} panels` : ""}${roof.imageryDate ? `. Google imagery from ${roof.imageryDate}` : ""}.`,
      [
        "| Plane | Pitch | Faces (azimuth) | Area | Sun hours a year |",
        "| --- | --- | --- | --- | --- |",
        ...roof.segments.map(
          (r, i) => `| ${i + 1} | ${fmt(r.pitchDegrees, 1)}° | ${fmt(r.azimuthDegrees)}° | ${fmt(r.areaSqft)} sq ft | ${fmt(r.sunshineHoursPerYear)} |`,
        ),
      ].join("\n"),
    );
  }

  const notes = STEP_NAMES.filter((n) => s[n].note || (s[n].status === "failed" && s[n].error));
  if (notes.length > 0) {
    out.push("## Notes", notes.map((n) => `- **${STEP_LABEL[n]}:** ${s[n].status === "failed" ? s[n].error : s[n].note}`).join("\n"));
  }

  const sources = STEP_NAMES.flatMap((n) => [
    ...s[n].sources.map((src) => `- ${STEP_LABEL[n]}: ${src.name}, read ${day(src.fetchedAt)}. ${src.url}`),
    ...(s[n].checkUrl ? [`- ${STEP_LABEL[n]}: check by hand at ${s[n].checkUrl}`] : []),
  ]);
  if (report.links) sources.push(`- Google Maps: ${report.links.maps}`);
  if (sources.length > 0) out.push("## Sources", sources.join("\n"));

  return out.join("\n\n") + "\n";
}
