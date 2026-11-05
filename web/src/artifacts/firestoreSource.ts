import {
  Timestamp,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  ArtifactMissingError,
  checkSave,
  type Artifact,
  type ArtifactRef,
  type ArtifactSource,
  type ArtifactVersion,
} from "./types";

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Reads an artifact document. Unknown or missing fields fall back to safe values. */
export function artifactFromData(ref: ArtifactRef, data: DocumentData): Artifact {
  const kind = ARTIFACT_KINDS.find((k) => k === data.kind) ?? "document";
  const status = ARTIFACT_STATUSES.find((s) => s === data.status) ?? "ready";
  const artifact: Artifact = {
    id: ref.artifactId,
    projectId: ref.projectId,
    title: text(data.title, "Untitled artifact"),
    kind,
    status,
    content: text(data.content),
    version: count(data.version),
    chatId: text(data.chatId),
    updatedBy: text(data.updatedBy),
    updatedAt: toDate(data.updatedAt),
  };
  if (typeof data.error === "string") artifact.error = data.error;
  return artifact;
}

export function versionFromData(data: DocumentData): ArtifactVersion {
  const version: ArtifactVersion = {
    version: count(data.version),
    title: text(data.title, "Untitled artifact"),
    content: text(data.content),
    updatedBy: text(data.updatedBy),
    updatedAt: toDate(data.updatedAt),
  };
  if (typeof data.restoredFrom === "number") version.restoredFrom = data.restoredFrom;
  return version;
}

const artifactPath = (ref: ArtifactRef) => ["projects", ref.projectId, "artifacts", ref.artifactId] as const;

/** Artifacts in Firestore, as the projects and team chat work stores them. */
export function createFirestoreSource(db: Firestore): ArtifactSource {
  const artifactDoc = (ref: ArtifactRef) => doc(db, ...artifactPath(ref));
  const versionDoc = (ref: ArtifactRef, version: number) => doc(db, ...artifactPath(ref), "versions", String(version));

  return {
    watch(ref, onData, onError) {
      return onSnapshot(
        artifactDoc(ref),
        (snap) => onData(snap.exists() ? artifactFromData(ref, snap.data()) : null),
        (error) => onError(error),
      );
    },

    async listVersions(ref) {
      const snap = await getDocs(query(collection(db, ...artifactPath(ref), "versions"), orderBy("version", "desc")));
      return snap.docs.map((d) => versionFromData(d.data()));
    },

    async saveVersion(ref, input) {
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(artifactDoc(ref));
        if (!snap.exists()) throw new ArtifactMissingError();
        const current = artifactFromData(ref, snap.data());
        checkSave(current, input);
        // Every read happens before the first write, as transactions require.
        const previous = current.version > 0 ? await tx.get(versionDoc(ref, current.version)) : null;
        const next = current.version + 1;

        if (previous && !previous.exists()) {
          // Keep the version this edit replaces, so it can be restored.
          tx.set(versionDoc(ref, current.version), {
            version: current.version,
            title: current.title,
            content: current.content,
            updatedBy: current.updatedBy,
            updatedAt: current.updatedAt ?? serverTimestamp(),
            chatId: current.chatId,
          });
        }

        const saved: DocumentData = {
          version: next,
          title: input.title,
          content: input.content,
          updatedBy: input.updatedBy,
          updatedAt: serverTimestamp(),
          chatId: current.chatId,
        };
        if (input.restoredFrom !== undefined) saved.restoredFrom = input.restoredFrom;
        tx.set(versionDoc(ref, next), saved);
        tx.update(artifactDoc(ref), {
          title: input.title,
          content: input.content,
          version: next,
          updatedBy: input.updatedBy,
          updatedAt: serverTimestamp(),
        });
        return next;
      });
    },
  };
}
