import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDown, Calendar, ChevronDown, Download, Loader2, Pencil, X } from "lucide-react";
import { CANVAS_CLASS, DocumentView } from "./DocumentView";
import { Menu, focusRing } from "./Menu";
import { lastHeading, parseMarkdown, plainText, serializeMarkdown, type Block } from "./markdown";
import { downloadFile, exportFileName, formatDate, type ExportMeta } from "./exportMeta";
import {
  KIND_LABEL,
  type Artifact,
  type ArtifactKind,
  type ArtifactSource,
  type ArtifactVersion,
} from "./types";

const ArtifactEditor = lazy(() => import("./ArtifactEditor"));

export type ExportFormat = "pdf" | "docx";

export type Exporters = Record<ExportFormat, (blocks: Block[], meta: ExportMeta) => Promise<Blob>>;

export const defaultExporters: Exporters = {
  pdf: async (blocks, meta) => {
    const { buildPdf } = await import("./exportPdf");
    return new Blob([buildPdf(blocks, meta)], { type: "application/pdf" });
  },
  docx: async (blocks, meta) => {
    const { buildDocx } = await import("./exportDocx");
    return buildDocx(blocks, meta);
  },
};

export interface ArtifactPaneProps {
  source: ArtifactSource;
  projectId: string;
  artifactId: string;
  /** Shown in the export title block. */
  projectName: string;
  /** The signed-in person's name. Saved versions carry it. */
  editorName: string;
  exporters?: Exporters;
  download?: (file: Blob, fileName: string) => void;
  onClose?: () => void;
}

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; artifact: Artifact };

type Mode =
  | { kind: "view" }
  | { kind: "edit"; title: string; draft: string; dirty: boolean; keepTitleHeading: boolean };

type Versions = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; list: ArtifactVersion[] } | { kind: "error" };

type Notice = { tone: "success" | "danger"; text: string };

const secondaryButton =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 text-[15px] font-semibold text-ink disabled:opacity-40 md:px-4";
const ghostButton =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control px-3 text-[15px] font-semibold text-ink hover:bg-surface disabled:opacity-40";
const primaryButton =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-accent px-4 text-[15px] font-semibold text-on-accent transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] disabled:opacity-40";

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Splits off a leading "# Title" that repeats the artifact title, since the pane shows the title itself. */
export function splitTitle(content: string, title: string): { blocks: Block[]; hadTitle: boolean } {
  const blocks = parseMarkdown(content);
  const first = blocks[0];
  if (first && first.type === "heading" && first.level === 1 && sameTitle(plainText(first.content), title)) {
    return { blocks: blocks.slice(1), hadTitle: true };
  }
  return { blocks, hadTitle: false };
}

function composeContent(title: string, body: string, keepTitleHeading: boolean): string {
  const trimmed = body.replace(/^\s+/, "");
  return keepTitleHeading ? `# ${title}\n\n${trimmed}` : trimmed;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-chip bg-ink/8 px-2 text-xs font-medium text-ink">
      {children}
    </span>
  );
}

function DocumentHeader(props: {
  title: ReactNode;
  date: Date | null;
  author: string;
  kind: ArtifactKind;
  version: number;
}) {
  return (
    <header>
      {props.title}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {props.date && (
          <Chip>
            <Calendar aria-hidden className="size-3.5" strokeWidth={1.5} />
            {formatDate(props.date)}
          </Chip>
        )}
        {props.author && <Chip>@{props.author}</Chip>}
        <Chip>{KIND_LABEL[props.kind]}</Chip>
        {props.version > 0 && <Chip>Version {props.version}</Chip>}
      </div>
    </header>
  );
}

const titleClass = "font-document text-[32px] font-semibold leading-[1.15] text-ink md:text-[40px]";

function CanvasSkeleton({ label }: { label: string }) {
  return (
    <div className={CANVAS_CLASS} aria-busy="true">
      <p className="sr-only">{label}</p>
      <span aria-hidden className="block h-10 w-2/3 bg-surface motion-safe:animate-pulse" />
      <span aria-hidden className="mt-4 block h-7 w-48 bg-surface motion-safe:animate-pulse" />
      <span aria-hidden className="mt-10 block h-4 w-full bg-surface motion-safe:animate-pulse" />
      <span aria-hidden className="mt-3 block h-4 w-11/12 bg-surface motion-safe:animate-pulse" />
      <span aria-hidden className="mt-3 block h-4 w-4/5 bg-surface motion-safe:animate-pulse" />
    </div>
  );
}

function GeneratingIndicator({ section }: { section: string | null }) {
  return (
    <div className="mt-8 grid gap-3">
      <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium text-muted">
        <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />
        {section ? `Writing “${section}”…` : "Writing the first section…"}
      </p>
      <span aria-hidden className="block h-3.5 w-full bg-surface motion-safe:animate-pulse" />
      <span aria-hidden className="block h-3.5 w-10/12 bg-surface motion-safe:animate-pulse" />
      <span aria-hidden className="block h-3.5 w-7/12 bg-surface motion-safe:animate-pulse" />
    </div>
  );
}

/**
 * The right-hand artifact pane: the generated deliverable of a chat as a
 * document. It renders live while the artifact generates, lets the team edit
 * it and save versions, and exports it as PDF or Word.
 */
export function ArtifactPane(props: ArtifactPaneProps) {
  const { source, projectId, artifactId, projectName, editorName } = props;
  const exporters = props.exporters ?? defaultExporters;
  const download = props.download ?? downloadFile;
  const ref = useMemo(() => ({ projectId, artifactId }), [projectId, artifactId]);

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [viewing, setViewing] = useState<ArtifactVersion | null>(null);
  const [versions, setVersions] = useState<Versions>({ kind: "idle" });
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [busy, setBusy] = useState<null | "save" | "restore" | ExportFormat>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoad({ kind: "loading" });
    setViewing(null);
    setMode({ kind: "view" });
    setVersions({ kind: "idle" });
    setNotice(null);
    return source.watch(
      ref,
      (artifact) => setLoad(artifact ? { kind: "ready", artifact } : { kind: "missing" }),
      () =>
        setLoad({
          kind: "error",
          message: "We could not load this artifact. Check your connection, then reload the page.",
        }),
    );
  }, [source, ref]);

  const artifact = load.kind === "ready" ? load.artifact : null;
  const generating = artifact?.status === "generating";

  const shown = viewing
    ? { title: viewing.title, content: viewing.content, updatedBy: viewing.updatedBy, updatedAt: viewing.updatedAt, version: viewing.version }
    : artifact
      ? { title: artifact.title, content: artifact.content, updatedBy: artifact.updatedBy, updatedAt: artifact.updatedAt, version: artifact.version }
      : null;

  const blocks = useMemo(() => (shown ? splitTitle(shown.content, shown.title).blocks : []), [shown?.content, shown?.title]);

  // A new generation always starts by following the text.
  useEffect(() => {
    if (generating) setFollow(true);
  }, [generating]);

  // Keep the newest text in sight while it streams, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !generating || !follow || viewing || mode.kind === "edit") return;
    el.scrollTop = el.scrollHeight;
  }, [artifact?.content, generating, follow, viewing, mode.kind]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || !generating) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  function jumpToLatest() {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function loadVersions() {
    setVersions({ kind: "loading" });
    try {
      setVersions({ kind: "ready", list: await source.listVersions(ref) });
    } catch {
      setVersions({ kind: "error" });
    }
  }

  function startEdit() {
    if (!artifact || generating) return;
    const { blocks: body, hadTitle } = splitTitle(artifact.content, artifact.title);
    setViewing(null);
    setNotice(null);
    setMode({
      kind: "edit",
      title: artifact.title,
      draft: serializeMarkdown(body),
      dirty: false,
      keepTitleHeading: hadTitle,
    });
  }

  async function save() {
    if (!artifact || mode.kind !== "edit") return;
    const title = mode.title.trim() || artifact.title;
    setBusy("save");
    try {
      const version = await source.saveVersion(ref, {
        title,
        content: composeContent(title, mode.draft, mode.keepTitleHeading),
        updatedBy: editorName,
        baseVersion: artifact.version,
      });
      setMode({ kind: "view" });
      setVersions({ kind: "idle" });
      setNotice({ tone: "success", text: `Saved version ${version}.` });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "The save failed. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function restore(version: ArtifactVersion) {
    if (!artifact) return;
    setBusy("restore");
    try {
      const saved = await source.saveVersion(ref, {
        title: version.title,
        content: version.content,
        updatedBy: editorName,
        baseVersion: artifact.version,
        restoredFrom: version.version,
      });
      setViewing(null);
      setVersions({ kind: "idle" });
      setNotice({ tone: "success", text: `Restored version ${version.version} as version ${saved}.` });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "The restore failed. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function exportAs(format: ExportFormat) {
    if (!shown || !artifact) return;
    const meta: ExportMeta = {
      title: shown.title,
      projectName,
      date: shown.updatedAt ?? new Date(),
      author: shown.updatedBy,
      version: shown.version,
    };
    setBusy(format);
    setNotice(null);
    try {
      const file = await exporters[format](blocks, meta);
      download(file, exportFileName(meta, format));
    } catch {
      setNotice({
        tone: "danger",
        text: `We could not make the ${format === "pdf" ? "PDF" : "Word"} file. Try again.`,
      });
    } finally {
      setBusy(null);
    }
  }

  if (load.kind !== "ready" || !artifact || !shown) {
    return (
      <section aria-label="Artifact" className="flex h-full min-h-0 flex-col bg-bg text-ink">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          {load.kind === "loading" && <span className="block h-4 w-48 bg-surface motion-safe:animate-pulse" aria-hidden />}
        </div>
        {load.kind === "loading" && <CanvasSkeleton label="Loading the artifact…" />}
        {(load.kind === "missing" || load.kind === "error") && (
          <div className={CANVAS_CLASS}>
            <div role="alert" className="flex items-start gap-3 border-l-4 border-danger pl-4">
              <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-danger" strokeWidth={1.5} />
              <p>
                {load.kind === "missing"
                  ? "This artifact was deleted, or you no longer have access to it. Ask the project owner to share it again."
                  : load.message}
              </p>
            </div>
          </div>
        )}
      </section>
    );
  }

  const editing = mode.kind === "edit";
  const versionItems =
    versions.kind === "ready"
      ? (versions.list.length
          ? versions.list
          : [
              {
                version: artifact.version,
                title: artifact.title,
                content: artifact.content,
                updatedBy: artifact.updatedBy,
                updatedAt: artifact.updatedAt,
              },
            ]
        ).map((v) => ({
          key: String(v.version),
          label: `Version ${v.version}${v.version === artifact.version ? " (current)" : ""}`,
          hint: [v.updatedBy, v.updatedAt ? formatDate(v.updatedAt) : "", v.restoredFrom ? `restored version ${v.restoredFrom}` : ""]
            .filter(Boolean)
            .join(" · "),
          current: viewing ? viewing.version === v.version : v.version === artifact.version,
          onSelect: () => setViewing(v.version === artifact.version ? null : v),
        }))
      : [];

  const editorHeader =
    mode.kind === "edit" ? (
      <DocumentHeader
        title={
          <input
            aria-label="Title"
            value={mode.title}
            disabled={generating}
            onChange={(event) => setMode({ ...mode, title: event.target.value, dirty: true })}
            className={`w-full border-b border-transparent bg-transparent ${titleClass} focus:border-accent ${focusRing}`}
          />
        }
        date={new Date()}
        author={editorName}
        kind={artifact.kind}
        version={artifact.version + 1}
      />
    ) : null;

  return (
    <section aria-label="Artifact" className="flex h-full min-h-0 flex-col bg-bg text-ink">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
        <Menu
          label={`Versions of ${artifact.title}`}
          title="Versions"
          disabled={editing}
          onOpen={() => void loadVersions()}
          buttonClassName="inline-flex h-11 min-w-0 max-w-full items-center gap-1 rounded-control px-2 text-[15px] font-medium text-ink hover:bg-surface disabled:opacity-100"
          trigger={
            <>
              <span className="truncate">{artifact.title}</span>
              {!editing && <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" strokeWidth={1.5} />}
            </>
          }
          status={
            versions.kind === "loading"
              ? "Loading versions…"
              : versions.kind === "error"
                ? "We could not load the versions. Close this menu and try again."
                : undefined
          }
          items={versionItems}
        />
        {generating && (
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-chip bg-accent/12 px-2 text-xs font-medium text-ink">
            <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" strokeWidth={1.5} />
            Generating
          </span>
        )}
        {artifact.status === "error" && (
          <span className="inline-flex h-7 shrink-0 items-center rounded-chip bg-danger/12 px-2 text-xs font-medium text-danger">
            Stopped
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
          {editing ? (
            <>
              <button type="button" onClick={() => setMode({ kind: "view" })} className={`${ghostButton} ${focusRing}`}>
                Discard<span className="sr-only md:not-sr-only"> changes</span>
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy === "save" || generating || !mode.dirty}
                className={`${primaryButton} ${focusRing}`}
              >
                {busy === "save" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />}
                Save version
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEdit}
                disabled={generating || viewing !== null}
                title={generating ? "Editing opens when the artifact finishes generating." : undefined}
                className={`${secondaryButton} ${focusRing}`}
              >
                <Pencil aria-hidden className="size-4" strokeWidth={1.5} />
                <span className="sr-only md:not-sr-only">Edit</span>
              </button>
              <Menu
                label="Export"
                align="right"
                disabled={generating || busy === "pdf" || busy === "docx" || blocks.length === 0}
                title={generating ? "Export opens when the artifact finishes generating." : undefined}
                buttonClassName={secondaryButton}
                trigger={
                  <>
                    {busy === "pdf" || busy === "docx" ? (
                      <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />
                    ) : (
                      <Download aria-hidden className="size-4" strokeWidth={1.5} />
                    )}
                    <span className="sr-only md:not-sr-only">Export</span>
                    <ChevronDown aria-hidden className="size-4" strokeWidth={1.5} />
                  </>
                }
                items={[
                  { key: "pdf", label: "Export as PDF", hint: "Print-ready, US Letter", onSelect: () => void exportAs("pdf") },
                  { key: "docx", label: "Export as Word (.docx)", hint: "Editable in Word or Google Docs", onSelect: () => void exportAs("docx") },
                ]}
              />
            </>
          )}
          {props.onClose && (
            <button type="button" aria-label="Close the artifact" onClick={props.onClose} className={`${ghostButton} w-11 px-0 ${focusRing}`}>
              <X aria-hidden className="size-5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role={notice.tone === "danger" ? "alert" : "status"}
          className={`flex shrink-0 items-start gap-3 border-b border-border border-l-4 px-4 py-2 text-sm ${
            notice.tone === "danger" ? "border-l-danger" : "border-l-success"
          }`}
        >
          <p className="flex-1 py-2">{notice.text}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
            className={`inline-flex size-11 shrink-0 items-center justify-center rounded-control ${focusRing}`}
          >
            <X aria-hidden className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {viewing && !editing && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 text-sm">
          <p className="min-w-0 flex-1">
            You are viewing version {viewing.version}
            {viewing.updatedBy ? `, saved by ${viewing.updatedBy}` : ""}
            {viewing.updatedAt ? ` on ${formatDate(viewing.updatedAt)}` : ""}.
          </p>
          <button type="button" onClick={() => setViewing(null)} className={`${ghostButton} ${focusRing}`}>
            Back to current
          </button>
          <button
            type="button"
            onClick={() => void restore(viewing)}
            disabled={generating || busy === "restore"}
            className={`${primaryButton} ${focusRing}`}
          >
            Restore this version
          </button>
        </div>
      )}

      {editing && generating && (
        <p role="alert" className="shrink-0 border-b border-border border-l-4 border-l-danger px-4 py-3 text-sm">
          A new generation started. Editing is locked until it finishes; your changes stay here.
        </p>
      )}

      <div ref={scrollRef} onScroll={onScroll} data-testid="artifact-scroll" className="relative min-h-0 flex-1 overflow-y-auto">
        {mode.kind === "edit" ? (
          <Suspense fallback={<CanvasSkeleton label="Opening the editor…" />}>
            <ArtifactEditor
              initialMarkdown={mode.draft}
              locked={generating}
              header={editorHeader}
              onChange={(draft) => setMode((current) => (current.kind === "edit" ? { ...current, draft, dirty: true } : current))}
            />
          </Suspense>
        ) : (
          <div className={CANVAS_CLASS}>
            <DocumentHeader
              title={<h1 className={titleClass}>{shown.title}</h1>}
              date={shown.updatedAt}
              author={shown.updatedBy}
              kind={artifact.kind}
              version={shown.version}
            />
            {artifact.status === "error" && !viewing && (
              <div role="alert" className="mt-8 flex items-start gap-3 border-l-4 border-danger pl-4">
                <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-danger" strokeWidth={1.5} />
                <div>
                  <p className="font-semibold">Generation stopped before the artifact was finished.</p>
                  <p className="text-muted">
                    {artifact.error ?? "Ask for it again in the chat. You can still edit and export what is here."}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-10">
              {blocks.length > 0 ? (
                <DocumentView blocks={blocks} streaming={generating && !viewing} />
              ) : (
                !generating && (
                  <p className="text-muted">This artifact has no text yet. Select Edit to write it, or ask for it in the chat.</p>
                )
              )}
              {generating && !viewing && <GeneratingIndicator section={lastHeading(blocks)} />}
            </div>
          </div>
        )}
        {generating && !follow && !viewing && !editing && (
          <div className="pointer-events-none sticky bottom-4 flex justify-center">
            <button type="button" onClick={jumpToLatest} className={`pointer-events-auto ${secondaryButton} ${focusRing}`}>
              <ArrowDown aria-hidden className="size-4" strokeWidth={1.5} />
              Jump to latest
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
