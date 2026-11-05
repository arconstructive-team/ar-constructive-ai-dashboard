import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { RULE_FAMILIES } from "./lib/project";
import { RULE_FAMILY_ORDER, groupBySheet, toCsv, type CheckResult, type Severity } from "./lib/engine";
import { CodeSections } from "./CodeSections";
import { RegeneratedSheets, type RenderPage } from "./Regenerated";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "bg-danger text-on-accent",
  medium: "border border-ink text-ink",
  low: "bg-ink/12 text-muted",
};

const FAMILY_NAME = Object.fromEntries(RULE_FAMILIES.map((f) => [f.code, f.name])) as Record<string, string>;

/** Warns when the set names another jurisdiction than the one the user selected. */
function JurisdictionWarning(props: { result: CheckResult; onRecheck?: (jurisdiction: string) => void }) {
  const check = props.result.jurisdiction;
  if (!check || check.matches || !check.detected) return null;
  const detected = check.detected;
  return (
    <div role="alert" className="flex items-start gap-3 border-l-4 border-danger bg-surface p-4">
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" strokeWidth={1.5} />
      <div className="grid gap-2">
        <p className="font-semibold">
          This set is for {detected}, but you checked it as {check.selected}.
        </p>
        <p className="text-sm text-muted">
          {check.sheet ? `Sheet ${check.sheet}` : "The set"} says: <span className="break-words">“{check.evidence}”</span>.
          The rules and code sections below are for {check.selected}.
        </p>
        {props.onRecheck && (
          <button
            type="button"
            onClick={() => props.onRecheck?.(detected)}
            className={`inline-flex h-11 w-fit items-center justify-center rounded-control bg-accent px-6 text-[15px] font-semibold text-on-accent ${focusRing}`}
          >
            Check again as {detected}
          </button>
        )}
      </div>
    </div>
  );
}

export function Results(props: {
  result: CheckResult;
  file?: File | null;
  fileName: string;
  onReset: () => void;
  /** Checks the same set again as another jurisdiction. */
  onRecheck?: (jurisdiction: string) => void;
  renderPage?: RenderPage;
}) {
  const { result, fileName } = props;
  const groups = useMemo(() => groupBySheet(result.findings), [result.findings]);
  const csvHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(result.findings))}`,
    [result.findings],
  );
  const csvName = `${fileName.replace(/\.pdf$/i, "")}-issues.csv`;
  const total = result.findings.length;

  return (
    <section aria-labelledby="results-title" className="grid content-start gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="results-title" className="font-display text-2xl font-semibold leading-[1.25]">
            {total === 0 ? "No issues found" : `${total} ${total === 1 ? "issue" : "issues"} found`}
          </h2>
          <p className="mt-1 text-muted">
            {fileName} · {result.pages.length} pages · {result.pack_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {total > 0 && (
            <a
              href={csvHref}
              download={csvName}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent px-6 text-[15px] font-semibold text-on-accent transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] ${focusRing}`}
            >
              <Download aria-hidden className="size-4" strokeWidth={1.5} />
              Download CSV
            </a>
          )}
          <button
            type="button"
            onClick={props.onReset}
            className={`inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface px-6 text-[15px] font-semibold text-ink ${focusRing}`}
          >
            Check another set
          </button>
        </div>
      </div>

      <JurisdictionWarning result={result} onRecheck={props.onRecheck} />

      <ul aria-label="Issues per rule family" className="flex flex-wrap gap-2">
        {RULE_FAMILY_ORDER.map((family) => (
          <li
            key={family}
            title={FAMILY_NAME[family]}
            className="flex items-center gap-1.5 rounded-chip border border-border bg-surface px-2 py-1 text-sm"
          >
            <span className="font-medium">{family}</span>
            <span className="text-muted">{FAMILY_NAME[family]}</span>
            <span data-testid={`count-${family}`} className="font-semibold">
              {result.counts[family]}
            </span>
          </li>
        ))}
      </ul>

      {total === 0 ? (
        <div className="flex items-start gap-3 border-l-4 border-success pl-4">
          <CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0 text-success" strokeWidth={1.5} />
          <p className="text-muted">
            The rules found nothing to fix in this set. Read the sheet list below to check that every page
            was recognised.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          {groups.map((group) => (
            <section
              key={group.sheet}
              aria-labelledby={`sheet-${group.sheet}`}
              className="border-t border-border pt-4"
            >
              <h3 id={`sheet-${group.sheet}`} className="font-display text-lg font-semibold">
                {group.sheet}
                {group.page !== null && (
                  <span className="ml-2 text-sm font-normal text-muted">page {group.page}</span>
                )}
              </h3>
              <ul className="mt-3 grid gap-4">
                {group.findings.map((f, i) => (
                  <li key={`${f.rule_id}-${i}`} className="grid gap-2 rounded-control border border-border bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-chip px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[f.severity]}`}>
                        {f.severity === "high" ? "High" : f.severity === "medium" ? "Medium" : "Low"}
                      </span>
                      <span className="text-xs font-medium text-muted">{f.rule_id}</span>
                      <span className="font-medium">{f.title}</span>
                    </div>
                    {f.sheets.length > 1 && (
                      <p className="text-sm text-muted">Sheets: {f.sheets.join(", ")}</p>
                    )}
                    <p className="text-sm">
                      <span className="font-medium">Evidence: </span>
                      <span className="break-words">{f.evidence}</span>
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Suggested fix: </span>
                      {f.suggested_fix}
                    </p>
                    <CodeSections citations={f.citations ?? []} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {result.missing.length > 0 && (
        <section aria-labelledby="missing-title" className="grid gap-3">
          <h3 id="missing-title" className="flex items-center gap-2 font-display text-lg font-semibold">
            <AlertTriangle aria-hidden className="size-5" strokeWidth={1.5} />
            Missing from the set
          </h3>
          <ul className="divide-y divide-border border-y border-border">
            {result.missing.map((m) => (
              <li key={m.item} className="grid gap-1 py-3 md:grid-cols-[200px_minmax(0,1fr)] md:gap-4">
                <span className="font-medium">{m.item}</span>
                <span className="text-sm text-muted">
                  {m.reason}
                  {m.cited_on.length > 0 && ` Cited on ${m.cited_on.join(", ")}.`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RegeneratedSheets result={result} file={props.file ?? null} fileName={fileName} renderPage={props.renderPage} />

      <details className="border-t border-border pt-4">
        <summary className={`cursor-pointer text-sm font-medium ${focusRing}`}>
          How we read the {result.pages.length} pages
        </summary>
        <ul className="mt-3 grid gap-1 text-sm">
          {result.pages.map((p) => (
            <li key={p.page} className="grid grid-cols-[64px_120px_minmax(0,1fr)] gap-2">
              <span className="text-muted">Page {p.page}</span>
              <span className="font-medium">{p.label}</span>
              <span className="truncate text-muted">{p.title}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
