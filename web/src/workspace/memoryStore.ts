import type { PageText } from "../lib/engine";
import {
  defaultDocumentKind,
  isWebLink,
  type Chat,
  type DocumentPatch,
  type Message,
  type NewDocument,
  type NewLink,
  type Project,
  type ProjectDocument,
  type ProjectPatch,
  type StoredSet,
  type WorkspaceArtifact,
  type WorkspaceStore,
} from "./types";
import type { SiteReport } from "../site/types";
import { SITE_ARTIFACT_ID } from "../site/siteMarkdown";

interface VersionRecord {
  version: number;
  title: string;
  content: string;
  updatedBy: string;
  updatedAt: Date;
  chatId: string;
}

/**
 * The workspace in memory. Tests use it; two components that share one store
 * behave like two team members on the same Firestore database: every write
 * reaches every listener at once.
 */
export class MemoryStore implements WorkspaceStore {
  projects = new Map<string, Project>();
  chats = new Map<string, Chat>();
  messages = new Map<string, Message[]>();
  artifacts = new Map<string, WorkspaceArtifact>();
  versions = new Map<string, VersionRecord[]>();
  sets = new Map<string, StoredSet[]>();
  siteReports = new Map<string, SiteReport>();
  /** Artifacts written outside a chat (the site report), by artifact id: the project they belong to. */
  artifactProjects = new Map<string, string>();
  /** Uploaded files by project, newest first, with their text and the bytes. */
  documents = new Map<string, Array<ProjectDocument & { pages: PageText[]; file: Blob }>>();
  private listeners = new Set<() => void>();
  private seq = 0;
  private clock = Date.UTC(2026, 10, 5, 16, 0, 0);

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  private now() {
    this.clock += 1000;
    return new Date(this.clock);
  }

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }

  private watch(read: () => void) {
    this.listeners.add(read);
    read();
    return () => {
      this.listeners.delete(read);
    };
  }

  watchProjects(onData: (projects: Project[]) => void) {
    return this.watch(() =>
      onData([...this.projects.values()].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))),
    );
  }

  async createProject(input: Parameters<WorkspaceStore["createProject"]>[0], by: Parameters<WorkspaceStore["createProject"]>[1]) {
    const id = this.id("p");
    this.projects.set(id, {
      id,
      ...input,
      createdBy: by.email,
      createdAt: this.now(),
      members: ["team"],
      client: "",
      status: "intake",
      siteReportAt: null,
    });
    this.emit();
    return id;
  }

  async renameProject(projectId: string, name: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("This project no longer exists.");
    this.projects.set(projectId, { ...project, name });
    this.emit();
  }

  async updateProject(projectId: string, patch: ProjectPatch) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("This project no longer exists.");
    const next = { ...project };
    if (patch.client !== undefined) next.client = patch.client.trim();
    if (patch.status !== undefined) next.status = patch.status;
    this.projects.set(projectId, next);
    this.emit();
  }

  watchChats(projectId: string, onData: (chats: Chat[]) => void) {
    return this.watch(() =>
      onData(
        [...this.chats.values()]
          .filter((c) => c.projectId === projectId)
          .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)),
      ),
    );
  }

  async createChat(projectId: string, title: string, by: { email: string }) {
    const id = this.id("c");
    const at = this.now();
    this.chats.set(id, { id, projectId, title, createdBy: by.email, createdAt: at, updatedAt: at });
    this.emit();
    return id;
  }

  async deleteChat(_projectId: string, chatId: string) {
    this.chats.delete(chatId);
    this.messages.delete(chatId);
    this.sets.delete(chatId);
    for (const [id, a] of this.artifacts) {
      if (a.chatId === chatId) {
        this.artifacts.delete(id);
        this.versions.delete(id);
      }
    }
    this.emit();
  }

  async deleteProject(projectId: string) {
    for (const [id, chat] of this.chats) if (chat.projectId === projectId) await this.deleteChat(projectId, id);
    this.documents.delete(projectId);
    this.siteReports.delete(projectId);
    for (const [id, p] of this.artifactProjects) {
      if (p === projectId) {
        this.artifacts.delete(id);
        this.versions.delete(id);
        this.artifactProjects.delete(id);
      }
    }
    this.projects.delete(projectId);
    this.emit();
  }

  async renameChat(_projectId: string, chatId: string, title: string) {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error("This chat no longer exists.");
    this.chats.set(chatId, { ...chat, title });
    this.emit();
  }

  watchMessages(_projectId: string, chatId: string, onData: (messages: Message[]) => void) {
    return this.watch(() => onData([...(this.messages.get(chatId) ?? [])]));
  }

  async addMessage(_projectId: string, chatId: string, message: Parameters<WorkspaceStore["addMessage"]>[2]) {
    const id = this.id("m");
    const at = this.now();
    const list = this.messages.get(chatId) ?? [];
    this.messages.set(chatId, [...list, { id, ...message, createdAt: at }]);
    const chat = this.chats.get(chatId);
    if (chat) this.chats.set(chatId, { ...chat, updatedAt: at });
    this.emit();
    return id;
  }

  watchArtifact(_projectId: string, artifactId: string, onData: (artifact: WorkspaceArtifact | null) => void) {
    return this.watch(() => {
      const artifact = this.artifacts.get(artifactId);
      onData(artifact ? { ...artifact } : null);
    });
  }

  async getArtifact(_projectId: string, artifactId: string) {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? { ...artifact } : null;
  }

  async createArtifact(_projectId: string, input: Parameters<WorkspaceStore["createArtifact"]>[1]) {
    const id = this.id("a");
    this.artifacts.set(id, { id, ...input, status: "generating", version: 0, updatedAt: this.now() });
    this.emit();
    return id;
  }

  async updateArtifact(_projectId: string, artifactId: string, patch: Parameters<WorkspaceStore["updateArtifact"]>[2]) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error("This artifact no longer exists.");
    this.artifacts.set(artifactId, { ...artifact, ...patch, updatedAt: this.now() });
    this.emit();
  }

  async commitVersion(_projectId: string, artifactId: string, input: Parameters<WorkspaceStore["commitVersion"]>[2]) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error("This artifact no longer exists.");
    const version = artifact.version + 1;
    const at = this.now();
    this.versions.set(artifactId, [
      ...(this.versions.get(artifactId) ?? []),
      { version, ...input, updatedAt: at, chatId: artifact.chatId },
    ]);
    const next: WorkspaceArtifact = { ...artifact, ...input, version, status: "ready", updatedAt: at };
    delete next.error;
    this.artifacts.set(artifactId, next);
    this.emit();
    return version;
  }

  async saveSet(_projectId: string, chatId: string, set: Parameters<WorkspaceStore["saveSet"]>[2]) {
    const id = this.id("s");
    this.sets.set(chatId, [...(this.sets.get(chatId) ?? []), { id, ...set, createdAt: this.now() }]);
    return id;
  }

  async updateSetProject(_projectId: string, chatId: string, setId: string, project: StoredSet["project"]) {
    this.sets.set(
      chatId,
      (this.sets.get(chatId) ?? []).map((s) => (s.id === setId ? { ...s, project } : s)),
    );
  }

  async latestSet(_projectId: string, chatId: string) {
    const list = this.sets.get(chatId) ?? [];
    return list.length > 0 ? list[list.length - 1] : null;
  }

  watchSiteReport(projectId: string, onData: (report: SiteReport | null) => void) {
    return this.watch(() => onData(this.siteReports.get(projectId) ?? null));
  }

  watchDocuments(projectId: string, onData: (documents: ProjectDocument[]) => void) {
    return this.watch(() => onData((this.documents.get(projectId) ?? []).map(({ pages: _p, file: _f, ...d }) => d)));
  }

  async addDocument(projectId: string, input: NewDocument) {
    const id = this.id("d");
    const at = this.now();
    const d: ProjectDocument & { pages: PageText[]; file: Blob } = {
      id,
      name: input.name,
      kind: defaultDocumentKind(input.contentType),
      status: "final",
      source: "upload",
      contentType: input.contentType,
      size: input.file.size,
      storagePath: `projects/${projectId}/documents/${id}/${input.name}`,
      pageCount: input.pages.length,
      uploadedBy: input.uploadedBy,
      createdAt: at,
      updatedAt: at,
      pages: input.pages,
      file: input.file,
      ...(input.truncated ? { truncated: true } : {}),
      ...(input.chatId ? { chatId: input.chatId } : {}),
    };
    this.documents.set(projectId, [d, ...(this.documents.get(projectId) ?? [])]);
    this.emit();
    return id;
  }

  async addLink(projectId: string, input: NewLink) {
    const url = input.url.trim();
    if (!isWebLink(url)) throw new Error("Enter a link that starts with https:// or http://.");
    const id = this.id("d");
    const at = this.now();
    const d: ProjectDocument & { pages: PageText[]; file: Blob } = {
      id,
      name: input.name.trim() || url,
      kind: input.kind,
      status: input.status,
      source: "link",
      url,
      contentType: "text/uri-list",
      size: 0,
      storagePath: "",
      pageCount: 0,
      uploadedBy: input.addedBy,
      createdAt: at,
      updatedAt: at,
      pages: [],
      file: new Blob([]),
    };
    this.documents.set(projectId, [d, ...(this.documents.get(projectId) ?? [])]);
    this.emit();
    return id;
  }

  async updateDocument(projectId: string, documentId: string, patch: DocumentPatch) {
    const list = this.documents.get(projectId) ?? [];
    if (!list.some((d) => d.id === documentId)) throw new Error("This document no longer exists.");
    const at = this.now();
    this.documents.set(
      projectId,
      list.map((d) =>
        d.id === documentId
          ? {
              ...d,
              ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
              ...(patch.kind ? { kind: patch.kind } : {}),
              ...(patch.status ? { status: patch.status } : {}),
              updatedAt: at,
            }
          : d,
      ),
    );
    this.emit();
  }

  async documentUrl(projectId: string, document: ProjectDocument) {
    if (document.source === "link" && document.url) return document.url;
    return `memory://${projectId}/${document.id}/${encodeURIComponent(document.name)}`;
  }

  watchProjectArtifacts(projectId: string, onData: (artifacts: WorkspaceArtifact[]) => void) {
    return this.watch(() =>
      onData(
        [...this.artifacts.values()]
          .filter((a) => (this.chats.get(a.chatId)?.projectId ?? this.artifactProjects.get(a.id)) === projectId)
          .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
          .map((a) => ({ ...a })),
      ),
    );
  }

  async saveSiteArtifact(projectId: string, input: Parameters<WorkspaceStore["saveSiteArtifact"]>[1]) {
    // One store holds every project, so the memory key includes the project.
    const id = `${SITE_ARTIFACT_ID}:${projectId}`;
    if (!this.artifacts.has(id)) {
      this.artifacts.set(id, { id, ...input, kind: "document", chatId: "", status: "ready", version: 0, updatedAt: this.now() });
      this.artifactProjects.set(id, projectId);
    }
    await this.commitVersion(projectId, id, input);
    return id;
  }

  async saveSiteReport(projectId: string, report: SiteReport) {
    // The same rule as Firestore: no undefined values.
    this.siteReports.set(projectId, JSON.parse(JSON.stringify(report)) as SiteReport);
    this.emit();
  }
}
