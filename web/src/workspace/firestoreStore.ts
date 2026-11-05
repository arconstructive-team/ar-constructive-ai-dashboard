import {
  Timestamp,
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { ADU_TYPES, JURISDICTIONS, type AduType, type Jurisdiction, type ProjectData } from "../lib/project";
import type { PageText } from "../lib/engine";
import { isSiteReport } from "../site/types";
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  type Chat,
  type Message,
  type Project,
  type StoredSet,
  type WorkspaceArtifact,
  type WorkspaceStore,
} from "./types";

/** Firestore refuses documents over 1 MiB; keep a margin for the other fields. */
export const MAX_SET_CHARS = 900_000;

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const read = (d: QueryDocumentSnapshot) => d.data({ serverTimestamps: "estimate" });

export function projectFromData(id: string, data: DocumentData): Project {
  return {
    id,
    name: text(data.name, "Untitled project"),
    createdBy: text(data.createdBy),
    createdAt: toDate(data.createdAt),
    members: Array.isArray(data.members) ? data.members.filter((m: unknown): m is string => typeof m === "string") : [],
    address: text(data.address),
    jurisdiction: (JURISDICTIONS as readonly string[]).includes(data.jurisdiction) ? (data.jurisdiction as Jurisdiction) : "",
    aduType: (ADU_TYPES as readonly string[]).includes(data.aduType) ? (data.aduType as AduType) : "No ADU",
  };
}

export function chatFromData(projectId: string, id: string, data: DocumentData): Chat {
  return {
    id,
    projectId,
    title: text(data.title, "Untitled chat"),
    createdBy: text(data.createdBy),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function messageFromData(id: string, data: DocumentData): Message {
  const message: Message = {
    id,
    role: data.role === "assistant" ? "assistant" : "user",
    text: text(data.text),
    author: text(data.author),
    createdAt: toDate(data.createdAt),
  };
  if (typeof data.artifactId === "string") message.artifactId = data.artifactId;
  return message;
}

export function artifactFromData(id: string, data: DocumentData): WorkspaceArtifact {
  const artifact: WorkspaceArtifact = {
    id,
    title: text(data.title, "Untitled artifact"),
    kind: ARTIFACT_KINDS.find((k) => k === data.kind) ?? "document",
    status: ARTIFACT_STATUSES.find((s) => s === data.status) ?? "ready",
    content: text(data.content),
    version: count(data.version),
    chatId: text(data.chatId),
    updatedBy: text(data.updatedBy),
    updatedAt: toDate(data.updatedAt),
  };
  if (typeof data.error === "string") artifact.error = data.error;
  return artifact;
}

function setFromData(id: string, data: DocumentData): StoredSet {
  const pages: PageText[] = Array.isArray(data.pages)
    ? data.pages
        .filter((p: unknown) => typeof p === "object" && p !== null)
        .map((p: { page?: unknown; text?: unknown }) => ({ page: count(p.page), text: text(p.text) }))
    : [];
  const project = (data.project ?? {}) as Partial<ProjectData>;
  return {
    id,
    fileName: text(data.fileName),
    pages,
    project: {
      address: text(project.address),
      jurisdiction: (JURISDICTIONS as readonly string[]).includes(project.jurisdiction ?? "")
        ? (project.jurisdiction as Jurisdiction)
        : "",
      aduType: (ADU_TYPES as readonly string[]).includes(project.aduType ?? "") ? (project.aduType as AduType) : "No ADU",
    },
    createdAt: toDate(data.createdAt),
  };
}

/** The team workspace in the company's Firestore database. */
export function createFirestoreStore(db: Firestore): WorkspaceStore {
  const projectDoc = (projectId: string) => doc(db, "projects", projectId);
  const chatDoc = (projectId: string, chatId: string) => doc(db, "projects", projectId, "chats", chatId);
  const artifactDoc = (projectId: string, artifactId: string) => doc(db, "projects", projectId, "artifacts", artifactId);

  return {
    watchProjects(onData, onError) {
      return onSnapshot(
        query(collection(db, "projects"), orderBy("createdAt", "asc")),
        (snap) => onData(snap.docs.map((d) => projectFromData(d.id, read(d)))),
        onError,
      );
    },

    async createProject(input, by) {
      const ref = await addDoc(collection(db, "projects"), {
        ...input,
        createdBy: by.email,
        createdAt: serverTimestamp(),
        members: ["team"],
      });
      return ref.id;
    },

    async renameProject(projectId, name) {
      await updateDoc(projectDoc(projectId), { name });
    },

    watchChats(projectId, onData, onError) {
      return onSnapshot(
        query(collection(db, "projects", projectId, "chats"), orderBy("updatedAt", "desc")),
        (snap) => onData(snap.docs.map((d) => chatFromData(projectId, d.id, read(d)))),
        onError,
      );
    },

    async createChat(projectId, title, by) {
      const ref = await addDoc(collection(db, "projects", projectId, "chats"), {
        title,
        createdBy: by.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },

    async renameChat(projectId, chatId, title) {
      await updateDoc(chatDoc(projectId, chatId), { title });
    },

    watchMessages(projectId, chatId, onData, onError) {
      return onSnapshot(
        query(collection(db, "projects", projectId, "chats", chatId, "messages"), orderBy("createdAt", "asc")),
        (snap) => onData(snap.docs.map((d) => messageFromData(d.id, read(d)))),
        onError,
      );
    },

    async addMessage(projectId, chatId, message) {
      const batch = writeBatch(db);
      const ref = doc(collection(db, "projects", projectId, "chats", chatId, "messages"));
      const data: DocumentData = { role: message.role, text: message.text, author: message.author, createdAt: serverTimestamp() };
      if (message.artifactId) data.artifactId = message.artifactId;
      batch.set(ref, data);
      batch.update(chatDoc(projectId, chatId), { updatedAt: serverTimestamp() });
      await batch.commit();
      return ref.id;
    },

    watchArtifact(projectId, artifactId, onData, onError) {
      return onSnapshot(
        artifactDoc(projectId, artifactId),
        (snap) => onData(snap.exists() ? artifactFromData(snap.id, snap.data({ serverTimestamps: "estimate" })) : null),
        onError,
      );
    },

    async getArtifact(projectId, artifactId) {
      const snap = await getDoc(artifactDoc(projectId, artifactId));
      return snap.exists() ? artifactFromData(snap.id, snap.data()) : null;
    },

    async createArtifact(projectId, input) {
      const ref = await addDoc(collection(db, "projects", projectId, "artifacts"), {
        ...input,
        status: "generating",
        version: 0,
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },

    async updateArtifact(projectId, artifactId, patch) {
      await updateDoc(artifactDoc(projectId, artifactId), { ...patch, updatedAt: serverTimestamp() });
    },

    async commitVersion(projectId, artifactId, input) {
      return runTransaction(db, async (tx) => {
        const ref = artifactDoc(projectId, artifactId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("This artifact was deleted, or you no longer have access to it.");
        const current = artifactFromData(snap.id, snap.data());
        const version = current.version + 1;
        tx.set(doc(db, "projects", projectId, "artifacts", artifactId, "versions", String(version)), {
          version,
          title: input.title,
          content: input.content,
          updatedBy: input.updatedBy,
          updatedAt: serverTimestamp(),
          chatId: current.chatId,
        });
        tx.update(ref, {
          title: input.title,
          content: input.content,
          updatedBy: input.updatedBy,
          version,
          status: "ready",
          error: deleteField(),
          updatedAt: serverTimestamp(),
        });
        return version;
      });
    },

    async saveSet(projectId, chatId, set) {
      const size = set.pages.reduce((sum, p) => sum + p.text.length, 0);
      if (size > MAX_SET_CHARS) {
        throw new Error("The text of this set is too large to keep for the team.");
      }
      const ref = await addDoc(collection(db, "projects", projectId, "chats", chatId, "sets"), {
        ...set,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },

    async updateSetProject(projectId, chatId, setId, project) {
      await updateDoc(doc(db, "projects", projectId, "chats", chatId, "sets", setId), { project });
    },

    async latestSet(projectId, chatId) {
      const snap = await getDocs(
        query(collection(db, "projects", projectId, "chats", chatId, "sets"), orderBy("createdAt", "desc"), limit(1)),
      );
      const first = snap.docs[0];
      return first ? setFromData(first.id, first.data()) : null;
    },

    watchSiteReport(projectId, onData, onError) {
      return onSnapshot(
        doc(db, "projects", projectId, "site", "report"),
        (snap) => {
          const data: unknown = snap.exists() ? snap.data() : null;
          onData(isSiteReport(data) ? data : null);
        },
        onError,
      );
    },

    async saveSiteReport(projectId, report) {
      // Firestore refuses undefined values; the JSON round trip drops them.
      await setDoc(doc(db, "projects", projectId, "site", "report"), JSON.parse(JSON.stringify(report)) as DocumentData);
    },
  };
}
