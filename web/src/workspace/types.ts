/**
 * Projects, chat sessions, messages and artifacts, shared by the whole team.
 *
 * Firestore layout (the artifact canvas builds against the same names):
 * - projects/{projectId}: name, createdBy, createdAt, members, address, jurisdiction, aduType
 * - projects/{projectId}/chats/{chatId}: title, createdBy, createdAt, updatedAt
 * - projects/{projectId}/chats/{chatId}/messages/{messageId}: role, text, author, createdAt, artifactId?
 * - projects/{projectId}/chats/{chatId}/sets/{setId}: fileName, pages, project, createdAt
 * - projects/{projectId}/artifacts/{artifactId}: title, kind, status, content, version, chatId, updatedBy, updatedAt
 * - projects/{projectId}/artifacts/{artifactId}/versions/{version}: version, title, content, updatedBy, updatedAt, chatId
 */
import type { PageText } from "../lib/engine";
import type { AduType, Jurisdiction, ProjectData } from "../lib/project";

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

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  author: string;
  createdAt: Date | null;
  artifactId?: string;
}

export interface NewMessage {
  role: MessageRole;
  text: string;
  author: string;
  artifactId?: string;
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

  watchChats(projectId: string, onData: (chats: Chat[]) => void, onError: OnError): Unsubscribe;
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
}
