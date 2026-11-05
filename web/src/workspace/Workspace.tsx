import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  AlertCircle,
  ChevronDown,
  FileText,
  FolderOpen,
  Library,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { ADU_TYPES, CODE_CYCLE, JURISDICTIONS, type AduType, type Jurisdiction } from "../lib/project";
import { authorName } from "../auth/user";
import { RegeneratedSheets } from "../Regenerated";
import { ASSISTANT_NAME, type Assistant, type ChatContext } from "./assistant";
import { MarkdownPreview } from "./MarkdownPreview";
import { SitePanel, type SiteRun } from "./SitePanel";
import { DocumentsPage } from "./DocumentsPage";
import { chatActivity, chatTimeLabel, chatTimeTitle, groupChatsByDate } from "./chatGroups";
import type { SiteApi } from "../site/siteApi";
import { ArtifactPane as ArtifactCanvas } from "../artifacts/ArtifactPane";
import { hashRouter, routeHref, type Router, type WorkspaceRoute } from "./router";
import type { ArtifactSource } from "../artifacts/types";
import {
  KIND_LABEL,
  type Author,
  type Chat,
  type Message,
  type MessageSource,
  type Project,
  type ProjectDocument,
  type WorkspaceArtifact,
  type WorkspaceStore,
} from "./types";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const inputBase =
  "h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:border-accent " + focusRing;
const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent px-5 text-[15px] font-semibold text-on-accent " +
  "transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] disabled:opacity-40 " +
  focusRing;
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-40 " +
  focusRing;
const dangerButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-danger px-5 text-[15px] font-semibold text-bg disabled:opacity-40 " +
  focusRing;
const ghostButton =
  "inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-sm font-medium text-ink hover:bg-surface " + focusRing;

type Loadable<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

const SLASH_COMMANDS = [
  { command: "/check", text: "Upload a permit set PDF and check it" },
  { command: "/regenerate", text: "Regenerate the cover data and notes sheets" },
  { command: "/help", text: "What I can do in this chat" },
] as const;

type Panel = "projects" | "chat" | "artifact";

function readError(error: Error): string {
  const code = (error as { code?: string }).code;
  if (code === "permission-denied") return "Your account cannot open the team workspace. Sign out, then sign in with your team account.";
  return error.message || "The workspace could not load. Reload the page.";
}

function timeLabel(date: Date | null): string {
  if (!date) return "Sending…";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export interface WorkspaceProps {
  store: WorkspaceStore;
  assistant: Assistant;
  user: Author;
  /**
   * The artifact canvas source (ARCO-14: live render, editing, versions, export).
   * Without it the right pane shows a plain preview (tests with the memory store).
   */
  canvas?: ArtifactSource;
  /** The site report service (ARCO-16). Without it the Site section shows saved reports only. */
  site?: SiteApi;
  /** Where the open project and chat live: the address bar by default (see router.ts). */
  router?: Router;
}

export function Workspace({ store, assistant, user, canvas, site, router: injectedRouter }: WorkspaceProps) {
  const router = useMemo(() => injectedRouter ?? hashRouter(), [injectedRouter]);
  const [projects, setProjects] = useState<Loadable<Project[]>>({ kind: "loading" });
  const [route, setRoute] = useState<WorkspaceRoute>(() => router.current());
  const { projectId, chatId } = route;
  const [chats, setChats] = useState<Loadable<Chat[]>>({ kind: "loading" });
  const [panel, setPanel] = useState<Panel>(() => (router.current().chatId ? "chat" : "projects"));

  useEffect(() => router.subscribe(setRoute), [router]);

  function go(next: WorkspaceRoute) {
    setRoute(next);
    router.go(next);
  }
  const [creating, setCreating] = useState(false);
  const [siteRuns, setSiteRuns] = useState<Record<string, SiteRun>>({});

  useEffect(
    () =>
      store.watchProjects(
        (data) => setProjects({ kind: "ready", data }),
        (error) => setProjects({ kind: "error", message: readError(error) }),
      ),
    [store],
  );

  useEffect(() => {
    if (!projectId) return;
    setChats({ kind: "loading" });
    return store.watchChats(
      projectId,
      (data) => setChats({ kind: "ready", data }),
      (error) => setChats({ kind: "error", message: readError(error) }),
    );
  }, [store, projectId]);

  const [artifactCounts, setArtifactCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setArtifactCounts({});
    if (!projectId) return;
    return store.watchProjectArtifacts(
      projectId,
      (artifacts) => {
        const counts: Record<string, number> = {};
        for (const a of artifacts) counts[a.chatId] = (counts[a.chatId] ?? 0) + 1;
        setArtifactCounts(counts);
      },
      () => setArtifactCounts({}),
    );
  }, [store, projectId]);

  const project = projects.kind === "ready" ? (projects.data.find((p) => p.id === projectId) ?? null) : null;
  const chat = chats.kind === "ready" ? (chats.data.find((c) => c.id === chatId) ?? null) : null;

  function openProject(id: string) {
    go({ projectId: id, chatId: null });
    setPanel("chat");
  }

  function openDocuments(id: string) {
    go({ projectId: id, chatId: null, page: "documents" });
    setPanel("chat");
  }

  function openChat(id: string) {
    if (!projectId) return;
    go({ projectId, chatId: id });
    setPanel("chat");
  }

  /** Runs the site report pipeline on the server and saves the answer on the project. */
  async function refreshSite(id: string, address: string) {
    if (!site || !address.trim()) return;
    setSiteRuns((runs) => ({ ...runs, [id]: { kind: "running" } }));
    try {
      const report = await site.buildReport(address);
      await store.saveSiteReport(id, report);
      setSiteRuns((runs) => ({ ...runs, [id]: { kind: "idle" } }));
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Try again in a minute.";
      setSiteRuns((runs) => ({ ...runs, [id]: { kind: "error", message } }));
    }
  }

  async function newChat() {
    if (!projectId) return;
    const count = chats.kind === "ready" ? chats.data.length : 0;
    const id = await store.createChat(projectId, `Chat ${count + 1}`, user);
    openChat(id);
  }

  return (
    <div className="flex min-h-[calc(100dvh-94px)] flex-col bg-bg text-ink lg:h-[calc(100dvh-94px)] lg:flex-row">
      <nav aria-label="Workspace panels" className="flex border-b border-border lg:hidden">
        {(["projects", "chat", "artifact"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={panel === p}
            onClick={() => setPanel(p)}
            className={`h-11 flex-1 text-sm font-medium ${panel === p ? "border-b-2 border-accent text-ink" : "text-muted"} ${focusRing}`}
          >
            {p === "projects" ? "Projects" : p === "chat" ? "Chat" : "Artifact"}
          </button>
        ))}
      </nav>

      <aside
        aria-label="Projects and chats"
        className={`${panel === "projects" ? "flex" : "hidden"} w-full shrink-0 flex-col border-border lg:flex lg:w-72 lg:border-r`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold">Projects</h2>
          <button type="button" className={secondaryButton} onClick={() => setCreating(true)} aria-haspopup="dialog">
            <Plus aria-hidden className="size-4" strokeWidth={1.5} />
            New project
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <ProjectList
            projects={projects}
            projectId={projectId}
            chats={chats}
            chatId={chatId}
            onProject={openProject}
            onChat={openChat}
            onDocuments={openDocuments}
            documentsOpen={route.page === "documents" && !chatId}
            onNewChat={() => void newChat()}
            onNewProject={() => setCreating(true)}
            artifactCounts={artifactCounts}
          />
        </div>
      </aside>

      {project && chat ? (
        <ChatSession
          key={`${project.id}/${chat.id}`}
          store={store}
          assistant={assistant}
          user={user}
          project={project}
          chat={chat}
          panel={panel}
          onPanel={setPanel}
          onProject={() => openProject(project.id)}
          onDocuments={() => openDocuments(project.id)}
          initialArtifact={route.artifactId ?? null}
          canvas={canvas}
        />
      ) : (
        <section
          aria-label={project ? "Project" : "Chat"}
          className={`${panel === "projects" ? "hidden" : "flex"} min-w-0 flex-1 lg:flex ${
            project ? "items-start justify-center overflow-y-auto" : "items-center justify-center p-8"
          }`}
        >
          {project && route.page === "documents" ? (
            <div className="grid w-full max-w-[1200px] px-4 pt-8 pb-24 md:px-8 lg:pt-12">
              <DocumentsPage
                store={store}
                project={project}
                chats={chats.kind === "ready" ? chats.data : []}
                onUpload={(file) => assistant.addDocument(project.id, file, authorName(user))}
                onProject={() => openProject(project.id)}
                onArtifact={(chatId, artifactId) => {
                  go({ projectId: project.id, chatId, artifactId });
                  setPanel("artifact");
                }}
              />
            </div>
          ) : project ? (
            <div className="grid w-full max-w-[1200px] gap-16 px-4 pt-8 pb-24 md:px-8 lg:pt-12">
              <ProjectHeader
                project={project}
                onNewChat={() => void newChat()}
                onDocuments={() => openDocuments(project.id)}
                onDelete={async () => {
                  await store.deleteProject(project.id);
                  go({ projectId: null, chatId: null });
                  setPanel("projects");
                }}
              />
              <SitePanel
                store={store}
                project={project}
                api={site}
                run={siteRuns[project.id] ?? { kind: "idle" }}
                onRefresh={() => void refreshSite(project.id, project.address)}
              />
            </div>
          ) : projectId && projects.kind === "ready" ? (
            <div className="grid max-w-[480px] gap-4 text-center">
              <h1 className="font-display text-2xl font-semibold leading-[1.25]">This project is not in the workspace</h1>
              <p className="text-muted">The link may be old, or the project was removed. Choose a project from the list.</p>
            </div>
          ) : (
            <EmptyMain project={null} onNewChat={() => void newChat()} onNewProject={() => setCreating(true)} />
          )}
        </section>
      )}
      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            const id = await store.createProject(input, user);
            setCreating(false);
            openProject(id);
            // Every new project gets its site report without anyone pressing a button.
            void refreshSite(id, input.address);
          }}
        />
      )}
    </div>
  );
}

function ProjectHeader(props: {
  project: Project;
  onNewChat: () => void;
  onDocuments: () => void;
  onDelete: () => Promise<void>;
}) {
  const { project } = props;
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const facts = [project.jurisdiction || "Jurisdiction not set", project.aduType, `${CODE_CYCLE} California codes`];
  return (
    <header className="grid">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-3">
          <h1 className="font-display text-[32px] font-semibold leading-[1.1] md:text-[56px] md:leading-[1.05]">{project.name}</h1>
          <p className="flex items-start gap-2 text-lg text-ink">
            <MapPin aria-hidden className="mt-1 size-5 shrink-0" strokeWidth={1.5} />
            {project.address || "No address yet"}
          </p>
          <ul aria-label="Project details" className="flex flex-wrap gap-2">
            {facts.map((f) => (
              <li key={f} className="bg-surface px-2 py-1 text-xs font-medium text-ink">
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={routeHref({ projectId: project.id, chatId: null, page: "documents" })}
            onClick={(e) => followLink(e, props.onDocuments)}
            className={secondaryButton}
          >
            <Library aria-hidden className="size-4" strokeWidth={1.5} />
            Documents
          </a>
          <button type="button" className={primaryButton} onClick={props.onNewChat}>
            <MessageSquare aria-hidden className="size-4" strokeWidth={1.5} />
            New chat
          </button>
          <div className="relative">
            <button
              type="button"
              aria-label="Project options"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              className={`inline-flex size-11 items-center justify-center border border-border bg-surface ${focusRing}`}
            >
              <MoreHorizontal aria-hidden className="size-5" strokeWidth={1.5} />
            </button>
            {menu && (
              <div role="menu" className="absolute top-full right-0 z-10 mt-1 grid min-w-52 rounded-sheet border border-border bg-bg py-1">
                <button
                  type="button"
                  role="menuitem"
                  className={`${ghostButton} w-full px-4 text-danger`}
                  onClick={() => {
                    setMenu(false);
                    setDeleting(true);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" strokeWidth={1.5} />
                  Delete project
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {deleting && (
        <div className="mt-6 border-l-4 border-danger bg-surface p-4">
          <ConfirmDelete
            title={`Delete ${project.name}?`}
            detail="Every chat, artifact, document and file of this project, and its site report, are deleted for the whole team. This cannot be undone."
            action="Delete project"
            confirmText={project.name}
            onCancel={() => setDeleting(false)}
            onConfirm={props.onDelete}
          />
        </div>
      )}

    </header>
  );
}

/** Plain clicks move inside the app; a modified click (new tab, new window) is left to the browser. */
function followLink(event: React.MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go();
}

/**
 * An inline confirmation for a delete: what goes, and a button that says exactly what it does.
 * With confirmText, the person types it first (for deletes that take a lot with them).
 */
function ConfirmDelete(props: {
  title: string;
  detail: string;
  action: string;
  confirmText?: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !props.confirmText || typed.trim() === props.confirmText.trim();

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "It could not be deleted. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={confirm} aria-label={props.action} className="grid gap-3">
      <div className="grid gap-1">
        <p className="font-semibold text-danger">{props.title}</p>
        <p className="text-sm text-ink">{props.detail}</p>
      </div>
      {props.confirmText && (
        <label className="grid max-w-[420px] gap-1 text-sm font-medium">
          Type the project name, {props.confirmText}, to confirm
          <input className={inputBase} value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
        </label>
      )}
      {error && <ErrorLine message={error} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={dangerButton} disabled={!ready || busy}>
          {busy ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} /> : <Trash2 aria-hidden className="size-4" strokeWidth={1.5} />}
          {props.action}
        </button>
        <button type="button" className={ghostButton} onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EmptyMain(props: { project: Project | null; onNewChat: () => void; onNewProject: () => void }) {
  if (props.project) {
    return (
      <div className="grid gap-4">
        <h1 className="font-display text-2xl font-semibold leading-[1.25]">{props.project.name}</h1>
        <p className="max-w-[560px] text-muted">
          Open a chat from the list, or start one. In a chat you upload the permit set, and the issue report and
          regenerated sheets appear next to it for the whole team.
        </p>
        <div>
          <button type="button" className={primaryButton} onClick={props.onNewChat}>
            <MessageSquare aria-hidden className="size-4" strokeWidth={1.5} />
            New chat
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid max-w-[480px] gap-4 text-center">
      <h1 className="font-display text-2xl font-semibold leading-[1.25]">Choose a project</h1>
      <p className="text-muted">Every team member sees every project and its chats. Choose one from the list, or create one.</p>
      <div>
        <button type="button" className={primaryButton} onClick={props.onNewProject}>
          <Plus aria-hidden className="size-4" strokeWidth={1.5} />
          New project
        </button>
      </div>
    </div>
  );
}

function ProjectList(props: {
  projects: Loadable<Project[]>;
  projectId: string | null;
  chats: Loadable<Chat[]>;
  chatId: string | null;
  onProject: (id: string) => void;
  onChat: (id: string) => void;
  onDocuments: (id: string) => void;
  documentsOpen: boolean;
  onNewChat: () => void;
  onNewProject: () => void;
  artifactCounts: Record<string, number>;
}) {
  const { projects } = props;
  if (projects.kind === "loading") {
    return (
      <div role="status" aria-label="Loading projects" className="grid gap-2 p-2">
        <span className="block h-5 w-3/4 animate-pulse bg-surface" />
        <span className="block h-5 w-1/2 animate-pulse bg-surface" />
      </div>
    );
  }
  if (projects.kind === "error") return <ErrorLine message={projects.message} />;
  if (projects.data.length === 0) {
    return (
      <p className="p-2 text-sm text-muted">
        No projects yet.{" "}
        <button type="button" className={`font-medium text-ink underline ${focusRing}`} onClick={props.onNewProject}>
          Create the first project
        </button>
      </p>
    );
  }
  return (
    <ul className="grid gap-1">
      {projects.data.map((p) => {
        const open = p.id === props.projectId;
        return (
          <li key={p.id}>
            <a
              href={routeHref({ projectId: p.id, chatId: null })}
              aria-current={open && !props.chatId ? "page" : open ? "true" : undefined}
              onClick={(e) => followLink(e, () => props.onProject(p.id))}
              className={`flex min-h-12 w-full items-start gap-2 border-l-2 px-2 py-2 text-left text-sm hover:bg-surface ${
                open ? "border-ink bg-surface" : "border-transparent"
              } ${focusRing}`}
            >
              <FolderOpen aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />
              <span className="grid min-w-0 flex-1">
                <span className={`truncate ${open ? "font-semibold" : "font-medium"}`}>{p.name}</span>
                {p.address && <span className="truncate text-xs text-muted">{p.address}</span>}
              </span>
            </a>
            {open && (
              <div className="ml-5 pl-2">
                <a
                  href={routeHref({ projectId: p.id, chatId: null, page: "documents" })}
                  aria-current={props.documentsOpen ? "page" : undefined}
                  onClick={(e) => followLink(e, () => props.onDocuments(p.id))}
                  className={`flex min-h-11 w-full items-center gap-2 border-l-2 px-2 text-left text-sm hover:bg-surface ${
                    props.documentsOpen ? "border-accent font-semibold text-ink" : "border-transparent text-muted"
                  } ${focusRing}`}
                >
                  <Library aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                  Documents
                </a>
                {props.chats.kind === "loading" && <p className="py-2 text-sm text-muted">Loading chats…</p>}
                {props.chats.kind === "error" && <ErrorLine message={props.chats.message} />}
                {props.chats.kind === "ready" && (
                  <ChatList
                    projectId={p.id}
                    projectName={p.name}
                    chats={props.chats.data}
                    chatId={props.chatId}
                    artifactCounts={props.artifactCounts}
                    onChat={props.onChat}
                  />
                )}
                <button type="button" className={ghostButton} onClick={props.onNewChat}>
                  <Plus aria-hidden className="size-4" strokeWidth={1.5} />
                  New chat
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChatList(props: {
  projectId: string;
  projectName: string;
  chats: Chat[];
  chatId: string | null;
  artifactCounts: Record<string, number>;
  onChat: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const now = new Date();
  const groups = groupChatsByDate(props.chats, now);
  if (groups.length === 0) return <p className="py-2 text-sm text-muted">No chats yet.</p>;
  return (
    <ul aria-label={`Chats in ${props.projectName}`} className="grid gap-1 pt-1">
      {groups.map((g) => {
        const closed = !!collapsed[g.key];
        const listId = `chats-${props.projectId}-${g.key}`;
        return (
          <li key={g.key} aria-label={g.label}>
            <button
              type="button"
              aria-expanded={!closed}
              aria-controls={listId}
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !closed }))}
              className={`flex min-h-8 w-full items-center gap-1 px-2 text-left text-xs font-medium text-muted hover:text-ink ${focusRing}`}
            >
              <span>{g.label}</span>
              <ChevronDown
                aria-hidden
                className={`size-3.5 shrink-0 motion-safe:transition-transform ${closed ? "-rotate-90" : ""}`}
                strokeWidth={1.5}
              />
              <span className="ml-auto tabular-nums">{g.chats.length}</span>
            </button>
            {!closed && (
              <ul id={listId} className="grid">
                {g.chats.map((c) => {
                  const at = chatActivity(c, now);
                  const artifacts = props.artifactCounts[c.id] ?? 0;
                  const current = c.id === props.chatId;
                  return (
                    <li key={c.id}>
                      <a
                        href={routeHref({ projectId: props.projectId, chatId: c.id })}
                        aria-current={current ? "page" : undefined}
                        onClick={(e) => followLink(e, () => props.onChat(c.id))}
                        className={`flex min-h-11 w-full items-center gap-2 border-l-2 px-2 text-left text-sm hover:bg-surface ${
                          current ? "border-accent font-semibold text-ink" : "border-transparent text-muted"
                        } ${focusRing}`}
                      >
                        <MessageSquare aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {artifacts > 0 && (
                          <span
                            className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted tabular-nums"
                            title={`${artifacts} ${artifacts === 1 ? "artifact" : "artifacts"}`}
                          >
                            <FileText aria-hidden className="size-3.5" strokeWidth={1.5} />
                            {artifacts}
                            <span className="sr-only">{artifacts === 1 ? " artifact" : " artifacts"}</span>
                          </span>
                        )}
                        <time
                          dateTime={at.toISOString()}
                          title={chatTimeTitle(at)}
                          className="shrink-0 text-xs font-normal text-muted tabular-nums"
                        >
                          {chatTimeLabel(at, now)}
                        </time>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Starting a project is the first thing anyone does here, so it gets a centered dialog of its own
 * instead of a cramped form in the sidebar. Escape, the close button, Cancel and a click on the
 * backdrop all close it; focus moves in when it opens, stays inside while it is open, and goes
 * back to whatever opened it when it closes.
 */
function NewProjectDialog(props: {
  onCreate: (input: { name: string; address: string; jurisdiction: Jurisdiction; aduType: AduType }) => Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | "">("");
  const [aduType, setAduType] = useState<AduType>("No ADU");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const cancelRef = useRef(props.onCancel);
  cancelRef.current = props.onCancel;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input, select")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function close() {
    if (!busyRef.current) cancelRef.current();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [
      ...panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])"),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (address.trim().length < 5) return setError("Enter the project street address, for example 428 El Rio Rd, Danville.");
    if (!jurisdiction) return setError("Choose the jurisdiction that reviews this permit.");
    setError(null);
    setBusy(true);
    try {
      await props.onCreate({ name: name.trim() || address.trim(), address: address.trim(), jurisdiction, aduType });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The project could not be saved. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100dvh-24px)] w-full overflow-y-auto rounded-t-sheet border border-border bg-bg sm:max-w-[520px] sm:rounded-sheet"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="grid gap-1">
            <h2 id={titleId} className="font-display text-2xl font-semibold leading-[1.25]">
              New project
            </h2>
            <p id={descriptionId} className="text-sm text-muted">
              Where the work is and who reviews it. The site report starts as soon as you create it.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className={`-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-surface ${focusRing}`}
            onClick={close}
            disabled={busy}
          >
            <X aria-hidden className="size-5" strokeWidth={1.5} />
          </button>
        </div>
        <form aria-label="New project" noValidate onSubmit={submit} className="grid gap-5 px-6 py-6">
          <label className="grid gap-1.5 text-sm font-medium">
            Project address
            <input
              className={inputBase}
              value={address}
              autoComplete="street-address"
              placeholder="428 El Rio Rd, Danville"
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={nameId} className="text-sm font-medium">
                Project name
              </label>
              <span className="text-xs text-muted">Optional</span>
            </div>
            <input
              id={nameId}
              className={inputBase}
              value={name}
              placeholder="Uses the address if left blank"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Jurisdiction
              <select className={inputBase} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as Jurisdiction | "")}>
                <option value="">Choose a jurisdiction</option>
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              ADU type
              <select className={inputBase} value={aduType} onChange={(e) => setAduType(e.target.value as AduType)}>
                {ADU_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <ErrorLine message={error} />}
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
            <button type="button" className={`${secondaryButton} sm:min-w-28`} onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={`${primaryButton} sm:min-w-36`} disabled={busy}>
              {busy && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />}
              {busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 p-2 text-sm text-danger">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
      {message}
    </p>
  );
}

function ChatSession(props: {
  store: WorkspaceStore;
  assistant: Assistant;
  user: Author;
  project: Project;
  chat: Chat;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  onProject: () => void;
  onDocuments: () => void;
  initialArtifact: string | null;
  canvas?: ArtifactSource;
}) {
  const { store, assistant, user, project, chat, panel, canvas } = props;
  const sources = useProjectSources(store, project.id);
  const [messages, setMessages] = useState<Loadable<Message[]>>({ kind: "loading" });
  const [chosenArtifact, setChosenArtifact] = useState<string | null>(props.initialArtifact);
  useEffect(() => {
    if (props.initialArtifact) setChosenArtifact(props.initialArtifact);
  }, [props.initialArtifact]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(
    () =>
      store.watchMessages(
        project.id,
        chat.id,
        (data) => setMessages({ kind: "ready", data }),
        (error) => setMessages({ kind: "error", message: readError(error) }),
      ),
    [store, project.id, chat.id],
  );

  const list = messages.kind === "ready" ? messages.data : [];
  const latestArtifact = useMemo(() => [...list].reverse().find((m) => m.artifactId)?.artifactId ?? null, [list]);
  const artifactId = chosenArtifact ?? latestArtifact;

  function context(): ChatContext {
    return {
      projectId: project.id,
      chatId: chat.id,
      project: { address: project.address, jurisdiction: project.jurisdiction, aduType: project.aduType },
      author: authorName(user),
      messages: list,
    };
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    setChosenArtifact(null);
    try {
      await work();
    } catch (err) {
      setFailure(err instanceof Error && err.message ? err.message : "The message could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        aria-label="Chat"
        className={`${panel === "chat" ? "flex" : "hidden"} min-h-0 w-full flex-col border-border lg:flex lg:w-[420px] lg:shrink-0 lg:border-r`}
      >
        <ChatHeader store={store} project={project} chat={chat} onProject={props.onProject} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.kind === "loading" && (
            <div role="status" aria-label="Loading messages" className="grid gap-3">
              <span className="block h-4 w-2/3 animate-pulse bg-surface" />
              <span className="block h-4 w-1/2 animate-pulse bg-surface" />
            </div>
          )}
          {messages.kind === "error" && <ErrorLine message={messages.message} />}
          {messages.kind === "ready" && messages.data.length === 0 && (
            <p className="text-sm text-muted">
              Upload the permit set PDF with + below. I check it against the {CODE_CYCLE} California codes and{" "}
              {project.jurisdiction || "the project's jurisdiction"}, and write the issue report on the right.
            </p>
          )}
          <ol className="grid gap-4">
            {list.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                open={m.artifactId !== undefined && m.artifactId === artifactId}
                onOpen={(id) => {
                  setChosenArtifact(id);
                  props.onPanel("artifact");
                }}
              />
            ))}
            {busy && !list.some((m) => m.streaming) && (
              <li>
                <p className="text-xs font-medium text-muted">{ASSISTANT_NAME}</p>
                <Working label="Thinking…" />
              </li>
            )}
          </ol>
        </div>
        {failure && <ErrorLine message={failure} />}
        <Composer
          busy={busy}
          sources={sources}
          onDocuments={props.onDocuments}
          onSend={(text, attached) => void run(() => assistant.send(context(), text, attached))}
          onFile={(file) => void run(() => assistant.upload(context(), file))}
        />
      </section>

      <section
        aria-label="Artifact"
        className={`${panel === "artifact" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col lg:flex`}
      >
        {artifactId ? (
          <ArtifactPane
            key={artifactId}
            store={store}
            assistant={assistant}
            canvas={canvas}
            projectId={project.id}
            projectName={project.name}
            editorName={authorName(user)}
            artifactId={artifactId}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="max-w-[420px] text-center text-muted">
              The issue report and regenerated sheets of this chat open here. Upload the permit set in the chat to start.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function ChatHeader(props: { store: WorkspaceStore; project: Project; chat: Chat; onProject: () => void }) {
  const { store, project, chat } = props;
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState<"chat" | "project" | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startRename(kind: "chat" | "project") {
    setMenu(false);
    setRenaming(kind);
    setValue(kind === "chat" ? chat.title : project.name);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = value.trim();
    if (!name) return setError("Enter a name.");
    try {
      if (renaming === "chat") await store.renameChat(project.id, chat.id, name);
      else await store.renameProject(project.id, name);
      setRenaming(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The name could not be saved. Try again.");
    }
  }

  if (deleting) {
    return (
      <div className="border-b border-border px-4 py-3">
        <ConfirmDelete
          title={`Delete ${chat.title}?`}
          detail="Its messages and the artifacts written in it are deleted for the whole team. Files it added stay in the project's documents. This cannot be undone."
          action="Delete chat"
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await store.deleteChat(project.id, chat.id);
            props.onProject();
          }}
        />
      </div>
    );
  }

  if (renaming) {
    return (
      <form onSubmit={save} className="grid gap-2 border-b border-border px-4 py-2" aria-label={`Rename ${renaming}`}>
        <label className="grid gap-1 text-sm font-medium">
          {renaming === "chat" ? "Chat name" : "Project name"}
          <input className={inputBase} value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <ErrorLine message={error} />}
        <div className="flex gap-2">
          <button type="submit" className={secondaryButton}>
            Save name
          </button>
          <button type="button" className={ghostButton} onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="relative flex min-h-14 items-center gap-2 border-b border-border px-4">
      <div className="min-w-0 flex-1">
        <a
          href={routeHref({ projectId: project.id, chatId: null })}
          onClick={(e) => followLink(e, () => props.onProject())}
          className={`block truncate text-xs font-medium text-muted underline-offset-4 hover:underline ${focusRing}`}
        >
          {project.name}
        </a>
        <h1 className="truncate font-display text-base font-semibold">{chat.title}</h1>
      </div>
      <button
        type="button"
        aria-label="Chat options"
        aria-expanded={menu}
        className={`inline-flex size-11 items-center justify-center rounded-control ${focusRing}`}
        onClick={() => setMenu((v) => !v)}
      >
        <ChevronDown aria-hidden className="size-5" strokeWidth={1.5} />
      </button>
      {menu && (
        <div role="menu" className="absolute top-full right-4 z-10 grid min-w-48 rounded-sheet border border-border bg-bg py-1">
          <button type="button" role="menuitem" className={`${ghostButton} w-full px-4`} onClick={() => startRename("chat")}>
            Rename chat
          </button>
          <button type="button" role="menuitem" className={`${ghostButton} w-full px-4`} onClick={() => startRename("project")}>
            Rename project
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${ghostButton} w-full border-t border-border px-4 text-danger`}
            onClick={() => {
              setMenu(false);
              setDeleting(true);
            }}
          >
            <Trash2 aria-hidden className="size-4" strokeWidth={1.5} />
            Delete chat
          </button>
        </div>
      )}
    </div>
  );
}

function MessageItem(props: { message: Message; open: boolean; onOpen: (artifactId: string) => void }) {
  const { message } = props;
  const mine = message.role === "user";
  return (
    <li className={mine ? "ml-8 bg-surface p-3" : ""}>
      <p className="text-xs font-medium text-muted">
        {mine ? message.author : ASSISTANT_NAME} · {timeLabel(message.createdAt)}
      </p>
      {message.text && <p className="mt-1 whitespace-pre-line">{message.text}</p>}
      {message.streaming && <Working label={message.text ? "Writing…" : "Thinking…"} />}
      {message.sources && message.sources.length > 0 && (
        <ul aria-label="Attached documents" className="mt-2 flex flex-wrap gap-1">
          {message.sources.map((src) => (
            <li key={src.id} className="inline-flex items-center gap-1 border border-border bg-bg px-1.5 py-0.5 text-xs">
              <FileText aria-hidden className="size-3.5" strokeWidth={1.5} />
              {src.name}
            </li>
          ))}
        </ul>
      )}
      {message.artifactId && (
        <button
          type="button"
          onClick={() => props.onOpen(message.artifactId as string)}
          aria-pressed={props.open}
          className={`mt-2 ${ghostButton} border ${props.open ? "border-accent" : "border-border"}`}
        >
          <FileText aria-hidden className="size-4" strokeWidth={1.5} />
          Open the artifact
        </button>
      )}
    </li>
  );
}

/** The assistant is still working on its reply. */
function Working(props: { label: string }) {
  return (
    <p role="status" className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted">
      <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />
      {props.label}
    </p>
  );
}

/** The project's documents as sources a message can attach: uploads first, then artifacts. */
function useProjectSources(store: WorkspaceStore, projectId: string): SourceOption[] {
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  useEffect(() => store.watchDocuments(projectId, setDocs, () => setDocs([])), [store, projectId]);
  useEffect(() => store.watchProjectArtifacts(projectId, setArtifacts, () => setArtifacts([])), [store, projectId]);
  return useMemo(
    () => [
      ...docs.map((d) => ({ id: `doc:${d.id}`, name: d.name, detail: d.pageCount > 0 ? `${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}` : "No text" })),
      ...artifacts.map((a) => ({ id: `artifact:${a.id}`, name: a.title, detail: `${KIND_LABEL[a.kind]}, version ${a.version}` })),
    ],
    [docs, artifacts],
  );
}

interface SourceOption extends MessageSource {
  detail: string;
}

function Composer(props: {
  busy: boolean;
  sources: SourceOption[];
  onDocuments: () => void;
  onSend: (text: string, sources: MessageSource[]) => void;
  onFile: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<MessageSource[]>([]);
  const [picking, setPicking] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const listId = useId();
  const showCommands = text.startsWith("/");

  // "@" followed by what the person typed so far, right before the caret: a mention being written.
  const mention = useMemo(() => {
    const m = text.slice(0, caret).match(/(^|\s)@([^\n@]{0,60})$/);
    if (!m || mentionClosed) return null;
    const query = m[2]!.toLowerCase();
    const matches = props.sources.filter((src) => src.name.toLowerCase().includes(query.trim())).slice(0, 8);
    return { start: caret - m[2]!.length - 1, query, matches };
  }, [text, caret, mentionClosed, props.sources]);

  function pick(src: SourceOption) {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const inserted = `@${src.name} `;
    setText(before + inserted + after);
    setAttached((list) => (list.some((a) => a.id === src.id) ? list : [...list, { id: src.id, name: src.name }]));
    const at = before.length + inserted.length;
    setCaret(at);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(at, at);
    });
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || props.busy) return;
    if (value === "/check") {
      fileInput.current?.click();
      setText("");
      return;
    }
    const message = value === "/regenerate" ? "regenerate the sheets" : value === "/help" ? "help" : value;
    props.onSend(message, attached);
    setText("");
    setAttached([]);
    setPicking(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mention.matches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const n = mention.matches.length;
        setActive((i) => (event.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(mention.matches[Math.min(active, mention.matches.length - 1)]!);
        return;
      }
    }
    if (mention && event.key === "Escape") {
      event.preventDefault();
      setMentionClosed(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={submit} aria-label="Send a message" className="border-t border-border p-3">
      {mention && (
        <div className="mb-2 grid border border-ink bg-bg">
          <p className="border-b border-border px-3 py-2 text-xs text-muted">
            {mention.matches.length > 0 ? "Attach a project document" : props.sources.length === 0 ? "No project documents yet" : `No document matches "${mention.query}"`}
          </p>
          {mention.matches.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Project documents">
              {mention.matches.map((src, i) => (
                <li
                  key={src.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(src);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm ${i === active ? "bg-surface" : ""}`}
                >
                  {src.id.startsWith("artifact:") ? (
                    <FileText aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                  ) : (
                    <Paperclip aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                  )}
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">{src.name}</span>
                    <span className="text-xs text-muted">{src.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {showCommands && (
        <ul aria-label="Commands" className="mb-2 grid border border-border bg-bg">
          {SLASH_COMMANDS.filter((c) => c.command.startsWith(text.trim())).map((c) => (
            <li key={c.command}>
              <button
                type="button"
                className={`${ghostButton} w-full px-3`}
                onClick={() => {
                  setText(c.command);
                }}
              >
                <span className="font-semibold">{c.command}</span> <span className="text-muted">{c.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <div className="mb-2 grid max-h-72 overflow-y-auto border border-ink bg-bg">
          <p className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted">
            <span>Attach project documents for the assistant to read</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                props.onDocuments();
              }}
              className={`font-medium text-ink underline underline-offset-4 ${focusRing}`}
            >
              Upload more
            </a>
          </p>
          {props.sources.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">No documents yet. Add files on the project's Documents page.</p>
          ) : (
            <ul aria-label="Project documents to attach">
              {props.sources.map((src) => {
                const on = attached.some((a) => a.id === src.id);
                return (
                  <li key={src.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setAttached((list) => (on ? list.filter((a) => a.id !== src.id) : [...list, { id: src.id, name: src.name }]))
                        }
                        className="size-4 accent-accent"
                      />
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">{src.name}</span>
                        <span className="text-xs text-muted">{src.detail}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {attached.length > 0 && (
        <ul aria-label="Attached documents" className="mb-2 flex flex-wrap gap-2">
          {attached.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-1 bg-surface py-1 pr-1 pl-2 text-xs font-medium">
              <FileText aria-hidden className="size-3.5" strokeWidth={1.5} />
              <span className="max-w-48 truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttached((list) => list.filter((x) => x.id !== a.id))}
                className={`inline-flex size-6 items-center justify-center hover:bg-border ${focusRing}`}
              >
                <X aria-hidden className="size-3.5" strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2 border border-border bg-surface p-1 focus-within:border-accent">
        <button
          type="button"
          aria-label="Attach project documents"
          aria-expanded={picking}
          title="Sources: attach project documents"
          onClick={() => setPicking((v) => !v)}
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-control ${picking || attached.length ? "text-accent" : ""} ${focusRing}`}
        >
          <Library aria-hidden className="size-5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Upload a permit set PDF"
          disabled={props.busy}
          onClick={() => fileInput.current?.click()}
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-control disabled:opacity-40 ${focusRing}`}
        >
          <Paperclip aria-hidden className="size-5" strokeWidth={1.5} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label="Permit set PDF"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) props.onFile(file);
          }}
        />
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <textarea
          id={inputId}
          rows={1}
          ref={textarea}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
            setMentionClosed(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={!!mention && mention.matches.length > 0}
          aria-controls={mention ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={mention && mention.matches.length > 0 ? `${listId}-${active}` : undefined}
          placeholder="Type @ to attach a document, / for commands"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-ink placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={props.busy || !text.trim()}
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-control bg-accent text-on-accent transition-[filter] duration-(--duration-brand) ease-(--ease-brand) hover:brightness-[0.92] disabled:opacity-40 ${focusRing}`}
        >
          {props.busy ? (
            <Loader2 aria-hidden className="size-5 motion-safe:animate-spin" strokeWidth={1.5} />
          ) : (
            <SendHorizontal aria-hidden className="size-5" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </form>
  );
}

function StatusChip({ artifact }: { artifact: WorkspaceArtifact }) {
  if (artifact.status === "generating") {
    return (
      <span className="inline-flex items-center gap-1 rounded-chip bg-accent/12 px-1.5 py-0.5 text-xs font-medium text-ink">
        <Loader2 aria-hidden className="size-3 motion-safe:animate-spin" strokeWidth={1.5} />
        Writing
      </span>
    );
  }
  if (artifact.status === "error") {
    return <span className="rounded-chip bg-danger/12 px-1.5 py-0.5 text-xs font-medium text-danger">Stopped</span>;
  }
  return (
    <span className="rounded-chip bg-success/12 px-1.5 py-0.5 text-xs font-medium text-success">Version {artifact.version}</span>
  );
}

function ViewToggle(props: { view: "document" | "sheets"; onView: (view: "document" | "sheets") => void }) {
  return (
    <div role="group" aria-label="Artifact view" className="flex">
      {(["document", "sheets"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={props.view === v}
          onClick={() => props.onView(v)}
          className={`h-9 border px-3 text-sm font-medium ${props.view === v ? "border-ink bg-ink/12" : "border-border"} ${focusRing}`}
        >
          {v === "document" ? "Document" : "Sheets side by side"}
        </button>
      ))}
    </div>
  );
}

function ArtifactPane(props: {
  store: WorkspaceStore;
  assistant: Assistant;
  canvas?: ArtifactSource;
  projectId: string;
  projectName: string;
  editorName: string;
  artifactId: string;
}) {
  const { store, assistant, canvas, projectId, artifactId } = props;
  const [state, setState] = useState<Loadable<WorkspaceArtifact | null>>({ kind: "loading" });
  const [view, setView] = useState<"document" | "sheets">("document");

  useEffect(
    () =>
      store.watchArtifact(
        projectId,
        artifactId,
        (data) => setState({ kind: "ready", data }),
        (error) => setState({ kind: "error", message: readError(error) }),
      ),
    [store, projectId, artifactId],
  );

  if (state.kind === "loading") {
    return (
      <div role="status" aria-label="Loading the artifact" className="grid gap-3 p-8">
        <span className="block h-8 w-1/2 animate-pulse bg-surface" />
        <span className="block h-4 w-3/4 animate-pulse bg-surface" />
        <span className="block h-4 w-2/3 animate-pulse bg-surface" />
      </div>
    );
  }
  if (state.kind === "error") return <ErrorLine message={state.message} />;
  if (!state.data) return <ErrorLine message="This artifact was deleted, or you no longer have access to it." />;

  const artifact = state.data;
  const session = assistant.sessionSet(artifact.chatId);
  const canCompare = artifact.kind === "sheet_set" && session?.file !== undefined && artifact.status === "ready";

  // The artifact canvas (ARCO-14) shows the document: live render, editing, versions and export.
  if (canvas && !(canCompare && view === "sheets")) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {canCompare && (
          <div className="flex justify-end border-b border-border px-4 py-1">
            <ViewToggle view={view} onView={setView} />
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ArtifactCanvas
            source={canvas}
            projectId={projectId}
            artifactId={artifactId}
            projectName={props.projectName}
            editorName={props.editorName}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-border px-6 py-2">
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-semibold">{artifact.title}</h2>
        <span className="rounded-chip bg-ink/12 px-1.5 py-0.5 text-xs font-medium text-ink">{KIND_LABEL[artifact.kind]}</span>
        <StatusChip artifact={artifact} />
        {canCompare && <ViewToggle view={view} onView={setView} />}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-12">
        {artifact.status === "error" && (
          <div role="alert" className="mb-6 flex items-start gap-3 border-l-4 border-danger pl-4">
            <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-danger" strokeWidth={1.5} />
            <p>{artifact.error || "The work stopped before the document was finished."}</p>
          </div>
        )}
        {canCompare && view === "sheets" && session ? (
          <RegeneratedSheets result={session.result} file={session.file ?? null} fileName={session.fileName} />
        ) : (
          <ArtifactDocument artifact={artifact} />
        )}
      </div>
    </>
  );
}

function ArtifactDocument({ artifact }: { artifact: WorkspaceArtifact }) {
  return (
    <article aria-label={artifact.title} aria-busy={artifact.status === "generating"}>
      <MarkdownPreview markdown={artifact.content} />
      {artifact.status === "generating" && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />
          Writing…
        </p>
      )}
      {artifact.status === "ready" && (
        <p className="mt-8 border-t border-border pt-3 text-xs text-muted">
          Version {artifact.version} · {artifact.updatedBy} · {timeLabel(artifact.updatedAt)}
        </p>
      )}
    </article>
  );
}
