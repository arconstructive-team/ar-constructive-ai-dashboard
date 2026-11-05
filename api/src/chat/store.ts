// What the chat assistant reads and writes in the shared workspace. Firestore implements it in
// production (./firestore.ts), with the same documents the web app writes; tests use the
// in-memory store below.
import type { PageText } from "../engine/types";
import type { SiteReport } from "../site/types";

export type ArtifactKind = "issue_report" | "sheet_set" | "document";
export type ArtifactStatus = "generating" | "ready" | "error";

export interface ChatProject {
  id: string;
  name: string;
  address: string;
  jurisdiction: string;
  aduType: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  author: string;
  artifactId?: string;
}

export interface StoredSet {
  id: string;
  fileName: string;
  pages: PageText[];
  project: { address: string; jurisdiction: string; aduType: string };
}

export interface ArtifactDoc {
  id: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  content: string;
  version: number;
  chatId: string;
}

export interface NewMessage {
  role: "assistant";
  text: string;
  author: string;
  artifactId?: string;
  /** true while the reply is still being written. */
  streaming?: boolean;
}

export interface MessagePatch {
  text?: string;
  artifactId?: string;
  streaming?: boolean;
}

export interface ChatStore {
  getProject(projectId: string): Promise<ChatProject | null>;
  chatExists(projectId: string, chatId: string): Promise<boolean>;
  /** The newest `limit` messages of the chat, oldest first. */
  listMessages(projectId: string, chatId: string, limit: number): Promise<StoredMessage[]>;
  /** The permit set uploaded last in the chat, or null. */
  latestSet(projectId: string, chatId: string): Promise<StoredSet | null>;
  /** The project's saved site report (projects/{projectId}/site/report), or null. */
  getSiteReport(projectId: string): Promise<SiteReport | null>;
  addMessage(projectId: string, chatId: string, message: NewMessage): Promise<string>;
  updateMessage(projectId: string, chatId: string, messageId: string, patch: MessagePatch): Promise<void>;
  getArtifact(projectId: string, artifactId: string): Promise<ArtifactDoc | null>;
  /** The chat's artifacts, newest first. */
  listChatArtifacts(projectId: string, chatId: string): Promise<ArtifactDoc[]>;
  /** A new artifact in the "generating" state, version 0. */
  createArtifact(
    projectId: string,
    input: { title: string; kind: ArtifactKind; chatId: string; updatedBy: string },
  ): Promise<string>;
  /** Shows a part of the document while it is being written. */
  updateArtifact(
    projectId: string,
    artifactId: string,
    patch: { title?: string; content?: string; status?: ArtifactStatus; updatedBy: string; error?: string },
  ): Promise<void>;
  /** Saves the document as its next version and marks it ready. Returns the new version number. */
  commitVersion(
    projectId: string,
    artifactId: string,
    input: { title: string; content: string; updatedBy: string; chatId: string },
  ): Promise<number>;
}

interface MemoryArtifact extends ArtifactDoc {
  createdAt: number;
  updatedBy: string;
  error?: string;
  versions: Array<{ version: number; title: string; content: string; updatedBy: string; chatId: string }>;
}

/** A store in memory, for tests. */
export class MemoryChatStore implements ChatStore {
  projects = new Map<string, ChatProject>();
  chats = new Map<string, { messages: Array<StoredMessage & { streaming?: boolean }>; sets: StoredSet[] }>();
  artifacts = new Map<string, MemoryArtifact>();
  siteReports = new Map<string, SiteReport>();
  private next = 0;

  private id(prefix: string): string {
    this.next += 1;
    return `${prefix}${this.next}`;
  }

  private chat(projectId: string, chatId: string) {
    const key = `${projectId}/${chatId}`;
    let chat = this.chats.get(key);
    if (!chat) {
      chat = { messages: [], sets: [] };
      this.chats.set(key, chat);
    }
    return chat;
  }

  addProject(project: ChatProject): void {
    this.projects.set(project.id, project);
  }

  addUserMessage(projectId: string, chatId: string, author: string, text: string): string {
    const id = this.id("m");
    this.chat(projectId, chatId).messages.push({ id, role: "user", text, author });
    return id;
  }

  addSet(projectId: string, chatId: string, set: Omit<StoredSet, "id">): string {
    const id = this.id("s");
    this.chat(projectId, chatId).sets.push({ ...set, id });
    return id;
  }

  async getProject(projectId: string) {
    return this.projects.get(projectId) ?? null;
  }

  async chatExists(projectId: string, chatId: string) {
    return this.projects.has(projectId) && this.chats.has(`${projectId}/${chatId}`);
  }

  async listMessages(projectId: string, chatId: string, limit: number) {
    return this.chat(projectId, chatId)
      .messages.slice(-limit)
      .map(({ id, role, text, author, artifactId }) => ({ id, role, text, author, artifactId }));
  }

  async latestSet(projectId: string, chatId: string) {
    const sets = this.chat(projectId, chatId).sets;
    return sets[sets.length - 1] ?? null;
  }

  async getSiteReport(projectId: string) {
    return this.siteReports.get(projectId) ?? null;
  }

  async addMessage(projectId: string, chatId: string, message: NewMessage) {
    const id = this.id("m");
    this.chat(projectId, chatId).messages.push({ ...message, id });
    return id;
  }

  async updateMessage(projectId: string, chatId: string, messageId: string, patch: MessagePatch) {
    const message = this.chat(projectId, chatId).messages.find((m) => m.id === messageId);
    if (!message) throw new Error(`No message ${messageId}`);
    Object.assign(message, patch);
  }

  async getArtifact(projectId: string, artifactId: string) {
    const a = this.artifacts.get(`${projectId}/${artifactId}`);
    if (!a) return null;
    const { id, title, kind, status, content, version, chatId } = a;
    return { id, title, kind, status, content, version, chatId };
  }

  async listChatArtifacts(projectId: string, chatId: string) {
    return [...this.artifacts.entries()]
      .filter(([key, a]) => key.startsWith(`${projectId}/`) && a.chatId === chatId)
      .map(([, a]) => a)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, title, kind, status, content, version, chatId: c }) => ({ id, title, kind, status, content, version, chatId: c }));
  }

  async createArtifact(projectId: string, input: { title: string; kind: ArtifactKind; chatId: string; updatedBy: string }) {
    const id = this.id("a");
    this.artifacts.set(`${projectId}/${id}`, {
      id,
      title: input.title,
      kind: input.kind,
      status: "generating",
      content: "",
      version: 0,
      chatId: input.chatId,
      updatedBy: input.updatedBy,
      createdAt: this.next,
      versions: [],
    });
    return id;
  }

  async updateArtifact(
    projectId: string,
    artifactId: string,
    patch: { title?: string; content?: string; status?: ArtifactStatus; updatedBy: string; error?: string },
  ) {
    const a = this.artifacts.get(`${projectId}/${artifactId}`);
    if (!a) throw new Error(`No artifact ${artifactId}`);
    Object.assign(a, patch);
  }

  async commitVersion(
    projectId: string,
    artifactId: string,
    input: { title: string; content: string; updatedBy: string; chatId: string },
  ) {
    const a = this.artifacts.get(`${projectId}/${artifactId}`);
    if (!a) throw new Error(`No artifact ${artifactId}`);
    const version = a.version + 1;
    a.versions.push({ version, ...input });
    Object.assign(a, { version, title: input.title, content: input.content, status: "ready", updatedBy: input.updatedBy });
    delete a.error;
    return version;
  }
}
