import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";

type Ref = { path: string };

const tx = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), update: vi.fn() }));

vi.mock("firebase/firestore", () => ({
  Timestamp: class {
    constructor(private readonly date: Date) {}
    toDate() {
      return this.date;
    }
  },
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  query: (ref: Ref) => ref,
  orderBy: () => null,
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: async (_db: unknown, run: (t: typeof tx) => Promise<unknown>) => run(tx),
  serverTimestamp: () => "SERVER_TIME",
}));

import { createFirestoreSource } from "./firestoreSource";
import { ArtifactConflictError, ArtifactLockedError } from "./types";

const ref = { projectId: "p1", artifactId: "a1" };
const ARTIFACT = "projects/p1/artifacts/a1";

function snap(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data };
}

function store(artifact: Record<string, unknown>, versions: Record<string, Record<string, unknown>> = {}) {
  tx.get.mockImplementation(async (r: Ref) => {
    if (r.path === ARTIFACT) return snap(artifact);
    const id = r.path.split("/").pop() ?? "";
    return snap(versions[id] ?? null);
  });
}

const base = {
  title: "Report",
  kind: "issue_report",
  status: "ready",
  content: "# Report\n\nOld.",
  version: 1,
  chatId: "c1",
  updatedBy: "arconstructive",
};

describe("Firestore artifact source", () => {
  const source = createFirestoreSource({} as Firestore);

  beforeEach(() => {
    tx.get.mockReset();
    tx.set.mockReset();
    tx.update.mockReset();
  });

  it("saves a new version and keeps the one it replaces", async () => {
    store(base);
    const version = await source.saveVersion(ref, {
      title: "Report",
      content: "# Report\n\nNew.",
      updatedBy: "Dana Lee",
      baseVersion: 1,
    });
    expect(version).toBe(2);
    expect(tx.set).toHaveBeenCalledWith(
      { path: `${ARTIFACT}/versions/1` },
      expect.objectContaining({ version: 1, content: "# Report\n\nOld.", updatedBy: "arconstructive" }),
    );
    expect(tx.set).toHaveBeenCalledWith(
      { path: `${ARTIFACT}/versions/2` },
      expect.objectContaining({ version: 2, content: "# Report\n\nNew.", updatedBy: "Dana Lee", chatId: "c1" }),
    );
    expect(tx.update).toHaveBeenCalledWith(
      { path: ARTIFACT },
      { title: "Report", content: "# Report\n\nNew.", version: 2, updatedBy: "Dana Lee", updatedAt: "SERVER_TIME" },
    );
  });

  it("does not write the old version again when it is stored", async () => {
    store(base, { "1": { version: 1, content: "# Report\n\nOld." } });
    await source.saveVersion(ref, { title: "Report", content: "x", updatedBy: "Dana Lee", baseVersion: 1, restoredFrom: 1 });
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledWith({ path: `${ARTIFACT}/versions/2` }, expect.objectContaining({ restoredFrom: 1 }));
  });

  it("refuses a save made on an older version", async () => {
    store({ ...base, version: 4, updatedBy: "Sam" });
    await expect(
      source.saveVersion(ref, { title: "Report", content: "x", updatedBy: "Dana Lee", baseVersion: 3 }),
    ).rejects.toBeInstanceOf(ArtifactConflictError);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it("refuses a save while the artifact generates", async () => {
    store({ ...base, status: "generating" });
    await expect(
      source.saveVersion(ref, { title: "Report", content: "x", updatedBy: "Dana Lee", baseVersion: 1 }),
    ).rejects.toBeInstanceOf(ArtifactLockedError);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
