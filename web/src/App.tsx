import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { AlertCircle, FileText, Loader2, Upload } from "lucide-react";
import {
  ADU_TYPES,
  CODE_CYCLE,
  JURISDICTIONS,
  RULE_FAMILIES,
  checkSetFile,
  formatBytes,
  readHeader,
  validateProject,
  type AduType,
  type Jurisdiction,
  type ProjectData,
  type ProjectErrors,
} from "./lib/project";
import { checkPermitSet, type CheckSet } from "./lib/check";
import type { CheckResult } from "./lib/engine";
import { Results } from "./Results";
import { Library } from "./Library";

type FileState =
  | { kind: "empty" }
  | { kind: "reading"; name: string }
  | { kind: "ready"; file: File }
  | { kind: "error"; message: string };

type CheckState =
  | { kind: "running" }
  | { kind: "done"; result: CheckResult }
  | { kind: "error"; message: string };

interface Submission {
  project: ProjectData;
  file: File;
  check: CheckState;
}

const EMPTY_PROJECT: ProjectData = { address: "", jurisdiction: "", aduType: "No ADU" };

type View = "check" | "library";

function viewFromHash(): View {
  return typeof window !== "undefined" && window.location.hash.startsWith("#/library") ? "library" : "check";
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const inputBase =
  "h-11 w-full rounded-control border bg-surface px-3 text-base text-ink focus:border-accent " +
  focusRing;

export function App({ checkSet = checkPermitSet }: { checkSet?: CheckSet } = {}) {
  const [project, setProject] = useState<ProjectData>(EMPTY_PROJECT);
  const [errors, setErrors] = useState<ProjectErrors>({});
  const [fileState, setFileState] = useState<FileState>({ kind: "empty" });
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const readId = useRef(0);
  const checkId = useRef(0);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function runCheck(data: ProjectData, file: File) {
    const id = ++checkId.current;
    setSubmission({ project: data, file, check: { kind: "running" } });
    try {
      const result = await checkSet(file, data);
      if (id !== checkId.current) return;
      setSubmission({ project: data, file, check: { kind: "done", result } });
    } catch (err) {
      if (id !== checkId.current) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : "The check failed. Try again, or check that the PDF opens in a PDF reader.";
      setSubmission({ project: data, file, check: { kind: "error", message } });
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const id = ++readId.current;
    setFileState({ kind: "reading", name: file.name });
    try {
      const header = await readHeader(file);
      if (id !== readId.current) return;
      const problem = checkSetFile(file, header);
      setFileState(problem ? { kind: "error", message: problem } : { kind: "ready", file });
    } catch {
      if (id !== readId.current) return;
      setFileState({
        kind: "error",
        message: "We could not read this file. Check that it is not open in another program, then choose it again.",
      });
    }
  }

  function update<K extends keyof ProjectData>(key: K, value: ProjectData[K]) {
    setProject((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateProject(project);
    setErrors(found);
    if (fileState.kind === "empty") {
      setFileState({ kind: "error", message: "Choose the permit set PDF first." });
    }
    if (Object.keys(found).length > 0 || fileState.kind !== "ready") return;
    void runCheck(project, fileState.file);
  }

  /** Checks the same set again as the jurisdiction the set names. */
  function recheck(jurisdiction: string) {
    if (!submission || !(JURISDICTIONS as readonly string[]).includes(jurisdiction)) return;
    const data = { ...submission.project, jurisdiction: jurisdiction as Jurisdiction };
    setProject(data);
    void runCheck(data, submission.file);
  }

  function go(next: View) {
    setView(next);
    if (typeof window !== "undefined") window.location.hash = next === "library" ? "#/library" : "#/check";
  }

  function reset() {
    readId.current++;
    checkId.current++;
    setProject(EMPTY_PROJECT);
    setErrors({});
    setFileState({ kind: "empty" });
    setSubmission(null);
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-14 max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 md:px-8">
          <span className="font-display text-lg font-semibold">arconstructive</span>
          <nav aria-label="Main" className="flex items-center gap-1">
            <a href="#/" className={`inline-flex h-11 items-center px-3 text-sm font-medium text-muted ${focusRing}`}>
              Projects
            </a>
            {(
              [
                ["check", "New check", "#/check"],
                ["library", "Code library", "#/library"],
              ] as const
            ).map(([key, label, href]) => (
              <a
                key={key}
                href={href}
                aria-current={view === key ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(key);
                }}
                className={`inline-flex h-11 items-center px-3 text-sm font-medium ${
                  view === key ? "text-ink underline decoration-accent decoration-2 underline-offset-8" : "text-muted"
                } ${focusRing}`}
              >
                {label}
              </a>
            ))}
          </nav>
          <span className="hidden text-sm text-muted md:inline">Permit-set check · {CODE_CYCLE} California codes</span>
        </div>
      </header>

      {view === "library" ? (
        <main className="mx-auto max-w-[1200px] px-4 py-12 md:px-8 md:py-16">
          <Library />
        </main>
      ) : (
      <main className="mx-auto max-w-[1200px] px-4 py-12 md:px-8 md:py-16">
        <p className="text-xs font-medium text-muted">New check</p>
        <h1 className="mt-2 max-w-[680px] font-display text-[32px] font-semibold leading-[1.1] md:text-[40px]">
          Check a permit set before you submit it
        </h1>
        <p className="mt-4 max-w-[680px] text-lg text-muted">
          Upload the full set as one PDF. We read every sheet and report what a plan checker would send
          back: another city's boilerplate, mixed code years, area mismatches and missing sheets. You
          approve every change.
        </p>

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
          {submission ? (
            submission.check.kind === "done" ? (
              <Results
                result={submission.check.result}
                file={submission.file}
                fileName={submission.file.name}
                onReset={reset}
                onRecheck={recheck}
              />
            ) : (
              <SubmissionSummary
                submission={submission}
                onRetry={() => void runCheck(submission.project, submission.file)}
                onReset={reset}
              />
            )
          ) : (
            <form noValidate onSubmit={submit} className="grid gap-8" aria-label="Check a permit set">
              <fieldset className="grid gap-6">
                <legend className="mb-2 font-display text-2xl font-semibold leading-[1.25]">Project</legend>

                <Field id="address" label="Project address" error={errors.address}>
                  <input
                    id="address"
                    name="address"
                    autoComplete="street-address"
                    value={project.address}
                    onChange={(e) => update("address", e.target.value)}
                    aria-invalid={Boolean(errors.address)}
                    aria-describedby={errors.address ? "address-error" : undefined}
                    className={`${inputBase} ${errors.address ? "border-danger" : "border-border"}`}
                  />
                </Field>

                <div className="grid gap-6 md:grid-cols-2">
                  <Field id="jurisdiction" label="Jurisdiction" error={errors.jurisdiction}>
                    <select
                      id="jurisdiction"
                      name="jurisdiction"
                      value={project.jurisdiction}
                      onChange={(e) => update("jurisdiction", e.target.value as Jurisdiction | "")}
                      aria-invalid={Boolean(errors.jurisdiction)}
                      aria-describedby={errors.jurisdiction ? "jurisdiction-error" : undefined}
                      className={`${inputBase} ${errors.jurisdiction ? "border-danger" : "border-border"}`}
                    >
                      <option value="">Choose a jurisdiction</option>
                      {JURISDICTIONS.map((j) => (
                        <option key={j} value={j}>
                          {j}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field id="adu-type" label="ADU type">
                    <select
                      id="adu-type"
                      name="aduType"
                      value={project.aduType}
                      onChange={(e) => update("aduType", e.target.value as AduType)}
                      className={`${inputBase} border-border`}
                    >
                      {ADU_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <p className="text-sm text-muted">
                  Code cycle: <span className="font-medium text-ink">{CODE_CYCLE} California codes</span>.
                  Occupancy: R-3 and U, with or without an ADU.
                </p>
              </fieldset>

              <fieldset className="grid gap-3">
                <legend className="mb-2 font-display text-2xl font-semibold leading-[1.25]">Permit set</legend>
                <SetDropZone state={fileState} onFile={chooseFile} />
              </fieldset>

              <div>
                <button
                  type="submit"
                  disabled={fileState.kind === "reading"}
                  className={`inline-flex h-11 min-w-44 items-center justify-center rounded-control bg-accent px-6 text-[15px] font-semibold text-on-accent transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] disabled:opacity-40 ${focusRing}`}
                >
                  Start the check
                </button>
              </div>
            </form>
          )}

          <aside className="border-t border-border pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <h2 className="font-display text-2xl font-semibold leading-[1.25]">What we check</h2>
            <ul className="mt-4 divide-y divide-border">
              {RULE_FAMILIES.map((rule) => (
                <li key={rule.code} className="flex gap-3 py-3">
                  <span className="h-fit rounded-chip bg-ink/12 px-1.5 py-0.5 text-xs font-medium text-ink">
                    {rule.code}
                  </span>
                  <span className="text-sm">
                    <span className="font-medium">{rule.name}.</span>{" "}
                    <span className="text-muted">{rule.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted">
              The architect of record approves every finding. We never stamp or sign sheets, and we never
              edit vendor documents.
            </p>
          </aside>
        </div>
      </main>
      )}
    </div>
  );
}

function Field(props: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      {props.children}
      {props.error && (
        <p id={`${props.id}-error`} className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          {props.error}
        </p>
      )}
    </div>
  );
}

function SetDropZone(props: { state: FileState; onFile: (file: File | undefined) => void }) {
  const { state, onFile } = props;
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    onFile(event.dataTransfer.files[0]);
  }

  const border =
    state.kind === "error" ? "border-danger" : dragging ? "border-ink" : "border-border";

  return (
    <div className="grid gap-2">
      <label
        htmlFor="set-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-44 cursor-pointer flex-col items-start justify-center gap-3 border border-dashed p-6 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${border}`}
      >
        <input
          id="set-file"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-describedby="set-file-help"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <DropZoneContent state={state} />
      </label>
      {state.kind === "error" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          {state.message}
        </p>
      )}
    </div>
  );
}

function DropZoneContent({ state }: { state: FileState }) {
  if (state.kind === "reading") {
    return (
      <div className="grid w-full gap-3" aria-live="polite">
        <span className="flex items-center gap-2 text-base">
          <Loader2 aria-hidden className="size-5 motion-safe:animate-spin" strokeWidth={1.5} />
          Reading {state.name}…
        </span>
        <span aria-hidden className="block h-3 w-2/3 bg-surface" />
      </div>
    );
  }
  if (state.kind === "ready") {
    return (
      <div className="grid gap-1" aria-live="polite">
        <span className="flex items-center gap-2 text-base font-medium">
          <FileText aria-hidden className="size-5" strokeWidth={1.5} />
          {state.file.name}
        </span>
        <span className="text-sm text-muted">
          {formatBytes(state.file.size)} · PDF ready. Choose another file to replace it.
        </span>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <span className="flex items-center gap-2 text-base font-medium">
        <Upload aria-hidden className="size-5" strokeWidth={1.5} />
        Drop the permit set here, or choose a file
      </span>
      <span id="set-file-help" className="text-sm text-muted">
        The full set as one PDF, up to 200 MB. Include the survey, Title 24 and structural sheets if you
        have them.
      </span>
    </div>
  );
}

function SubmissionSummary(props: { submission: Submission; onRetry: () => void; onReset: () => void }) {
  const { project, file, check } = props.submission;
  const failed = check.kind === "error";
  const rows: Array<[string, string]> = [
    ["Project address", project.address.trim()],
    ["Jurisdiction", project.jurisdiction],
    ["ADU type", project.aduType],
    ["Code cycle", `${CODE_CYCLE} California codes`],
    ["Permit set", `${file.name} (${formatBytes(file.size)})`],
  ];

  return (
    <section aria-labelledby="summary-title" className="grid content-start gap-6">
      {failed ? (
        <div role="alert" className="flex items-start gap-3 border-l-4 border-danger pl-4">
          <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-danger" strokeWidth={1.5} />
          <div>
            <h2 id="summary-title" className="font-display text-2xl font-semibold leading-[1.25]">
              The check did not finish
            </h2>
            <p className="mt-1 text-muted">{check.message}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 border-l-4 border-accent pl-4" aria-live="polite">
          <Loader2 aria-hidden className="mt-1 size-5 shrink-0 motion-safe:animate-spin" strokeWidth={1.5} />
          <div>
            <h2 id="summary-title" className="font-display text-2xl font-semibold leading-[1.25]">
              Checking the set
            </h2>
            <p className="mt-1 text-muted">
              We read the text of every page, sort the pages by sheet and run the rules. A 50-page set takes
              a few seconds.
            </p>
          </div>
        </div>
      )}

      <dl className="divide-y divide-border border-y border-border">
        {rows.map(([term, value]) => (
          <div key={term} className="grid gap-1 py-3 md:grid-cols-[200px_minmax(0,1fr)] md:gap-4">
            <dt className="text-sm text-muted">{term}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <button
          type="button"
          onClick={props.onReset}
          className={`inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface px-6 text-[15px] font-semibold text-ink ${focusRing}`}
        >
          Check another set
        </button>
      </div>
    </section>
  );
}
