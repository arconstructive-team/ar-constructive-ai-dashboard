/**
 * The site report snapshot saved on the project document (projects/{id}.siteReport), so the
 * Projects dashboard and any other reader get every fact with its source without running the
 * pipeline again. Image paths are left out: Street View and satellite images stay rendered live
 * through /api/site/image, as before.
 */
import { STEP_LABEL, STEP_NAMES, type MapLinks, type SiteReport, type SourceRef, type Step, type StepName, type StepStatus } from "./types";

export interface SiteFact {
  key: StepName;
  /** e.g. "FEMA flood zone". */
  label: string;
  status: StepStatus;
  /** The facts of this step in one plain line. */
  summary?: string;
  note?: string;
  error?: string;
  checkUrl?: string;
  /** The step's data, without image paths. */
  data?: Record<string, unknown>;
  sources: SourceRef[];
}

export interface SiteReportSnapshot {
  version: 1;
  /** The address the report was built for. */
  address: string;
  /** When the sources were read (the report's generatedAt). */
  fetchedAt: string;
  facts: SiteFact[];
  /** Every source of every fact, once. */
  sources: SourceRef[];
  links?: MapLinks;
}

const source = (s: SourceRef): SourceRef => ({ name: s.name, url: s.url, fetchedAt: s.fetchedAt });

/** The snapshot of a report. Plain JSON: no undefined values, no arrays inside arrays. */
export function siteSnapshot(report: SiteReport): SiteReportSnapshot {
  const facts = STEP_NAMES.map((key): SiteFact => {
    // A report stored by an older version may miss a step: it counts as unknown.
    const step: Step<unknown> = report.steps[key] ?? { status: "unknown", sources: [] };
    const fact: SiteFact = { key, label: STEP_LABEL[key], status: step.status, sources: (step.sources ?? []).map(source) };
    if (step.summary) fact.summary = step.summary;
    if (step.note) fact.note = step.note;
    if (step.error) fact.error = step.error;
    if (step.checkUrl) fact.checkUrl = step.checkUrl;
    if (step.data && typeof step.data === "object") {
      // Image paths are signed links to live Google images; they are never stored.
      const data: Record<string, unknown> = { ...(step.data as unknown as Record<string, unknown>) };
      delete data.images;
      fact.data = data;
    }
    return fact;
  });
  const seen = new Set<string>();
  const sources: SourceRef[] = [];
  for (const fact of facts) {
    for (const s of fact.sources) {
      const key = `${s.name}\n${s.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(s);
    }
  }
  const snapshot: SiteReportSnapshot = { version: 1, address: report.address, fetchedAt: report.generatedAt, facts, sources };
  if (report.links) snapshot.links = report.links;
  // Firestore refuses undefined values; the JSON round trip drops them.
  return JSON.parse(JSON.stringify(snapshot)) as SiteReportSnapshot;
}
