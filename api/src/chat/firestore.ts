// The chat store on the company's Firestore database, through the Admin SDK. It writes the same
// documents as the web app (web/src/workspace/firestoreStore.ts), so the team sees the
// assistant's replies and documents live. Admin writes skip the Firestore rules: the server
// checks the team list itself before it gets here (./auth.ts).
import { FieldValue, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { ArtifactDoc, ArtifactKind, ArtifactStatus, ChatStore, StoredMessage, StoredSet } from "./store";

const KINDS: ArtifactKind[] = ["issue_report", "sheet_set", "document"];
const STATUSES: ArtifactStatus[] = ["generating", "ready", "error"];
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const millis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : 0);

function artifactFrom(id: string, data: DocumentData): ArtifactDoc {
  return {
    id,
    title: text(data.title, "Untitled artifact"),
    kind: KINDS.find((k) => k === data.kind) ?? "document",
    status: STATUSES.find((s) => s === data.status) ?? "ready",
    content: text(data.content),
    version: count(data.version),
    chatId: text(data.chatId),
  };
}

export function createFirestoreChatStore(db: Firestore): ChatStore {
  const projectDoc = (p: string) => db.collection("projects").doc(p);
  const chatDoc = (p: string, c: string) => projectDoc(p).collection("chats").doc(c);
  const messages = (p: string, c: string) => chatDoc(p, c).collection("messages");
  const artifacts = (p: string) => projectDoc(p).collection("artifacts");

  return {
    async getProject(projectId) {
      const snap = await projectDoc(projectId).get();
      if (!snap.exists) return null;
      const data = snap.data() ?? {};
      return {
        id: snap.id,
        name: text(data.name, "Untitled project"),
        address: text(data.address),
        jurisdiction: text(data.jurisdiction),
        aduType: text(data.aduType),
      };
    },

    async chatExists(projectId, chatId) {
      return (await chatDoc(projectId, chatId).get()).exists;
    },

    async listMessages(projectId, chatId, limit) {
      const snap = await messages(projectId, chatId).orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs
        .map((d): StoredMessage => {
          const data = d.data();
          const message: StoredMessage = {
            id: d.id,
            role: data.role === "assistant" ? "assistant" : "user",
            text: text(data.text),
            author: text(data.author),
          };
          if (typeof data.artifactId === "string") message.artifactId = data.artifactId;
          return message;
        })
        .reverse();
    },

    async latestSet(projectId, chatId) {
      const snap = await chatDoc(projectId, chatId).collection("sets").orderBy("createdAt", "desc").limit(1).get();
      const first = snap.docs[0];
      if (!first) return null;
      const data = first.data();
      const project = (data.project ?? {}) as Record<string, unknown>;
      const set: StoredSet = {
        id: first.id,
        fileName: text(data.fileName),
        pages: Array.isArray(data.pages)
          ? data.pages
              .filter((p: unknown) => typeof p === "object" && p !== null)
              .map((p: { page?: unknown; text?: unknown }) => ({ page: count(p.page), text: text(p.text) }))
          : [],
        project: { address: text(project.address), jurisdiction: text(project.jurisdiction), aduType: text(project.aduType) },
      };
      return set;
    },

    async addMessage(projectId, chatId, message) {
      const ref = messages(projectId, chatId).doc();
      const data: DocumentData = {
        role: message.role,
        text: message.text,
        author: message.author,
        createdAt: FieldValue.serverTimestamp(),
      };
      if (message.artifactId) data.artifactId = message.artifactId;
      if (message.streaming !== undefined) data.streaming = message.streaming;
      const batch = db.batch();
      batch.set(ref, data);
      batch.update(chatDoc(projectId, chatId), { updatedAt: FieldValue.serverTimestamp() });
      await batch.commit();
      return ref.id;
    },

    async updateMessage(projectId, chatId, messageId, patch) {
      const data: DocumentData = {};
      if (patch.text !== undefined) data.text = patch.text;
      if (patch.artifactId !== undefined) data.artifactId = patch.artifactId;
      if (patch.streaming !== undefined) data.streaming = patch.streaming;
      await messages(projectId, chatId).doc(messageId).update(data);
    },

    async getArtifact(projectId, artifactId) {
      const snap = await artifacts(projectId).doc(artifactId).get();
      return snap.exists ? artifactFrom(snap.id, snap.data() ?? {}) : null;
    },

    async listChatArtifacts(projectId, chatId) {
      // One equality filter needs no composite index; sort in memory.
      const snap = await artifacts(projectId).where("chatId", "==", chatId).get();
      return snap.docs
        .map((d) => ({ doc: artifactFrom(d.id, d.data()), at: millis(d.get("updatedAt")) }))
        .sort((a, b) => b.at - a.at)
        .map((a) => a.doc);
    },

    async createArtifact(projectId, input) {
      const ref = await artifacts(projectId).add({
        ...input,
        content: "",
        status: "generating",
        version: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return ref.id;
    },

    async updateArtifact(projectId, artifactId, patch) {
      const data: DocumentData = { updatedAt: FieldValue.serverTimestamp(), updatedBy: patch.updatedBy };
      if (patch.title !== undefined) data.title = patch.title;
      if (patch.content !== undefined) data.content = patch.content;
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.error !== undefined) data.error = patch.error;
      await artifacts(projectId).doc(artifactId).update(data);
    },

    async commitVersion(projectId, artifactId, input) {
      const ref = artifacts(projectId).doc(artifactId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("This artifact was deleted.");
        const current = artifactFrom(snap.id, snap.data() ?? {});
        const version = current.version + 1;
        tx.set(ref.collection("versions").doc(String(version)), {
          version,
          title: input.title,
          content: input.content,
          updatedBy: input.updatedBy,
          updatedAt: FieldValue.serverTimestamp(),
          chatId: current.chatId || input.chatId,
        });
        tx.update(ref, {
          title: input.title,
          content: input.content,
          updatedBy: input.updatedBy,
          version,
          status: "ready",
          error: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return version;
      });
    },
  };
}
