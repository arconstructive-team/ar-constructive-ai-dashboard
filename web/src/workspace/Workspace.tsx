import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  AlertCircle,
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  SendHorizontal,
} from "lucide-react";
import { ADU_TYPES, CODE_CYCLE, JURISDICTIONS, type AduType, type Jurisdiction } from "../lib/project";
import { authorName } from "../auth/user";
import { RegeneratedSheets } from "../Regenerated";
import { ASSISTANT_NAME, type Assistant, type ChatContext } from "./assistant";
import { MarkdownPreview } from "./MarkdownPreview";
import { ArtifactPane as ArtifactCanvas } from "../artifacts/ArtifactPane";
import type { ArtifactSource } from "../artifacts/types";
import {
  KIND_LABEL,
  type Author,
  type Chat,
  type Message,
  type Project,
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
}

export function Workspace({ store, assistant, user, canvas }: WorkspaceProps) {
  const [projects, setProjects] = useState<Loadable<Project[]>>({ kind: "loading" });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [chats, setChats] = useState<Loadable<Chat[]>>({ kind: "loading" });
  const [chatId, setChatId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("projects");
  const [creating, setCreating] = useState(false);

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

  const project = projects.kind === "ready" ? (projects.data.find((p) => p.id === projectId) ?? null) : null;
  const chat = chats.kind === "ready" ? (chats.data.find((c) => c.id === chatId) ?? null) : null;

  function openProject(id: string) {
    setProjectId(id);
    setChatId(null);
  }

  function openChat(id: string) {
    setChatId(id);
    setPanel("chat");
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
          <button type="button" className={secondaryButton} onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            <Plus aria-hidden className="size-4" strokeWidth={1.5} />
            New project
          </button>
        </div>
        {creating && (
          <NewProjectForm
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              const id = await store.createProject(input, user);
              setCreating(false);
              openProject(id);
            }}
          />
        )}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <ProjectList
            projects={projects}
            projectId={projectId}
            chats={chats}
            chatId={chatId}
            onProject={openProject}
            onChat={openChat}
            onNewChat={() => void newChat()}
            onNewProject={() => setCreating(true)}
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
          canvas={canvas}
        />
      ) : (
        <section
          aria-label="Chat"
          className={`${panel === "projects" ? "hidden" : "flex"} flex-1 items-center justify-center p-8 lg:flex`}
        >
          <EmptyMain project={project} onNewChat={() => void newChat()} onNewProject={() => setCreating(true)} />
        </section>
      )}
    </div>
  );
}

function EmptyMain(props: { project: Project | null; onNewChat: () => void; onNewProject: () => void }) {
  if (props.project) {
    return (
      <div className="grid max-w-[480px] gap-4 text-center">
        <h1 className="font-display text-2xl font-semibold leading-[1.25]">{props.project.name}</h1>
        <p className="text-muted">
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
  onNewChat: () => void;
  onNewProject: () => void;
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
            <button
              type="button"
              aria-current={open ? "true" : undefined}
              onClick={() => props.onProject(p.id)}
              className={`flex min-h-11 w-full items-center gap-2 px-2 text-left text-sm ${open ? "font-semibold" : ""} ${focusRing}`}
            >
              <FolderOpen aria-hidden className="size-5 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
            {open && (
              <div className="ml-4 border-l border-border pl-2">
                {props.chats.kind === "loading" && <p className="py-2 text-sm text-muted">Loading chats…</p>}
                {props.chats.kind === "error" && <ErrorLine message={props.chats.message} />}
                {props.chats.kind === "ready" && (
                  <ul aria-label={`Chats in ${p.name}`} className="grid">
                    {props.chats.data.length === 0 && <li className="py-2 text-sm text-muted">No chats yet.</li>}
                    {props.chats.data.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-current={c.id === props.chatId ? "page" : undefined}
                          onClick={() => props.onChat(c.id)}
                          className={`flex min-h-11 w-full items-center gap-2 px-2 text-left text-sm ${
                            c.id === props.chatId ? "border-l-2 border-accent font-semibold" : "text-muted"
                          } ${focusRing}`}
                        >
                          <MessageSquare aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
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

function NewProjectForm(props: {
  onCreate: (input: { name: string; address: string; jurisdiction: Jurisdiction; aduType: AduType }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | "">("");
  const [aduType, setAduType] = useState<AduType>("No ADU");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="New project" noValidate onSubmit={submit} className="grid gap-3 border-b border-border p-4">
      <label className="grid gap-1 text-sm font-medium">
        Project name
        <input className={inputBase} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Project address
        <input className={inputBase} value={address} autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
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
      <label className="grid gap-1 text-sm font-medium">
        ADU type
        <select className={inputBase} value={aduType} onChange={(e) => setAduType(e.target.value as AduType)}>
          {ADU_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {error && <ErrorLine message={error} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.5} />}
          Create project
        </button>
        <button type="button" className={ghostButton} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
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
  canvas?: ArtifactSource;
}) {
  const { store, assistant, user, project, chat, panel, canvas } = props;
  const [messages, setMessages] = useState<Loadable<Message[]>>({ kind: "loading" });
  const [chosenArtifact, setChosenArtifact] = useState<string | null>(null);
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
        <ChatHeader store={store} project={project} chat={chat} />
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
          </ol>
        </div>
        {failure && <ErrorLine message={failure} />}
        <Composer
          busy={busy}
          onSend={(text) => void run(() => assistant.send(context(), text))}
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

function ChatHeader(props: { store: WorkspaceStore; project: Project; chat: Chat }) {
  const { store, project, chat } = props;
  const [menu, setMenu] = useState(false);
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
        <p className="truncate text-xs font-medium text-muted">{project.name}</p>
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
      <p className="mt-1 whitespace-pre-line">{message.text}</p>
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

function Composer(props: { busy: boolean; onSend: (text: string) => void; onFile: (file: File) => void }) {
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const showCommands = text.startsWith("/");

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
    props.onSend(message);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={submit} aria-label="Send a message" className="border-t border-border p-3">
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
      <div className="flex items-end gap-2 border border-border bg-surface p-1 focus-within:border-accent">
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type / for commands"
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
