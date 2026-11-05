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
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { ADU_TYPES, JURISDICTIONS, type AduType, type Jurisdiction, type ProjectData } from "../lib/project";
import type { PageText } from "../lib/engine";
import { isSiteReport } from "../site/types";
import { SITE_ARTIFACT_ID } from "../site/siteMarkdown";
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  type Chat,
  type Message,
  type MessageSource,
  type Project,
  type ProjectDocument,
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
  if (data.streaming === true) message.streaming = true;
  const sources = sourcesFromData(data.sources);
  if (sources.length) message.sources = sources;
  return message;
}

function sourcesFromData(value: unknown): MessageSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x: unknown): x is { id?: unknown; name?: unknown } => typeof x === "object" && x !== null)
    .map((x) => ({ id: text(x.id), name: text(x.name) }))
    .filter((x) => x.id !== "");
}

export function documentFromData(id: string, data: DocumentData): ProjectDocument {
  const d: ProjectDocument = {
    id,
    name: text(data.name, "Untitled file"),
    contentType: text(data.contentType, "application/octet-stream"),
    size: count(data.size),
    storagePath: text(data.storagePath),
    pageCount: count(data.pageCount),
    uploadedBy: text(data.uploadedBy),
    createdAt: toDate(data.createdAt),
  };
  if (data.truncated === true) d.truncated = true;
  if (typeof data.chatId === "string") d.chatId = data.chatId;
  return d;
}

/** Storage keeps the original name, minus characters that make awkward paths. */
const storageName = (name: string) => name.replace(/[\\/#?\[\]*]+/g, "_").slice(0, 180) || "file";

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
export function createFirestoreStore(db: Firestore, storage?: FirebaseStorage | null): WorkspaceStore {
  /** Deletes the documents in batches (Firestore takes up to 500 writes in one). */
  async function deleteAll(refs: DocumentReference[]) {
    for (let i = 0; i < refs.length; i += 450) {
      const batch = writeBatch(db);
      for (const ref of refs.slice(i, i + 450)) batch.delete(ref);
      await batch.commit();
    }
  }

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

    async deleteChat(projectId, chatId) {
      const refs: DocumentReference[] = [];
      for (const sub of ["messages", "sets"]) {
        const snap = await getDocs(collection(db, "projects", projectId, "chats", chatId, sub));
        refs.push(...snap.docs.map((d) => d.ref));
      }
      const artifacts = await getDocs(query(collection(db, "projects", projectId, "artifacts"), where("chatId", "==", chatId)));
      for (const a of artifacts.docs) {
        refs.push(...(await getDocs(collection(a.ref, "versions"))).docs.map((d) => d.ref), a.ref);
      }
      refs.push(chatDoc(projectId, chatId));
      await deleteAll(refs);
    },

    async deleteProject(projectId) {
      const refs: DocumentReference[] = [];
      const files: string[] = [];
      for (const c of (await getDocs(collection(db, "projects", projectId, "chats"))).docs) {
        for (const sub of ["messages", "sets"]) refs.push(...(await getDocs(collection(c.ref, sub))).docs.map((d) => d.ref));
        refs.push(c.ref);
      }
      for (const a of (await getDocs(collection(db, "projects", projectId, "artifacts"))).docs) {
        refs.push(...(await getDocs(collection(a.ref, "versions"))).docs.map((d) => d.ref), a.ref);
      }
      for (const d of (await getDocs(collection(db, "projects", projectId, "documents"))).docs) {
        const path = d.get("storagePath");
        if (typeof path === "string" && path) files.push(path);
        refs.push(d.ref);
      }
      refs.push(doc(db, "projects", projectId, "site", "report"), projectDoc(projectId));
      // The files first: a file left over without its record would never be found again.
      if (storage) {
        await Promise.all(
          files.map((path) =>
            deleteObject(storageRef(storage, path)).catch((err: { code?: string }) => {
              if (err?.code !== "storage/object-not-found") throw err;
            }),
          ),
        );
      }
      await deleteAll(refs);
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
      if (message.sources?.length) data.sources = message.sources.map(({ id, name }) => ({ id, name }));
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

    async saveSiteArtifact(projectId, input) {
      return runTransaction(db, async (tx) => {
        const ref = artifactDoc(projectId, SITE_ARTIFACT_ID);
        const snap = await tx.get(ref);
        const version = snap.exists() ? artifactFromData(snap.id, snap.data()).version + 1 : 1;
        tx.set(doc(db, "projects", projectId, "artifacts", SITE_ARTIFACT_ID, "versions", String(version)), {
          version,
          title: input.title,
          content: input.content,
          updatedBy: input.updatedBy,
          updatedAt: serverTimestamp(),
          chatId: "",
        });
        tx.set(ref, {
          title: input.title,
          kind: "document",
          content: input.content,
          updatedBy: input.updatedBy,
          version,
          status: "ready",
          chatId: "",
          updatedAt: serverTimestamp(),
        });
        return SITE_ARTIFACT_ID;
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

    watchDocuments(projectId, onData, onError) {
      return onSnapshot(
        query(collection(db, "projects", projectId, "documents"), orderBy("createdAt", "desc")),
        (snap) => onData(snap.docs.map((d) => documentFromData(d.id, read(d)))),
        onError,
      );
    },

    async addDocument(projectId, input) {
      if (!storage) throw new Error("File storage is not set up for this dashboard, so files cannot be uploaded yet.");
      const size = input.pages.reduce((sum, p) => sum + p.text.length, 0);
      if (size > MAX_SET_CHARS) throw new Error("The text of this file is too large to keep. Split it into smaller files.");
      const ref = doc(collection(db, "projects", projectId, "documents"));
      const storagePath = `projects/${projectId}/documents/${ref.id}/${storageName(input.name)}`;
      // The file first: a document record never points at a file that is not there.
      await uploadBytes(storageRef(storage, storagePath), input.file, { contentType: input.contentType });
      const data: DocumentData = {
        name: input.name,
        contentType: input.contentType,
        size: input.file.size,
        storagePath,
        pages: input.pages,
        pageCount: input.pages.length,
        uploadedBy: input.uploadedBy,
        createdAt: serverTimestamp(),
      };
      if (input.truncated) data.truncated = true;
      if (input.chatId) data.chatId = input.chatId;
      await setDoc(ref, data);
      return ref.id;
    },

    async documentUrl(_projectId, document) {
      if (!storage) throw new Error("File storage is not set up for this dashboard.");
      return getDownloadURL(storageRef(storage, document.storagePath));
    },

    watchProjectArtifacts(projectId, onData, onError) {
      return onSnapshot(
        query(collection(db, "projects", projectId, "artifacts"), orderBy("updatedAt", "desc")),
        (snap) => onData(snap.docs.map((d) => artifactFromData(d.id, read(d)))),
        onError,
      );
    },

    async saveSiteReport(projectId, report) {
      // Firestore refuses undefined values; the JSON round trip drops them.
      await setDoc(doc(db, "projects", projectId, "site", "report"), JSON.parse(JSON.stringify(report)) as DocumentData);
    },
  };
}
