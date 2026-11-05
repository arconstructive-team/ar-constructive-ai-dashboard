import type {
  Chat,
  Message,
  Project,
  StoredSet,
  WorkspaceArtifact,
  WorkspaceStore,
} from "./types";

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
    this.projects.set(id, { id, ...input, createdBy: by.email, createdAt: this.now(), members: ["team"] });
    this.emit();
    return id;
  }

  async renameProject(projectId: string, name: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("This project no longer exists.");
    this.projects.set(projectId, { ...project, name });
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
}
