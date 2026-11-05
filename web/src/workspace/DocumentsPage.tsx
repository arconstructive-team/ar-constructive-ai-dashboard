import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { AlertCircle, ArrowLeft, Check, ExternalLink, File, FileImage, FileSpreadsheet, FileText, Loader2, Upload } from "lucide-react";
import { fileKind, formatSize } from "./documents";
import { routeHref } from "./router";
import { KIND_LABEL, type Chat, type Project, type ProjectDocument, type WorkspaceArtifact, type WorkspaceStore } from "./types";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent px-5 text-[15px] font-semibold text-on-accent " +
  "transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] disabled:opacity-40 " +
  focusRing;

type Loadable<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };
type Filter = "all" | "uploads" | "artifacts";
type Upload = { key: string; name: string; state: "uploading" | "done" | "error"; message?: string };

/** One row of the list: an uploaded file or an artifact, with what the table shows. */
interface Row {
  key: string;
  name: string;
  kind: string;
  from: string;
  date: Date | null;
  readable: string;
  icon: typeof File;
  open: { href: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } | { file: ProjectDocument };
}

const dateLabel = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Just now";

function iconFor(doc: ProjectDocument) {
  const kind = fileKind(doc.contentType, doc.name);
  if (kind === "Image") return FileImage;
  if (kind === "Spreadsheet") return FileSpreadsheet;
  if (kind === "PDF" || kind === "Text" || kind === "Word document") return FileText;
  return File;
}

function follow(event: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go();
}

/**
 * The project's documents: files the team uploads here (or with a chat's + button) and every
 * artifact the assistant wrote in any chat. In a chat, Sources attaches any of them to a message.
 */
export function DocumentsPage(props: {
  store: WorkspaceStore;
  project: Project;
  chats: Chat[];
  onUpload: (file: File) => Promise<string>;
  onProject: () => void;
  onArtifact: (chatId: string, artifactId: string) => void;
}) {
  const { store, project } = props;
  const [docs, setDocs] = useState<Loadable<ProjectDocument[]>>({ kind: "loading" });
  const [artifacts, setArtifacts] = useState<Loadable<WorkspaceArtifact[]>>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("all");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
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
  useEffect(
    () =>
      store.watchProjectArtifacts(
        project.id,
        (data) => setArtifacts({ kind: "ready", data }),
        (e) => setArtifacts({ kind: "error", message: e.message || "The artifacts could not load. Reload the page." }),
      ),
    [store, project.id],
  );

  async function add(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
      setUploads((u) => [{ key, name: file.name, state: "uploading" }, ...u]);
      try {
        await props.onUpload(file);
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: "done" } : x)));
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : "The file could not be uploaded. Try again.";
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: "error", message } : x)));
      }
    }
  }

  async function openFile(doc: ProjectDocument) {
    setOpenError(null);
    try {
      window.open(await store.documentUrl(project.id, doc), "_blank", "noopener");
    } catch (err) {
      setOpenError(err instanceof Error && err.message ? err.message : `${doc.name} could not be opened. Try again.`);
    }
  }

  const chatTitle = (id: string) => props.chats.find((c) => c.id === id)?.title ?? "a chat";
  const uploadRows: Row[] =
    docs.kind === "ready"
      ? docs.data.map((d) => ({
          key: `doc:${d.id}`,
          name: d.name,
          kind: `${fileKind(d.contentType, d.name)}, ${formatSize(d.size)}`,
          from: d.chatId ? `${d.uploadedBy || "A teammate"} in ${chatTitle(d.chatId)}` : d.uploadedBy || "A teammate",
          date: d.createdAt,
          readable: d.pageCount > 0 ? `${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}${d.truncated ? ", first part" : ""}` : "No text",
          icon: iconFor(d),
          open: { file: d },
        }))
      : [];
  const artifactRows: Row[] =
    artifacts.kind === "ready"
      ? artifacts.data.map((a) => ({
          key: `artifact:${a.id}`,
          name: a.title,
          kind: `${KIND_LABEL[a.kind]}, version ${a.version}`,
          from: a.chatId ? `The assistant in ${chatTitle(a.chatId)}` : "Site info for the project address",
          date: a.updatedAt,
          readable: a.status === "ready" ? "Full text" : a.status === "generating" ? "Being written" : "Stopped",
          icon: FileText,
          open: {
            href: routeHref({ projectId: project.id, chatId: a.chatId || null, artifactId: a.id }),
            onClick: (e: MouseEvent<HTMLAnchorElement>) => follow(e, () => props.onArtifact(a.chatId, a.id)),
          },
        }))
      : [];
  const rows = (filter === "uploads" ? uploadRows : filter === "artifacts" ? artifactRows : [...uploadRows, ...artifactRows]).sort(
    (a, b) => (b.date?.getTime() ?? Infinity) - (a.date?.getTime() ?? Infinity),
  );
  const loading = docs.kind === "loading" || artifacts.kind === "loading";

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void add(event.dataTransfer.files);
  }

  return (
    <div className="grid gap-10">
      <header className="grid gap-4">
        <a
          href={routeHref({ projectId: project.id, chatId: null })}
          onClick={(e) => follow(e, props.onProject)}
          className={`inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted hover:text-ink ${focusRing}`}
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.5} />
          {project.name}
        </a>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-2">
            <h1 className="font-display text-[32px] font-semibold leading-[1.1] md:text-[56px] md:leading-[1.05]">Documents</h1>
            <p className="max-w-[640px] text-muted">
              Files the team adds to this project, and every report and document the assistant writes. In a chat, attach any of
              them with Sources so the assistant reads it before it answers.
            </p>
          </div>
          <button type="button" className={primaryButton} onClick={() => input.current?.click()}>
            <Upload aria-hidden className="size-4" strokeWidth={1.5} />
            Upload files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            aria-label="Files to add to the project"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`grid gap-1 border border-dashed p-6 text-center ${dragging ? "border-accent bg-surface" : "border-ink"}`}
      >
        <p className="font-semibold">Drop files here to add them to the project</p>
        <p className="text-sm text-muted">
          The assistant reads the text of PDFs and text files. Images, drawings and other files are kept for the team. Up to 200 MB each.
        </p>
      </div>

      {uploads.length > 0 && (
        <ul aria-label="Uploads" className="grid gap-1 text-sm">
          {uploads.map((u) => (
            <li key={u.key} className={`flex items-start gap-2 ${u.state === "error" ? "text-danger" : "text-ink"}`}>
              {u.state === "uploading" && <Loader2 aria-hidden className="mt-0.5 size-4 motion-safe:animate-spin" strokeWidth={1.5} />}
              {u.state === "done" && <Check aria-hidden className="mt-0.5 size-4 text-success" strokeWidth={2} />}
              {u.state === "error" && <AlertCircle aria-hidden className="mt-0.5 size-4" strokeWidth={1.5} />}
              <span>
                {u.state === "uploading" ? `Adding ${u.name}…` : u.state === "done" ? `Added ${u.name}` : `${u.name} was not added. ${u.message}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Project documents" className="grid gap-4">
        <div role="group" aria-label="Show" className="inline-flex w-fit border border-ink">
          {(
            [
              ["all", "All", uploadRows.length + artifactRows.length],
              ["uploads", "Uploaded", uploadRows.length],
              ["artifacts", "From the assistant", artifactRows.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`h-11 px-4 text-sm font-semibold ${filter === id ? "bg-ink text-bg" : "bg-bg text-ink hover:bg-surface"} ${focusRing}`}
            >
              {label} <span className={filter === id ? "text-bg/70" : "text-muted"}>{n}</span>
            </button>
          ))}
        </div>

        {openError && (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
            {openError}
          </p>
        )}
        {(docs.kind === "error" || artifacts.kind === "error") && (
          <p role="alert" className="text-sm text-danger">
            {docs.kind === "error" ? docs.message : artifacts.kind === "error" ? artifacts.message : ""}
          </p>
        )}
        {loading && (
          <div role="status" aria-label="Loading the documents" className="grid gap-2">
            <span className="block h-12 animate-pulse bg-surface" />
            <span className="block h-12 animate-pulse bg-surface" />
          </div>
        )}
        {!loading && rows.length === 0 && (
          <p className="text-muted">
            {filter === "artifacts"
              ? "No artifacts yet. The issue reports and documents the assistant writes in this project's chats appear here."
              : "No files yet. Upload the survey, soils report, plan check comments or anything else the team works from."}
          </p>
        )}
        {rows.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Project documents, newest first</caption>
            <thead>
              <tr className="border-b border-ink text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                <th scope="col" className="hidden py-2 pr-3 font-medium md:table-cell">Kind</th>
                <th scope="col" className="hidden py-2 pr-3 font-medium lg:table-cell">Added by</th>
                <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">Date</th>
                <th scope="col" className="py-2 pr-3 font-medium">Assistant reads</th>
                <th scope="col" className="py-2 text-right font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const Icon = r.icon;
                return (
                  <tr key={r.key} className="border-b border-border">
                    <td className="py-3 pr-3">
                      <span className="flex items-start gap-2">
                        <Icon aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />
                        <span className="grid min-w-0">
                          <span className="font-semibold break-words">{r.name}</span>
                          <span className="text-xs text-muted md:hidden">{r.kind}</span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden py-3 pr-3 md:table-cell">{r.kind}</td>
                    <td className="hidden py-3 pr-3 text-muted lg:table-cell">{r.from}</td>
                    <td className="hidden py-3 pr-3 text-muted tabular-nums sm:table-cell">{dateLabel(r.date)}</td>
                    <td className={`py-3 pr-3 ${r.readable === "No text" ? "text-muted" : ""}`}>{r.readable}</td>
                    <td className="py-3 text-right">
                      {"file" in r.open ? (
                        <button
                          type="button"
                          onClick={() => void openFile((r.open as { file: ProjectDocument }).file)}
                          className={`inline-flex min-h-11 items-center gap-1 font-semibold underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`}
                        >
                          Open<span className="sr-only"> {r.name}</span>
                          <ExternalLink aria-hidden className="size-4" strokeWidth={1.5} />
                        </button>
                      ) : (
                        <a
                          href={r.open.href}
                          onClick={r.open.onClick}
                          className={`inline-flex min-h-11 items-center font-semibold underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`}
                        >
                          Open<span className="sr-only"> {r.name}</span>
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
