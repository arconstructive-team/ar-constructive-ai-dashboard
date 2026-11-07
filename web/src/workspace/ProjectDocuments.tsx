import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { AlertCircle, Check, ExternalLink, File, FileImage, FileText, Link2, Loader2, Upload } from "lucide-react";
import { fileKind } from "./documents";
import { routeHref } from "./router";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABEL,
  isWebLink,
  type DocumentKind,
  type DocumentStatus,
  type Project,
  type ProjectDocument,
  type WorkspaceStore,
} from "./types";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const inputBase =
  "h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:border-accent " + focusRing;
const selectSmall = "h-11 rounded-control border border-border bg-surface px-2 text-sm text-ink focus:border-accent " + focusRing;
const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent px-5 text-[15px] font-semibold text-on-accent " +
  "transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] disabled:opacity-40 " +
  focusRing;
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-40 " +
  focusRing;
const openLink = `inline-flex min-h-11 items-center gap-1 font-semibold underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`;

type Loadable<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

/** How many documents the project page shows; the Documents page has the rest. */
export const PROJECT_PAGE_DOCUMENTS = 6;

export const documentDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Just now";

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export function documentIcon(doc: ProjectDocument) {
  if (doc.source === "link") return Link2;
  const kind = fileKind(doc.contentType, doc.name);
  if (kind === "Image") return FileImage;
  if (kind === "PDF" || kind === "Text" || kind === "Word document") return FileText;
  return File;
}

/** The host a link points at, e.g. "drive.google.com". */
export function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Opens a document: a link goes straight to its address in a new tab; an upload asks the store
 * for a download address first.
 */
export function OpenDocument(props: { store: WorkspaceStore; projectId: string; doc: ProjectDocument; onError: (message: string) => void }) {
  const { doc } = props;
  if (doc.source === "link" && doc.url) {
    return (
      <a href={doc.url} target="_blank" rel="noopener noreferrer" className={openLink}>
        Open<span className="sr-only"> {doc.name}</span>
        <ExternalLink aria-hidden className="size-4" strokeWidth={1.5} />
      </a>
    );
  }
  async function open() {
    try {
      window.open(await props.store.documentUrl(props.projectId, doc), "_blank", "noopener");
    } catch (err) {
      props.onError(messageOf(err, `${doc.name} could not be opened. Try again.`));
    }
  }
  return (
    <button type="button" onClick={() => void open()} className={openLink}>
      Open<span className="sr-only"> {doc.name}</span>
      <ExternalLink aria-hidden className="size-4" strokeWidth={1.5} />
    </button>
  );
}

/** The kind and status of a document, saved for the team as soon as someone changes one. */
export function DocumentKindStatus(props: { store: WorkspaceStore; projectId: string; doc: ProjectDocument; by: string }) {
  const { doc } = props;
  const [error, setError] = useState<string | null>(null);
  async function save(patch: { kind?: DocumentKind; status?: DocumentStatus }) {
    setError(null);
    try {
      await props.store.updateDocument(props.projectId, doc.id, patch, props.by);
    } catch (err) {
      setError(messageOf(err, "The change was not saved. Try again."));
    }
  }
  return (
    <span className="grid gap-1">
      <span className="flex flex-wrap gap-2">
        <select
          aria-label={`Kind of ${doc.name}`}
          className={selectSmall}
          value={doc.kind}
          onChange={(e) => void save({ kind: e.target.value as DocumentKind })}
        >
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          aria-label={`Status of ${doc.name}`}
          className={selectSmall}
          value={doc.status}
          onChange={(e) => void save({ status: e.target.value as DocumentStatus })}
        >
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DOCUMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </span>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

export interface LinkInput {
  name: string;
  url: string;
  kind: DocumentKind;
  status: DocumentStatus;
}

/** A form that adds a link to a file kept elsewhere: a shared drive, the city's portal. */
export function AddLinkForm(props: { onAdd: (link: LinkInput) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<DocumentKind>("drawings");
  const [status, setStatus] = useState<DocumentStatus>("draft");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string }>({ kind: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setState({ kind: "error", message: "Enter a title for the link." });
    if (!isWebLink(url)) return setState({ kind: "error", message: "Enter a link that starts with https:// or http://." });
    setState({ kind: "saving" });
    try {
      await props.onAdd({ name: name.trim(), url: url.trim(), kind, status });
    } catch (err) {
      setState({ kind: "error", message: messageOf(err, "The link was not added. Try again.") });
    }
  }

  return (
    <form aria-label="Add a link" onSubmit={(e) => void submit(e)} className="grid gap-4 border border-border bg-surface p-4 md:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium" htmlFor={`${id}-name`}>
        Title
        <input id={`${id}-name`} className={inputBase} value={name} onChange={(e) => setName(e.target.value)} maxLength={300} />
      </label>
      <label className="grid gap-1 text-sm font-medium" htmlFor={`${id}-url`}>
        Link
        <input
          id={`${id}-url`}
          className={inputBase}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={2000}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium" htmlFor={`${id}-kind`}>
        Kind
        <select id={`${id}-kind`} className={inputBase} value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium" htmlFor={`${id}-status`}>
        Status
        <select id={`${id}-status`} className={inputBase} value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus)}>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DOCUMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {state.kind === "error" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger md:col-span-2">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <button type="submit" className={primaryButton} disabled={state.kind === "saving"}>
          {state.kind === "saving" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />}
          Add link
        </button>
        <button type="button" className={secondaryButton} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type UploadState = { kind: "idle" } | { kind: "busy"; name: string } | { kind: "done"; name: string } | { kind: "error"; message: string };

/**
 * The Documents section of the project page: the newest documents with their kind, status and
 * last change, and buttons to upload a file or add a link. "All documents" opens the full page.
 */
export function ProjectDocuments(props: {
  store: WorkspaceStore;
  project: Project;
  by: string;
  onUpload: (file: File) => Promise<string>;
  onAll: () => void;
}) {
  const { store, project } = props;
  const headingId = useId();
  const [docs, setDocs] = useState<Loadable<ProjectDocument[]>>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const [openError, setOpenError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      store.watchDocuments(
        project.id,
        (data) => setDocs({ kind: "ready", data }),
        (e) => setDocs({ kind: "error", message: e.message || "The documents could not load. Reload the page." }),
      ),
    [store, project.id],
  );

  async function add(file: File) {
    setUpload({ kind: "busy", name: file.name });
    try {
      await props.onUpload(file);
      setUpload({ kind: "done", name: file.name });
    } catch (err) {
      setUpload({ kind: "error", message: `${file.name} was not added. ${messageOf(err, "Try again.")}` });
    }
  }

  const list =
    docs.kind === "ready"
      ? [...docs.data].sort((a, b) => (b.updatedAt?.getTime() ?? Infinity) - (a.updatedAt?.getTime() ?? Infinity))
      : [];
  const shown = list.slice(0, PROJECT_PAGE_DOCUMENTS);
  const allHref = routeHref({ projectId: project.id, chatId: null, page: "documents" });

  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink pb-3">
        <div className="grid gap-1">
          <h2 id={headingId} className="font-display text-[32px] font-semibold leading-[1.15]">
            Documents
          </h2>
          <p className="text-sm text-muted">Drawings, surveys, reports, city letters and contracts for this project.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Link2 aria-hidden className="size-4" strokeWidth={1.5} />
            Add link
          </button>
          <button type="button" className={primaryButton} onClick={() => input.current?.click()} disabled={upload.kind === "busy"}>
            <Upload aria-hidden className="size-4" strokeWidth={1.5} />
            Upload file
          </button>
          <input
            ref={input}
            type="file"
            aria-label="File to add to the project"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void add(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {adding && (
        <AddLinkForm
          onCancel={() => setAdding(false)}
          onAdd={async (link) => {
            await store.addLink(project.id, { ...link, addedBy: props.by });
            setAdding(false);
          }}
        />
      )}

      {upload.kind !== "idle" && (
        <p
          role={upload.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 text-sm ${upload.kind === "error" ? "text-danger" : "text-ink"}`}
        >
          {upload.kind === "busy" && <Loader2 aria-hidden className="mt-0.5 size-4 motion-safe:animate-spin" strokeWidth={1.5} />}
          {upload.kind === "done" && <Check aria-hidden className="mt-0.5 size-4 text-success" strokeWidth={2} />}
          {upload.kind === "error" && <AlertCircle aria-hidden className="mt-0.5 size-4" strokeWidth={1.5} />}
          {upload.kind === "busy" ? `Adding ${upload.name}…` : upload.kind === "done" ? `Added ${upload.name}` : upload.message}
        </p>
      )}
      {openError && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          {openError}
        </p>
      )}

      {docs.kind === "loading" && (
        <div role="status" aria-label="Loading the documents" className="grid gap-2">
          <span className="block h-12 animate-pulse bg-surface" />
          <span className="block h-12 animate-pulse bg-surface" />
        </div>
      )}
      {docs.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {docs.message}
        </p>
      )}
      {docs.kind === "ready" && list.length === 0 && (
        <p className="text-muted">No documents yet. Upload a file, or add a link to the drawings, survey or city letters.</p>
      )}
      {shown.length > 0 && (
        <ul aria-label="Documents of the project" className="grid">
          {shown.map((d) => {
            const Icon = documentIcon(d);
            return (
              <li key={d.id} className="grid gap-2 border-b border-border py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-4">
                <span className="flex min-w-0 items-start gap-2">
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />
                  <span className="grid min-w-0">
                    <span className="font-semibold break-words">{d.name}</span>
                    <span className="text-xs text-muted">
                      {d.source === "link" && d.url ? `Link to ${linkHost(d.url)}` : fileKind(d.contentType, d.name)}
                      {` · Updated ${documentDate(d.updatedAt)} · Added by ${d.uploadedBy || "a teammate"}`}
                    </span>
                  </span>
                </span>
                <DocumentKindStatus store={store} projectId={project.id} doc={d} by={props.by} />
                <OpenDocument store={store} projectId={project.id} doc={d} onError={setOpenError} />
              </li>
            );
          })}
        </ul>
      )}
      {docs.kind === "ready" && (
        <a
          href={allHref}
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            props.onAll();
          }}
          className={`${openLink} w-fit`}
        >
          {list.length > shown.length ? `All ${list.length} documents` : "All documents and artifacts"}
        </a>
      )}
    </section>
  );
}
