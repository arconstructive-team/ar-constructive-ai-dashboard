import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, ChevronRight, Info, Loader2, Minus, RefreshCw } from "lucide-react";
import type { SiteApi } from "../site/siteApi";
import { fmt } from "../site/geometry";
import { EMBED_KEY, GoogleButtons, GoogleCanvas } from "../site/GoogleCanvas";
import { RoofView } from "../site/RoofView";
import { SitePlan } from "../site/SitePlan";
import { TerrainSectionView } from "../site/TerrainSectionView";
import { STEP_LABEL, STEP_NAMES, type ImageSet, type SiteReport, type Step, type StepName } from "../site/types";
import type { Project, WorkspaceStore } from "./types";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-40 " +
  focusRing;
const textLink = `underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`;
const h3 = "font-display text-xl font-semibold leading-[1.25]";

/** The state of the last pipeline run started from this browser. */
export type SiteRun = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string };

type Loadable<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

/** The steps shown in the source list; the two image steps have their own blocks. */
const FACT_STEPS = STEP_NAMES.filter((n) => n !== "streetView" && n !== "satellite");

const day = (iso: string) => iso.slice(0, 10);

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SitePanel(props: {
  store: WorkspaceStore;
  project: Project;
  api?: SiteApi;
  run: SiteRun;
  onRefresh: () => void;
}) {
  const { store, project, api, run, onRefresh } = props;
  const [report, setReport] = useState<Loadable<SiteReport | null>>({ kind: "loading" });

  useEffect(() => {
    setReport({ kind: "loading" });
    return store.watchSiteReport(
      project.id,
      (data) => setReport({ kind: "ready", data }),
      (error) => setReport({ kind: "error", message: error.message || "The site report could not load. Reload the page." }),
    );
  }, [store, project.id]);

  const running = run.kind === "running";
  const hasAddress = project.address.trim() !== "";

  return (
    <section aria-labelledby={`site-${project.id}`} className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink pb-3">
        <div className="grid gap-1">
          <h2 id={`site-${project.id}`} className="font-display text-[32px] font-semibold leading-[1.15]">
            Site
          </h2>
          <p className="text-sm text-muted">
            {report.kind === "ready" && report.data
              ? `Gathered ${dateLabel(report.data.generatedAt)} from public records and Google`
              : hasAddress
                ? "Public records and imagery for the project address"
                : "This project has no address."}
          </p>
        </div>
        <button type="button" className={secondaryButton} onClick={onRefresh} disabled={!api || !hasAddress || running}>
          {running ? (
            <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />
          ) : (
            <RefreshCw aria-hidden className="size-4" strokeWidth={1.5} />
          )}
          Refresh site info
        </button>
      </div>

      {!api && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          The site report service is not connected to this dashboard yet, so the report cannot be refreshed here.
        </p>
      )}
      {running && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />
          Gathering photos, parcel, zoning, hazards, terrain and climate zone. This takes up to half a minute.
        </p>
      )}
      {run.kind === "error" && <Alert message={`The site info could not be refreshed. ${run.message}`} />}

      {report.kind === "loading" && <ReportSkeleton />}
      {report.kind === "error" && <Alert message={report.message} />}
      {report.kind === "ready" && !report.data && !running && (
        <p className="max-w-[680px] text-muted">
          No site report yet. Press “Refresh site info” to gather Street View and satellite images, the parcel, zoning,
          flood, fire and earthquake zones, the ground and slope, and the climate zone for this address.
        </p>
      )}
      {report.kind === "ready" && report.data && <ReportView report={report.data} api={api} />}
    </section>
  );
}

function ReportSkeleton() {
  return (
    <div role="status" aria-label="Loading the site report" className="grid gap-2 lg:grid-cols-3">
      <span className="block aspect-[8/5] animate-pulse bg-surface lg:col-span-2" />
      <span className="block aspect-[8/5] animate-pulse bg-surface lg:aspect-auto" />
    </div>
  );
}

function Alert({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-danger">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
      {message}
    </p>
  );
}

function ReportView({ report, api }: { report: SiteReport; api?: SiteApi }) {
  const s = report.steps;
  const failed = STEP_NAMES.filter((n) => s[n].status === "failed");
  const outline = s.parcel.data?.outline;
  const at = s.geocode.data;
  const sections = s.elevation.data?.sections ?? [];
  const roof = s.solar.data;

  return (
    <div className="grid gap-12">
      {failed.length > 0 && (
        <div className="grid gap-1 border-l-4 border-danger bg-surface p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <AlertCircle aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
            {failed.length === 1 ? "1 step failed" : `${failed.length} steps failed`}
          </p>
          <p className="text-ink">
            {failed.map((n) => STEP_LABEL[n]).join(", ")}. The rest of the report is below. Press “Refresh site info” to try
            again.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        <div className="grid gap-2 lg:grid-cols-3">
          <StreetViewBlock step={s.streetView} api={api} />
          <SatelliteBlock step={s.satellite} api={api} />
        </div>
        {report.links && !(EMBED_KEY && at) && <GoogleButtons links={report.links} />}
      </div>

      {EMBED_KEY && at && (
        <div className="grid gap-3">
          <h3 className={h3}>Explore the site</h3>
          <GoogleCanvas
            embedKey={EMBED_KEY}
            at={at}
            street={{ panoId: s.streetView.data?.panoId, heading: s.streetView.data?.images[0]?.heading }}
            links={report.links}
            address={report.address}
          />
        </div>
      )}

      <TitleBlock report={report} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-3">
          <h3 className={h3}>Site plan</h3>
          {outline && outline.length >= 3 && at ? (
            <figure className="grid gap-2">
              <div className="border border-border bg-bg">
                <SitePlan outline={outline} at={at} sections={sections} apn={s.parcel.data?.apn} />
              </div>
              <figcaption className="text-xs text-muted">
                County parcel outline, north up. The ring is the address point
                {sections.length > 0 ? "; A and B mark the sections below" : ""}.
                {s.parcel.data?.matchedBy === "address" ? " The point lies outside the lot, so the parcel was matched by its address." : ""}
              </figcaption>
            </figure>
          ) : (
            <p className="text-sm text-muted">
              {s.parcel.status === "failed"
                ? "The parcel outline could not be read, so there is no plan."
                : "The county parcel map has no outline for this address."}
            </p>
          )}
        </div>
        <Constraints report={report} />
      </div>

      <Ground report={report} />

      {roof && roof.segments.length > 0 && (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <h3 className={h3}>Roof and sun</h3>
            <p className="text-sm text-muted">
              {fmt(roof.roofAreaSqft)} sq ft of roof in {roof.segments.length} planes, up to {fmt(roof.maxSunshineHoursPerYear)} sun hours a
              year{roof.imageryDate ? `. Google imagery from ${roof.imageryDate}` : ""}.
            </p>
            {s.solar.note && <p className="text-sm text-ink">{s.solar.note}</p>}
          </div>
          <RoofView roof={roof} />
        </div>
      )}

      <details className="group border-t border-ink pt-3">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 font-display text-base font-semibold ${focusRing}`}>
          <ChevronRight aria-hidden className="size-5 transition-transform duration-(--duration-brand) group-open:rotate-90" strokeWidth={1.5} />
          Sources and checks by hand
        </summary>
        <ul aria-label="Site facts" className="mt-4 grid gap-4 md:grid-cols-2">
          {FACT_STEPS.map((name) => (
            <Fact key={name} name={name} step={s[name]} />
          ))}
        </ul>
      </details>
    </div>
  );
}

/** A cell of the title block: a small label over the value, like the title block of a drawing sheet. */
function Cell(props: { label: string; step: Step; value?: ReactNode; sub?: ReactNode }) {
  const { step } = props;
  const value =
    step.status === "failed" ? <span className="text-danger">Not read</span> : (props.value ?? step.summary ?? <span className="text-muted">Unknown</span>);
  return (
    <div className="grid content-start gap-1 border-r border-b border-ink p-4">
      <dt className="text-xs font-medium text-muted">{props.label}</dt>
      <dd className="grid gap-0.5">
        <span className="font-display text-xl font-semibold leading-[1.25] break-words">{value}</span>
        {step.status !== "failed" && props.sub && <span className="text-sm text-muted">{props.sub}</span>}
      </dd>
    </div>
  );
}

function TitleBlock({ report }: { report: SiteReport }) {
  const s = report.steps;
  const parcel = s.parcel.data;
  const zoning = s.zoning.data;
  const roof = s.solar.data;
  const elevation = s.elevation.data;
  return (
    <dl aria-label="Site summary" className="grid grid-cols-2 border-t border-l border-ink md:grid-cols-4">
      <Cell label="Parcel (APN)" step={s.parcel} value={parcel?.apn} sub={parcel?.county} />
      <Cell
        label="Lot area"
        step={s.parcel}
        value={parcel?.assessorAcres !== undefined ? `${fmt(parcel.assessorAcres, 2)} ac` : parcel?.lotAreaSqft ? `${fmt(parcel.lotAreaSqft)} sq ft` : parcel ? "Unknown" : undefined}
        sub={parcel?.assessorAcres !== undefined && parcel.lotAreaSqft ? `${fmt(parcel.lotAreaSqft)} sq ft from the outline` : undefined}
      />
      <Cell label="Jurisdiction" step={s.jurisdiction} value={s.jurisdiction.data?.name} sub={s.jurisdiction.data?.kind === "city" ? "Incorporated" : s.jurisdiction.data ? "Unincorporated" : undefined} />
      <Cell
        label="Zoning"
        step={s.zoning}
        value={zoning?.district ?? (s.zoning.status === "unknown" ? "Not published" : undefined)}
        sub={
          zoning?.description ??
          (s.zoning.checkUrl ? (
            <a href={s.zoning.checkUrl} target="_blank" rel="noreferrer" className={textLink}>
              Check the zoning map
            </a>
          ) : undefined)
        }
      />
      <Cell label="Use on the assessor roll" step={s.parcel} value={parcel?.useDescription?.split(",")[0] ?? (parcel ? "Unknown" : undefined)} />
      <Cell
        label="Energy code climate zone"
        step={s.climateZone}
        value={s.climateZone.data ? `Zone ${s.climateZone.data.zone}` : undefined}
        sub="California Energy Code"
      />
      <Cell
        label="Ground at the address"
        step={s.elevation}
        value={elevation ? `${fmt(elevation.feet)} ft` : undefined}
        sub={elevation ? "above sea level" : undefined}
      />
      <Cell
        label="Roof area"
        step={s.solar}
        value={roof ? `${fmt(roof.roofAreaSqft)} sq ft` : undefined}
        sub={roof ? `${roof.segments.length} planes, Google Solar` : undefined}
      />
    </dl>
  );
}

type Level = "clear" | "flag" | "check" | "unread";

function Constraint(props: { label: string; level: Level; text: ReactNode; sub?: ReactNode; checkUrl?: string }) {
  const marker: Record<Level, ReactNode> = {
    clear: <Check aria-hidden className="size-4" strokeWidth={2} />,
    flag: <AlertTriangle aria-hidden className="size-4" strokeWidth={2} />,
    check: <AlertTriangle aria-hidden className="size-4" strokeWidth={2} />,
    unread: <Minus aria-hidden className="size-4" strokeWidth={2} />,
  };
  const box: Record<Level, string> = {
    clear: "border-ink text-ink",
    flag: "border-danger bg-danger text-bg",
    check: "border-danger text-danger",
    unread: "border-dashed border-muted text-muted",
  };
  const word: Record<Level, string> = { clear: "Clear", flag: "Applies", check: "Check", unread: "Not read" };
  return (
    <li className="grid grid-cols-[28px_1fr] gap-x-3 border-b border-border py-3">
      <span className={`mt-0.5 inline-flex size-7 items-center justify-center border ${box[props.level]}`}>
        {marker[props.level]}
        <span className="sr-only">{word[props.level]}</span>
      </span>
      <div className="grid gap-0.5">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold">{props.label}</span>
          {props.checkUrl && (
            <a href={props.checkUrl} target="_blank" rel="noreferrer" className={`text-xs ${textLink}`}>
              Check the map
            </a>
          )}
        </p>
        <p className={`text-sm ${props.level === "flag" ? "text-danger" : "text-ink"}`}>{props.text}</p>
        {props.sub && <p className="text-xs text-muted">{props.sub}</p>}
      </div>
    </li>
  );
}

function Constraints({ report }: { report: SiteReport }) {
  const s = report.steps;
  const flood = s.flood.data;
  const fire = s.fire.data;
  const quake = s.seismic.data;
  const unread = (step: Step) => (step.status === "failed" ? (step.error ?? "The source could not be read.") : (step.summary ?? step.note ?? "No answer from the source."));

  const fireText = fire?.hazardClass ? `${fire.hazardClass} fire hazard severity zone` : "Not in a mapped fire hazard severity zone";
  const responsibility = fire
    ? { SRA: "State responsibility area (SRA)", LRA: "Local responsibility area (LRA)", FRA: "Federal responsibility area (FRA)", unknown: "Responsibility area unknown" }[fire.responsibility]
    : undefined;

  return (
    <div className="grid content-start gap-3">
      <h3 className={h3}>Site constraints</h3>
      <ul aria-label="Site constraints" className="border-t border-ink">
        <Constraint
          label="Flood"
          level={flood ? (flood.inSpecialFloodHazardArea ? "flag" : "clear") : "unread"}
          text={flood ? `FEMA zone ${flood.zone}${flood.inSpecialFloodHazardArea ? ", in the 1% annual-chance floodplain" : ", outside the special flood hazard area"}` : unread(s.flood)}
          sub={flood ? [flood.baseFloodElevationFeet !== undefined ? `Base flood elevation ${flood.baseFloodElevationFeet} ft` : null, flood.firmPanelId ? `FIRM panel ${flood.firmPanelId}` : null].filter(Boolean).join(", ") || undefined : undefined}
          checkUrl={s.flood.checkUrl}
        />
        <Constraint
          label="Wildfire"
          level={fire ? (fire.hazardClass ? "flag" : "clear") : "unread"}
          text={fire ? fireText : unread(s.fire)}
          sub={responsibility}
          checkUrl={s.fire.checkUrl}
        />
        <Constraint
          label="Wildland-urban interface (CBC Chapter 7A)"
          level={fire ? ({ applies: "flag", check: "check", "not indicated": "clear" } as const)[fire.chapter7A] : "unread"}
          text={fire ? { applies: "Chapter 7A building rules apply", check: "Check whether Chapter 7A applies", "not indicated": "Not indicated by the state maps" }[fire.chapter7A] : unread(s.fire)}
        />
        {(
          [
            ["Liquefaction zone", "liquefaction"],
            ["Landslide zone", "landslide"],
            ["Alquist-Priolo fault zone", "faultZone"],
          ] as const
        ).map(([label, key]) => (
          <Constraint
            key={key}
            label={label}
            level={quake ? (quake[key] ? "flag" : "clear") : "unread"}
            text={quake ? (quake[key] ? "The lot is in this zone" : "Outside this zone on the state map") : unread(s.seismic)}
            checkUrl={key === "faultZone" ? s.seismic.checkUrl : undefined}
          />
        ))}
      </ul>
      {quake && s.seismic.note && <p className="text-xs text-muted">{s.seismic.note}</p>}
    </div>
  );
}

function Ground({ report }: { report: SiteReport }) {
  const step = report.steps.elevation;
  const e = step.data;
  const sections = e?.sections ?? [];
  const steepest = [...sections].sort((a, b) => b.slopePercent - a.slopePercent)[0];
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-1">
          <h3 className={h3}>Ground and slope</h3>
          <p className="max-w-[560px] text-sm text-muted">
            {sections.length > 0
              ? "Two sections cut through the lot, west to east and south to north, from Google's elevation data. Move along a section to read the ground height."
              : step.status === "failed"
                ? (step.error ?? "The elevation could not be read.")
                : "The ground height at the address point. Refresh the site info to draw the terrain sections."}
          </p>
          {step.note && <p className="text-sm text-ink">{step.note}</p>}
        </div>
        {e && (
          <div className="flex gap-8">
            <p className="grid">
              <span className="font-display text-[40px] font-semibold leading-[1.1] tabular-nums">{fmt(e.feet)} ft</span>
              <span className="text-sm text-muted">above sea level at the address</span>
            </p>
            {steepest && (
              <p className="grid">
                <span className="font-display text-[40px] font-semibold leading-[1.1] tabular-nums">{fmt(steepest.slopePercent, 1)}%</span>
                <span className="text-sm text-muted">steepest fall, toward the {steepest.downhill}</span>
              </p>
            )}
          </div>
        )}
      </div>
      {sections.map((t, i) => (
        <TerrainSectionView key={t.axis} section={t} letter={String.fromCharCode(65 + i)} />
      ))}
    </div>
  );
}

function StatusChip({ step }: { step: Step }) {
  if (step.status === "ok") return null;
  const failed = step.status === "failed";
  return (
    <span className={`ml-2 inline-flex rounded-chip px-1.5 text-xs font-semibold ${failed ? "bg-danger/12 text-danger" : "bg-muted/12 text-muted"}`}>
      {failed ? "Failed" : "Unknown"}
    </span>
  );
}

function StepBody({ step }: { step: Step }) {
  if (step.status === "failed") return <p className="text-danger">{step.error ?? "This step failed."}</p>;
  return (
    <>
      {step.summary && <p className="text-ink">{step.summary}</p>}
      {step.note && <p className="text-muted">{step.note}</p>}
    </>
  );
}

function Sources({ step }: { step: Step }) {
  if (step.sources.length === 0 && !step.checkUrl) return null;
  return (
    <ul className="grid gap-0.5 text-xs text-muted">
      {step.sources.map((src, i) => (
        <li key={`${src.url}-${i}`}>
          Source:{" "}
          <a href={src.url} target="_blank" rel="noreferrer" className={textLink}>
            {src.name}
          </a>
          , read {day(src.fetchedAt)}
        </li>
      ))}
      {step.checkUrl && (
        <li>
          <a href={step.checkUrl} target="_blank" rel="noreferrer" className={textLink}>
            Check by hand
          </a>
        </li>
      )}
    </ul>
  );
}

function Fact({ name, step }: { name: StepName; step: Step }) {
  return (
    <li className={`grid content-start gap-1 border-l-2 pl-3 text-sm ${step.status === "failed" ? "border-danger" : "border-border"}`}>
      <h4 className="font-semibold text-ink">
        {STEP_LABEL[name]}
        <StatusChip step={step} />
      </h4>
      <StepBody step={step} />
      <Sources step={step} />
    </li>
  );
}

function StreetViewBlock({ step, api }: { step: Step<ImageSet>; api?: SiteApi }) {
  const set = step.data;
  const [main, ...rest] = set?.images ?? [];
  return (
    <figure className="grid content-start gap-2 lg:col-span-2" aria-label="Street View">
      {set && api && main ? (
        <>
          <Photo src={api.imageUrl(main.path)} alt={`Street View: ${main.label}`} label={main.label} className="aspect-[8/5]" eager />
          {rest.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {rest.map((img) => (
                <li key={img.path}>
                  <Photo src={api.imageUrl(img.path)} alt={`Street View: ${img.label}`} label={img.label} className="aspect-[8/5]" />
                </li>
              ))}
            </ul>
          )}
          <figcaption className="text-xs text-muted">
            {set.copyright}
            {set.date ? ` · captured ${set.date}` : ""}
          </figcaption>
        </>
      ) : (
        <ImageFallback title="Street View" step={step} connected={!!api} />
      )}
    </figure>
  );
}

function SatelliteBlock({ step, api }: { step: Step<ImageSet>; api?: SiteApi }) {
  const set = step.data;
  // Closest first: it reads best next to the street photo.
  const images = [...(set?.images ?? [])].sort((a, b) => (b.zoom ?? 0) - (a.zoom ?? 0));
  return (
    <figure className="grid content-start gap-2" aria-label="Satellite view">
      {set && api && images.length > 0 ? (
        <>
          <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {images.map((img) => (
              <li key={img.path}>
                <Photo src={api.imageUrl(img.path)} alt={`Satellite view: ${img.label}`} label={img.label} className="aspect-square lg:aspect-[8/5]" />
              </li>
            ))}
          </ul>
          <figcaption className="text-xs text-muted">{set.copyright}</figcaption>
        </>
      ) : (
        <ImageFallback title="Satellite view" step={step} connected={!!api} />
      )}
    </figure>
  );
}

/** A photo with its label laid on the lower edge. */
function Photo(props: { src: string; alt: string; label: string; className: string; eager?: boolean }) {
  return (
    <span className="relative block overflow-hidden bg-surface">
      <img
        src={props.src}
        alt={props.alt}
        loading={props.eager ? "eager" : "lazy"}
        width={640}
        height={400}
        className={`block w-full object-cover ${props.className}`}
      />
      <span aria-hidden className="absolute bottom-0 left-0 bg-bg/90 px-2 py-0.5 text-xs font-medium text-ink">
        {props.label}
      </span>
    </span>
  );
}

function ImageFallback({ title, step, connected }: { title: string; step: Step<ImageSet>; connected: boolean }) {
  return (
    <div className="grid aspect-[8/5] place-content-center gap-1 border border-dashed border-border p-6 text-center text-sm">
      <p className="font-semibold">
        {title}
        <StatusChip step={step} />
      </p>
      {step.data && !connected ? (
        <p className="text-muted">The images load from the site report service, which is not connected here.</p>
      ) : (
        <StepBody step={step} />
      )}
    </div>
  );
}
