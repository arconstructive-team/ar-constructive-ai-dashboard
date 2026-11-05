/**
 * The artifact contract.
 *
 * Firestore: projects/{projectId}/artifacts/{artifactId} holds the current
 * version; projects/{projectId}/artifacts/{artifactId}/versions/{version}
 * holds every saved version (document id = the version number as text).
 */

export type ArtifactKind = "issue_report" | "sheet_set" | "document";
export type ArtifactStatus = "generating" | "ready" | "error";

export const ARTIFACT_KINDS: ArtifactKind[] = ["issue_report", "sheet_set", "document"];
export const ARTIFACT_STATUSES: ArtifactStatus[] = ["generating", "ready", "error"];

export const KIND_LABEL: Record<ArtifactKind, string> = {
  issue_report: "Issue report",
  sheet_set: "Sheet set",
  document: "Document",
};

export interface Artifact {
  id: string;
  projectId: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  /** Markdown with GitHub-style tables. */
  content: string;
  /** The current version number. 0 while the first generation runs. */
  version: number;
  chatId: string;
  /** The name of the person (or "arconstructive" for the generator) who wrote the current version. */
  updatedBy: string;
  updatedAt: Date | null;
  /** Why generation stopped, when status is "error". */
  error?: string;
}

export interface ArtifactVersion {
  version: number;
  title: string;
  content: string;
  updatedBy: string;
  updatedAt: Date | null;
  /** Set when this version restored an earlier one. */
  restoredFrom?: number;
}

export interface ArtifactRef {
  projectId: string;
  artifactId: string;
}

export interface SaveVersionInput {
  title: string;
  content: string;
  /** The editor's name. */
  updatedBy: string;
  /** The version the edit started from. The save fails if someone saved a newer one. */
  baseVersion: number;
  restoredFrom?: number;
}

/** Where artifacts come from: Firestore in the app, memory in tests and the preview. */
export interface ArtifactSource {
  /** Calls onData now and on every change. Returns a function that stops watching. */
  watch(ref: ArtifactRef, onData: (artifact: Artifact | null) => void, onError: (error: Error) => void): () => void;
  /** Saved versions, newest first. */
  listVersions(ref: ArtifactRef): Promise<ArtifactVersion[]>;
  /** Writes a new version and makes it current. Resolves with the new version number. */
  saveVersion(ref: ArtifactRef, input: SaveVersionInput): Promise<number>;
}

export class ArtifactLockedError extends Error {
  constructor() {
    super("Editing is locked while the artifact is generating. Save again when it finishes.");
    this.name = "ArtifactLockedError";
  }
}

export class ArtifactConflictError extends Error {
  constructor(by: string, version: number) {
    super(
      `${by || "Someone"} saved version ${version} while you were editing. Copy your changes, select Discard, then edit the new version.`,
    );
    this.name = "ArtifactConflictError";
  }
}

export class ArtifactMissingError extends Error {
  constructor() {
    super("This artifact was deleted, or you no longer have access to it.");
    this.name = "ArtifactMissingError";
  }
}

/** Shared save rules, so the memory source and the Firestore source behave the same. */
export function checkSave(current: Artifact, input: SaveVersionInput): void {
  if (current.status === "generating") throw new ArtifactLockedError();
  if (current.version !== input.baseVersion) throw new ArtifactConflictError(current.updatedBy, current.version);
}
