// GET /api/export: every project with its client, status, site facts snapshot, documents and
// artifacts, as plain JSON, for the one-time move into the Autopo Projects dashboard. It reads the
// same Firestore documents the web app writes (web/src/workspace/firestoreStore.ts); it writes nothing.
import type { DocumentData, Firestore } from "firebase-admin/firestore";

export interface ExportDocument {
  id: string;
  title: string;
  kind: string;
  status: string;
  /** "upload" (a file in Cloud Storage) or "link" (an https URL). */
  source: string;
  /** The URL of a link; for an upload, gs://bucket/storagePath. null when neither is known. */
  link: string | null;
  url: string | null;
  storagePath: string | null;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExportArtifact {
  id: string;
  title: string;
  kind: string;
  status: string;
  version: number;
  updatedBy: string;
  updatedAt: string | null;
  /** The artifact's markdown. */
  content: string;
}

export interface ExportProject {
  id: string;
  name: string;
  address: string;
  jurisdiction: string;
  aduType: string;
  client: string;
  status: string;
  createdBy: string;
  createdAt: string | null;
  members: string[];
  /** projects/{id}.siteReport: every site fact with its sources, and fetchedAt. null before the first report. */
  siteReport: Record<string, unknown> | null;
  documents: ExportDocument[];
  artifacts: ExportArtifact[];
}

export interface ExportResult {
  exportedAt: string;
  count: number;
  projects: ExportProject[];
}

export interface ExportStore {
  exportProjects(): Promise<ExportProject[]>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** A Firestore Timestamp (or a Date or an ISO string) as an ISO string. */
export function isoTime(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate === "function") {
    const date = (toDate as () => Date).call(value);
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

/** A Firestore value as plain JSON: timestamps become ISO strings. */
export function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const time = isoTime(value);
    if (time !== null && !(value.constructor === Object)) return time;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

export function exportDocumentFrom(id: string, data: DocumentData, bucket?: string): ExportDocument {
  const url = text(data.url) || null;
  const storagePath = text(data.storagePath) || null;
  const source = text(data.source) || (url ? "link" : "upload");
  return {
    id,
    title: text(data.name) || text(data.title) || id,
    kind: text(data.kind) || "other",
    status: text(data.status) || "draft",
    source,
    link: url ?? (storagePath && bucket ? `gs://${bucket}/${storagePath}` : null),
    url,
    storagePath,
    contentType: text(data.contentType),
    size: count(data.size),
    uploadedBy: text(data.uploadedBy),
    createdAt: isoTime(data.createdAt),
    updatedAt: isoTime(data.updatedAt) ?? isoTime(data.createdAt),
  };
}

export function exportArtifactFrom(id: string, data: DocumentData): ExportArtifact {
  return {
    id,
    title: text(data.title) || id,
    kind: text(data.kind) || "document",
    status: text(data.status) || "ready",
    version: count(data.version),
    updatedBy: text(data.updatedBy),
    updatedAt: isoTime(data.updatedAt),
    content: text(data.content),
  };
}

export function exportProjectFrom(
  id: string,
  data: DocumentData,
  documents: ExportDocument[],
  artifacts: ExportArtifact[],
): ExportProject {
  const site = data.siteReport;
  return {
    id,
    name: text(data.name),
    address: text(data.address),
    jurisdiction: text(data.jurisdiction),
    aduType: text(data.aduType),
    client: text(data.client),
    status: text(data.status) || "intake",
    createdBy: text(data.createdBy),
    createdAt: isoTime(data.createdAt),
    members: Array.isArray(data.members) ? data.members.filter((m): m is string => typeof m === "string") : [],
    siteReport: site && typeof site === "object" ? (plain(site) as Record<string, unknown>) : null,
    documents,
    artifacts,
  };
}

/** Newest first, as the web app lists them. */
const byUpdated = <T extends { updatedAt: string | null }>(a: T, b: T) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

export function createFirestoreExportStore(db: Firestore, bucket?: string): ExportStore {
  return {
    async exportProjects() {
      const projects = await db.collection("projects").get();
      const out = await Promise.all(
        projects.docs.map(async (project) => {
          const [documents, artifacts] = await Promise.all([
            project.ref.collection("documents").get(),
            project.ref.collection("artifacts").get(),
          ]);
          return exportProjectFrom(
            project.id,
            project.data(),
            documents.docs.map((d) => exportDocumentFrom(d.id, d.data(), bucket)).sort(byUpdated),
            artifacts.docs.map((a) => exportArtifactFrom(a.id, a.data())).sort(byUpdated),
          );
        }),
      );
      return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    },
  };
}
