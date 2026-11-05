/**
 * Projects, chat sessions, messages and artifacts, shared by the whole team.
 *
 * Firestore layout (the artifact canvas builds against the same names):
 * - projects/{projectId}: name, createdBy, createdAt, members, address, jurisdiction, aduType
 * - projects/{projectId}/chats/{chatId}: title, createdBy, createdAt, updatedAt
 * - projects/{projectId}/chats/{chatId}/messages/{messageId}: role, text, author, createdAt, artifactId?
 * - projects/{projectId}/chats/{chatId}/sets/{setId}: fileName, pages, project, createdAt
 * - projects/{projectId}/documents/{documentId}: name, contentType, size, storagePath, pages, pageCount,
 *   truncated?, uploadedBy, createdAt, chatId? (the file itself in Storage at storagePath)
 * - projects/{projectId}/artifacts/{artifactId}: title, kind, status, content, version, chatId, updatedBy, updatedAt
 * - projects/{projectId}/artifacts/{artifactId}/versions/{version}: version, title, content, updatedBy, updatedAt, chatId
 * - projects/{projectId}/site/report: the site report (see site/types.ts); the chat assistant reads it too
 */
import type { PageText } from "../lib/engine";
import type { AduType, Jurisdiction, ProjectData } from "../lib/project";
import type { SiteReport } from "../site/types";

export type Unsubscribe = () => void;

/** The signed-in person who writes a project, chat or message. */
export interface Author {
  uid: string;
  email: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date | null;
  /** Team-wide for now: every team member sees every project. */
  members: string[];
  address: string;
  jurisdiction: Jurisdiction | "";
  aduType: AduType;
}

export interface NewProject {
  name: string;
  address: string;
  jurisdiction: Jurisdiction;
  aduType: AduType;
}

export interface Chat {
  id: string;
  projectId: string;
  title: string;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type MessageRole = "user" | "assistant";

/**
 * A project document attached to a message with the Sources button. The id says which kind:
 * "doc:{documentId}" for an uploaded file, "artifact:{artifactId}" for an artifact.
 */
export interface MessageSource {
  id: string;
  name: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  author: string;
  createdAt: Date | null;
  artifactId?: string;
  sources?: MessageSource[];
  /** True while the server is still writing this assistant reply. */
  streaming?: boolean;
}

export interface NewMessage {
  role: MessageRole;
  text: string;
  author: string;
  artifactId?: string;
  sources?: MessageSource[];
}

/** A file in the project's documents: uploaded on the Documents page or with a chat's + button. */
export interface ProjectDocument {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Where the file is in Firebase Storage. */
  storagePath: string;
  /** Pages (or parts) of text the assistant can read; 0 for scans, images and other files. */
  pageCount: number;
  /** Only the first part of a very long file's text was kept. */
  truncated?: boolean;
  uploadedBy: string;
  createdAt: Date | null;
  /** The chat the file was uploaded in, when it came from a chat. */
  chatId?: string;
}

export interface NewDocument {
  file: Blob;
  name: string;
  contentType: string;
  uploadedBy: string;
  /** The text the browser read from the file, a page (or part) at a time. */
  pages: PageText[];
  truncated?: boolean;
  chatId?: string;
}

export type ArtifactKind = "issue_report" | "sheet_set" | "document";
export type ArtifactStatus = "generating" | "ready" | "error";

export const ARTIFACT_KINDS: ArtifactKind[] = ["issue_report", "sheet_set", "document"];
export const ARTIFACT_STATUSES: ArtifactStatus[] = ["generating", "ready", "error"];

export const KIND_LABEL: Record<ArtifactKind, string> = {
  issue_report: "Issue report",
  sheet_set: "Sheet set",
  document: "Document",
};

export interface WorkspaceArtifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  /** Markdown with GitHub-style tables. */
  content: string;
  /** The current version number. 0 while the first generation runs. */
  version: number;
  chatId: string;
  updatedBy: string;
  updatedAt: Date | null;
  /** Why generation stopped, when status is "error". */
  error?: string;
}

export interface NewArtifact {
  title: string;
  kind: ArtifactKind;
  chatId: string;
  updatedBy: string;
  content: string;
}

export interface ArtifactPatch {
  title?: string;
  status?: ArtifactStatus;
  content?: string;
  error?: string;
}

export interface VersionInput {
  title: string;
  content: string;
  updatedBy: string;
}

/** The text of an uploaded permit set, kept so later messages can check it again. */
export interface StoredSet {
  id: string;
  fileName: string;
  pages: PageText[];
  project: ProjectData;
  createdAt: Date | null;
}

export type NewSet = Omit<StoredSet, "id" | "createdAt">;

export type OnError = (error: Error) => void;

/** Where the workspace data lives: Firestore in the app, memory in tests. */
export interface WorkspaceStore {
  watchProjects(onData: (projects: Project[]) => void, onError: OnError): Unsubscribe;
  createProject(input: NewProject, by: Author): Promise<string>;
  renameProject(projectId: string, name: string): Promise<void>;

  /**
   * Deletes the project for the whole team: its chats with their messages and sets, its artifacts
   * with their versions, its documents with their files, and its site report.
   */
  deleteProject(projectId: string): Promise<void>;

  watchChats(projectId: string, onData: (chats: Chat[]) => void, onError: OnError): Unsubscribe;
  /** Deletes the chat, its messages and sets, and the artifacts written in it. Its uploaded files stay in the documents. */
  deleteChat(projectId: string, chatId: string): Promise<void>;
  createChat(projectId: string, title: string, by: Author): Promise<string>;
  renameChat(projectId: string, chatId: string, title: string): Promise<void>;

  watchMessages(projectId: string, chatId: string, onData: (messages: Message[]) => void, onError: OnError): Unsubscribe;
  addMessage(projectId: string, chatId: string, message: NewMessage): Promise<string>;

  watchArtifact(
    projectId: string,
    artifactId: string,
    onData: (artifact: WorkspaceArtifact | null) => void,
    onError: OnError,
  ): Unsubscribe;
  getArtifact(projectId: string, artifactId: string): Promise<WorkspaceArtifact | null>;
  /** Creates an artifact with status "generating" and version 0. */
  createArtifact(projectId: string, input: NewArtifact): Promise<string>;
  updateArtifact(projectId: string, artifactId: string, patch: ArtifactPatch): Promise<void>;
  /** Saves a new version, makes it current and sets status "ready". Resolves with the version number. */
  commitVersion(projectId: string, artifactId: string, input: VersionInput): Promise<number>;

  saveSet(projectId: string, chatId: string, set: NewSet): Promise<string>;
  updateSetProject(projectId: string, chatId: string, setId: string, project: ProjectData): Promise<void>;
  latestSet(projectId: string, chatId: string): Promise<StoredSet | null>;

  /** The project's site report (projects/{id}/site/report), or null before the first run. */
  watchSiteReport(projectId: string, onData: (report: SiteReport | null) => void, onError: OnError): Unsubscribe;
  saveSiteReport(projectId: string, report: SiteReport): Promise<void>;

  /** The project's uploaded files, newest first. */
  watchDocuments(projectId: string, onData: (documents: ProjectDocument[]) => void, onError: OnError): Unsubscribe;
  /** Stores the file and its text. Returns the document id. */
  addDocument(projectId: string, input: NewDocument): Promise<string>;
  /** A link that opens or downloads the stored file. */
  documentUrl(projectId: string, document: ProjectDocument): Promise<string>;
  /** Every artifact of the project, from all its chats, newest first. */
  watchProjectArtifacts(projectId: string, onData: (artifacts: WorkspaceArtifact[]) => void, onError: OnError): Unsubscribe;
}
