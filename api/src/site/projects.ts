/**
 * Saves the site report snapshot on the project document (projects/{id}.siteReport) and fills it
 * in for projects made before it existed (the backfill). Firestore through the Admin SDK in
 * production; memory in tests.
 */
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { siteReportFrom } from "../chat/firestore";
import { siteSnapshot, type SiteReportSnapshot } from "./snapshot";
import type { SiteReport } from "./types";

export interface SiteProject {
  id: string;
  address: string;
  /** When the saved snapshot's sources were read; null without one. */
  snapshotAt: string | null;
}

export interface SiteProjectStore {
  getProject(projectId: string): Promise<SiteProject | null>;
  listProjects(): Promise<SiteProject[]>;
  /** The full report the web app keeps at projects/{id}/site/report, if any. */
  getStoredReport(projectId: string): Promise<SiteReport | null>;
  /** Writes projects/{id}.siteReport. Fails when the project does not exist. */
  saveSnapshot(projectId: string, snapshot: SiteReportSnapshot): Promise<void>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function projectFrom(id: string, data: DocumentData | undefined): SiteProject {
  const report = data?.siteReport as { fetchedAt?: unknown } | undefined;
  return { id, address: text(data?.address), snapshotAt: text(report?.fetchedAt) || null };
}

export function createFirestoreSiteProjectStore(db: Firestore): SiteProjectStore {
  const projectDoc = (id: string) => db.collection("projects").doc(id);
  return {
    async getProject(projectId) {
      const snap = await projectDoc(projectId).get();
      return snap.exists ? projectFrom(snap.id, snap.data()) : null;
    },
    async listProjects() {
      const snap = await db.collection("projects").select("address", "siteReport.fetchedAt").get();
      return snap.docs.map((d) => projectFrom(d.id, d.data()));
    },
    async getStoredReport(projectId) {
      const snap = await projectDoc(projectId).collection("site").doc("report").get();
      return snap.exists ? siteReportFrom(snap.data()) : null;
    },
    async saveSnapshot(projectId, snapshot) {
      // update() fails on a deleted project instead of bringing it back as a bare document.
      await projectDoc(projectId).update({ siteReport: snapshot });
    },
  };
}

/** The same store in memory, for tests. */
export class MemorySiteProjectStore implements SiteProjectStore {
  projects = new Map<string, { address: string; siteReport?: SiteReportSnapshot }>();
  storedReports = new Map<string, SiteReport>();

  async getProject(projectId: string) {
    const p = this.projects.get(projectId);
    return p ? { id: projectId, address: p.address, snapshotAt: p.siteReport?.fetchedAt ?? null } : null;
  }
  async listProjects() {
    return [...this.projects.entries()].map(([id, p]) => ({ id, address: p.address, snapshotAt: p.siteReport?.fetchedAt ?? null }));
  }
  async getStoredReport(projectId: string) {
    return this.storedReports.get(projectId) ?? null;
  }
  async saveSnapshot(projectId: string, snapshot: SiteReportSnapshot) {
    const p = this.projects.get(projectId);
    if (!p) throw new Error(`No project ${projectId}.`);
    this.projects.set(projectId, { ...p, siteReport: JSON.parse(JSON.stringify(snapshot)) as SiteReportSnapshot });
  }
}

export interface BackfillResult {
  /** Snapshots made from the report the web app had already stored: no source was read again. */
  fromStored: string[];
  /** Snapshots made by running the pipeline again (no stored report for the address). */
  built: string[];
  /** Projects left as they were, with the reason. */
  skipped: { id: string; reason: string }[];
  failed: { id: string; error: string }[];
}

export interface BackfillOptions {
  /** Runs the pipeline for an address. */
  build: (address: string) => Promise<SiteReport>;
  /** Rewrite projects that already have a snapshot too. */
  force?: boolean;
  log?: (line: string) => void;
}

/**
 * Saves a snapshot on every project that has none (every project with `force`). It uses the
 * report the web app already stored for the same address when there is one, and runs the
 * pipeline only for the rest. One project failing never stops the others.
 */
export async function backfillSiteReports(store: SiteProjectStore, options: BackfillOptions): Promise<BackfillResult> {
  const result: BackfillResult = { fromStored: [], built: [], skipped: [], failed: [] };
  const log = options.log ?? (() => {});
  for (const project of await store.listProjects()) {
    const address = project.address.trim();
    if (project.snapshotAt && !options.force) {
      result.skipped.push({ id: project.id, reason: `already saved (${project.snapshotAt})` });
      continue;
    }
    if (address.length < 5) {
      result.skipped.push({ id: project.id, reason: "no address" });
      continue;
    }
    try {
      const stored = await store.getStoredReport(project.id);
      if (stored && stored.address.trim().toLowerCase() === address.toLowerCase()) {
        await store.saveSnapshot(project.id, siteSnapshot(stored));
        result.fromStored.push(project.id);
        log(`${project.id}: saved from the stored report of ${stored.generatedAt}`);
      } else {
        await store.saveSnapshot(project.id, siteSnapshot(await options.build(address)));
        result.built.push(project.id);
        log(`${project.id}: built a new report for ${address}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ id: project.id, error: message });
      log(`${project.id}: failed: ${message}`);
    }
  }
  return result;
}
