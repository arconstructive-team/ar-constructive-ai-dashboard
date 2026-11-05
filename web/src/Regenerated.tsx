import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, FileWarning } from "lucide-react";
import { regeneratedPdfDataUrl, type CheckResult, type Finding, type RegeneratedSheet } from "./lib/engine";
import { CodeSections } from "./CodeSections";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Draws one page of the uploaded set on a canvas. Tests pass a stub. */
export type RenderPage = (file: File, page: number, canvas: HTMLCanvasElement) => Promise<void>;

const renderWithPdfjs: RenderPage = async (file, page, canvas) => {
  const { renderPdfPage } = await import("./lib/pdf");
  await renderPdfPage(file, page, canvas);
};

function onSheet(findings: Finding[], sheet: string): Finding[] {
  return findings.filter((f) => f.sheets.includes(sheet));
}

function OriginalPage(props: { file: File | null; sheet: RegeneratedSheet; renderPage: RenderPage }) {
  const { file, sheet, renderPage } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!file || sheet.original_page === null || !canvas.current) return;
    let live = true;
    setStatus("loading");
    renderPage(file, sheet.original_page, canvas.current).then(
      () => live && setStatus("ready"),
      () => live && setStatus("error"),
    );
    return () => {
      live = false;
    };
  }, [file, sheet.original_page, renderPage]);

  if (sheet.original_page === null) {
    return <p className="text-sm text-muted">The uploaded set has no sheet {sheet.sheet}. The regenerated sheet is new.</p>;
  }
  if (!file) {
    return <p className="text-sm text-muted">The page preview needs the uploaded file. Check the set again to see it.</p>;
  }
  return (
    <div className="relative overflow-hidden rounded-control border border-border bg-surface">
      {status === "loading" && (
        <div role="status" aria-label={`Loading page ${sheet.original_page}`} className="aspect-[17/11] w-full animate-pulse bg-ink/12" />
      )}
      {status === "error" && (
        <p role="alert" className="flex items-center gap-2 p-4 text-sm text-danger">
          <FileWarning aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
          We could not draw page {sheet.original_page} of the uploaded set.
        </p>
      )}
      <canvas
        ref={canvas}
        aria-label={`Original sheet ${sheet.sheet}, page ${sheet.original_page}`}
        className={status === "ready" ? "block h-auto w-full" : "hidden"}
      />
    </div>
  );
}

function FindingList(props: { title: string; findings: Finding[]; empty: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold">{props.title}</p>
      {props.findings.length === 0 ? (
        <p className="text-sm text-muted">{props.empty}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {props.findings.map((f, i) => (
            <li key={`${f.rule_id}-${i}`}>
              <span className="font-medium">{f.rule_id}</span> <span className="text-muted">{f.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RegeneratedSheets(props: {
  result: CheckResult;
  file: File | null;
  fileName: string;
  renderPage?: RenderPage;
}) {
  const { result, file, fileName, renderPage = renderWithPdfjs } = props;
  const set = result.regenerated ?? null;
  const [selected, setSelected] = useState(0);
  const download = useMemo(() => {
    if (!set) return { href: null, error: null };
    try {
      return { href: regeneratedPdfDataUrl(set), error: null };
    } catch {
      return { href: null, error: "We could not build the PDF of the regenerated sheets." };
    }
  }, [set]);

  if (!set || set.sheets.length === 0) {
    return (
      <section aria-labelledby="regenerated-title" className="grid gap-3 border-t border-border pt-4">
        <h3 id="regenerated-title" className="font-display text-lg font-semibold">Regenerated sheets</h3>
        <p className="text-sm text-muted">
          No sheets were regenerated. We need an architectural cover sheet (A-0.1) to read the project data from.
        </p>
      </section>
    );
  }

  const sheet = set.sheets[Math.min(selected, set.sheets.length - 1)];
  const before = onSheet(result.findings, sheet.sheet);
  const after = onSheet(set.findings, sheet.sheet);
  const remaining = new Set(after.map((f) => f.rule_id));
  const fixed = before.filter((f) => !remaining.has(f.rule_id));

  return (
    <section aria-labelledby="regenerated-title" className="grid gap-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="regenerated-title" className="font-display text-lg font-semibold">Regenerated sheets</h3>
          <p className="mt-1 text-sm text-muted">
            Cover data and notes written again for {set.address} under the {set.code_cycle} codes ({set.pack_name}).
          </p>
        </div>
        {download.href ? (
          <a
            href={download.href}
            download={`${fileName.replace(/\.pdf$/i, "")}-regenerated.pdf`}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent px-6 text-[15px] font-semibold text-on-accent transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] ${focusRing}`}
          >
            <Download aria-hidden className="size-4" strokeWidth={1.5} />
            Download regenerated sheets (PDF)
          </a>
        ) : (
          <p role="alert" className="text-sm text-danger">{download.error}</p>
        )}
      </div>

      <div role="group" aria-label="Choose a sheet" className="flex flex-wrap gap-2">
        {set.sheets.map((s, i) => (
          <button
            key={s.sheet}
            type="button"
            aria-pressed={s.sheet === sheet.sheet}
            onClick={() => setSelected(i)}
            className={`h-9 rounded-chip border px-3 text-sm font-medium ${
              s.sheet === sheet.sheet ? "border-accent bg-accent text-on-accent" : "border-border bg-surface text-ink"
            } ${focusRing}`}
          >
            {s.sheet}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label={`Original ${sheet.sheet}`} className="grid content-start gap-3">
          <p className="text-sm font-semibold">
            Original
            {sheet.original_page !== null && <span className="font-normal text-muted"> · page {sheet.original_page}</span>}
          </p>
          <OriginalPage key={sheet.sheet} file={file} sheet={sheet} renderPage={renderPage} />
          <FindingList title="Issues on the original" findings={before} empty="The check found no issues on this sheet." />
        </section>

        <section aria-label={`Regenerated ${sheet.sheet}`} className="grid content-start gap-3">
          <p className="text-sm font-semibold">
            Regenerated <span className="font-normal text-muted">· {sheet.title}</span>
          </p>
          <div className="max-h-[560px] overflow-auto rounded-control border border-border bg-surface p-4 text-xs leading-relaxed">
            {sheet.sections.map((section) => (
              <div key={section.heading} className="mb-3">
                <p className="font-semibold">{section.heading}</p>
                {section.lines.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            ))}
            <p className="border-t border-border pt-2 text-muted">
              {sheet.sheet} · {sheet.date}
              {sheet.job ? ` · job ${sheet.job}` : ""} · {sheet.address.join(" ")}
            </p>
          </div>
          {sheet.citations && sheet.citations.length > 0 && (
            <details className="text-sm">
              <summary className={`cursor-pointer font-medium ${focusRing}`}>
                Code sections on this sheet ({sheet.citations.length})
              </summary>
              <div className="mt-2">
                <CodeSections citations={sheet.citations} label={`Code sections cited on ${sheet.sheet}`} />
              </div>
            </details>
          )}
          {fixed.length > 0 && (
            <div className="flex items-start gap-2 border-l-4 border-success pl-3">
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.5} />
              <FindingList title="Fixed in the regenerated sheet" findings={fixed} empty="" />
            </div>
          )}
          <FindingList
            title="Still to check"
            findings={after}
            empty="The check finds no issues on the regenerated sheet."
          />
        </section>
      </div>

      {set.to_confirm.length > 0 && (
        <details className="text-sm">
          <summary className={`cursor-pointer font-medium ${focusRing}`}>
            Check before you issue these sheets ({set.to_confirm.length})
          </summary>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted">
            {set.to_confirm.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
