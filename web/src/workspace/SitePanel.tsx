import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, Info, Loader2, MapPin, RefreshCw } from "lucide-react";
import type { SiteApi } from "../site/siteApi";
import { STEP_LABEL, STEP_NAMES, type ImageSet, type SiteReport, type Step, type StepName } from "../site/types";
import type { Project, WorkspaceStore } from "./types";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-40 " +
  focusRing;
const textLink = `underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`;

/** The state of the last pipeline run started from this browser. */
export type SiteRun = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string };

type Loadable<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

/** The steps shown in the fact list; the two image steps have their own blocks. */
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
    <section aria-labelledby={`site-${project.id}`} className="grid gap-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id={`site-${project.id}`} className="font-display text-xl font-semibold">
            Site
          </h2>
          <p className="flex items-center gap-1 text-sm text-muted">
            <MapPin aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
            {hasAddress ? project.address : "This project has no address."}
          </p>
        </div>
        <button type="button" className={secondaryButton} onClick={onRefresh} disabled={!api || !hasAddress || running}>
          {running ? (
            <Loader2 aria-hidden className="size-4 animate-spin" strokeWidth={1.5} />
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
          <Loader2 aria-hidden className="size-4 animate-spin" strokeWidth={1.5} />
          Gathering photos, parcel, zoning, hazards and climate zone. This takes up to half a minute.
        </p>
      )}
      {run.kind === "error" && <Alert message={`The site info could not be refreshed. ${run.message}`} />}

      {report.kind === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden className="size-4 animate-spin" strokeWidth={1.5} />
          Loading the site report…
        </p>
      )}
      {report.kind === "error" && <Alert message={report.message} />}
      {report.kind === "ready" && !report.data && !running && (
        <p className="text-sm text-muted">
          No site report yet. Press “Refresh site info” to gather Street View and satellite images, the parcel, zoning,
          flood, fire and earthquake zones, elevation and the climate zone for this address.
        </p>
      )}
      {report.kind === "ready" && report.data && <ReportView report={report.data} api={api} />}
    </section>
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
  const failed = STEP_NAMES.filter((n) => report.steps[n].status === "failed");
  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted">Gathered {dateLabel(report.generatedAt)} for {report.address}.</p>

      {failed.length > 0 && (
        <div className="grid gap-1 rounded-sheet border border-danger p-3 text-sm">
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

      <ImageBlock title="Street View" step={report.steps.streetView} api={api} />
      <ImageBlock title="Satellite view" step={report.steps.satellite} api={api} />

      {report.links && (
        <ul aria-label="Open the site in Google" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {(
            [
              ["Open in Google Maps", report.links.maps],
              ["Open in Street View", report.links.streetView],
              ["Open in Google Earth", report.links.earth],
            ] as const
          ).map(([label, href]) => (
            <li key={label}>
              <a href={href} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center gap-1 ${textLink}`}>
                {label}
                <ExternalLink aria-hidden className="size-4" strokeWidth={1.5} />
              </a>
            </li>
          ))}
        </ul>
      )}

      <ul aria-label="Site facts" className="grid gap-4">
        {FACT_STEPS.map((name) => (
          <Fact key={name} name={name} step={report.steps[name]} />
        ))}
      </ul>
    </div>
  );
}

function StatusChip({ step }: { step: Step }) {
  if (step.status === "ok") return null;
  const failed = step.status === "failed";
  return (
    <span
      className={`ml-2 inline-flex rounded-chip border px-1.5 text-xs font-semibold uppercase tracking-wide ${
        failed ? "border-danger text-danger" : "border-border text-muted"
      }`}
    >
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
    <li className={`grid gap-1 border-l-2 pl-3 text-sm ${step.status === "failed" ? "border-danger" : "border-border"}`}>
      <h3 className="font-semibold text-ink">
        {STEP_LABEL[name]}
        <StatusChip step={step} />
      </h3>
      <StepBody step={step} />
      <Sources step={step} />
    </li>
  );
}

function ImageBlock({ title, step, api }: { title: string; step: Step<ImageSet>; api?: SiteApi }) {
  const set = step.data;
  return (
    <figure className="grid gap-2" aria-label={title}>
      <h3 className="font-display text-base font-semibold">
        {title}
        <StatusChip step={step} />
      </h3>
      {set && api ? (
        <>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {set.images.map((img) => (
              <li key={img.path} className="grid gap-1">
                <img
                  src={api.imageUrl(img.path)}
                  alt={`${title}: ${img.label}`}
                  loading="lazy"
                  width={640}
                  height={400}
                  className="aspect-[8/5] w-full rounded-sheet border border-border bg-surface object-cover"
                />
                <span className="text-xs text-muted">{img.label}</span>
              </li>
            ))}
          </ul>
          <figcaption className="text-xs text-muted">
            {set.copyright}
            {set.date ? ` · captured ${set.date}` : ""}
          </figcaption>
        </>
      ) : set ? (
        <p className="text-sm text-muted">The images load from the site report service, which is not connected here.</p>
      ) : (
        <div className="text-sm">
          <StepBody step={step} />
        </div>
      )}
    </figure>
  );
}
