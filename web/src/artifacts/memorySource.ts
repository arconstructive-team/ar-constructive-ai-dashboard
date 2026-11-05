import {
  ArtifactMissingError,
  checkSave,
  type Artifact,
  type ArtifactRef,
  type ArtifactSource,
  type ArtifactVersion,
  type SaveVersionInput,
} from "./types";

type Listener = (artifact: Artifact | null) => void;

const key = (ref: ArtifactRef) => `${ref.projectId}/${ref.artifactId}`;

/**
 * An in-memory artifact source with the same behaviour as the Firestore one.
 * Tests and the preview page use it; `append` and `update` stand in for the
 * generator that writes an artifact while it streams.
 */
export class MemoryArtifactSource implements ArtifactSource {
  private artifacts = new Map<string, Artifact>();
  private versions = new Map<string, ArtifactVersion[]>();
  private listeners = new Map<string, Set<Listener>>();

  constructor(private now: () => Date = () => new Date()) {}

  put(artifact: Artifact, versions: ArtifactVersion[] = []): void {
    const ref = { projectId: artifact.projectId, artifactId: artifact.id };
    this.artifacts.set(key(ref), { ...artifact });
    this.versions.set(key(ref), versions.map((v) => ({ ...v })));
    this.emit(ref);
  }

  get(ref: ArtifactRef): Artifact | null {
    const artifact = this.artifacts.get(key(ref));
    return artifact ? { ...artifact } : null;
  }

  update(ref: ArtifactRef, patch: Partial<Artifact>): void {
    const current = this.artifacts.get(key(ref));
    if (!current) throw new ArtifactMissingError();
    this.artifacts.set(key(ref), { ...current, ...patch });
    this.emit(ref);
  }

  /** Adds streamed text to the end of the content. */
  append(ref: ArtifactRef, text: string): void {
    const current = this.artifacts.get(key(ref));
    if (!current) throw new ArtifactMissingError();
    this.update(ref, { content: current.content + text, updatedAt: this.now() });
  }

  /** Ends a generation: the content becomes the next version and the artifact is ready. */
  finishGeneration(ref: ArtifactRef, updatedBy = "arconstructive"): void {
    const current = this.artifacts.get(key(ref));
    if (!current) throw new ArtifactMissingError();
    const version = current.version + 1;
    const updatedAt = this.now();
    this.pushVersion(ref, { version, title: current.title, content: current.content, updatedBy, updatedAt });
    this.update(ref, { status: "ready", version, updatedBy, updatedAt });
  }

  watch(ref: ArtifactRef, onData: Listener): () => void {
    const set = this.listeners.get(key(ref)) ?? new Set<Listener>();
    set.add(onData);
    this.listeners.set(key(ref), set);
    onData(this.get(ref));
    return () => {
      set.delete(onData);
    };
  }

  async listVersions(ref: ArtifactRef): Promise<ArtifactVersion[]> {
    return [...(this.versions.get(key(ref)) ?? [])].sort((a, b) => b.version - a.version).map((v) => ({ ...v }));
  }

  async saveVersion(ref: ArtifactRef, input: SaveVersionInput): Promise<number> {
    const current = this.artifacts.get(key(ref));
    if (!current) throw new ArtifactMissingError();
    checkSave(current, input);
    const list = this.versions.get(key(ref)) ?? [];
    if (current.version > 0 && !list.some((v) => v.version === current.version)) {
      // Keep the version the edit replaces, so it can be restored.
      this.pushVersion(ref, {
        version: current.version,
        title: current.title,
        content: current.content,
        updatedBy: current.updatedBy,
        updatedAt: current.updatedAt,
      });
    }
    const version = current.version + 1;
    const updatedAt = this.now();
    const saved: ArtifactVersion = {
      version,
      title: input.title,
      content: input.content,
      updatedBy: input.updatedBy,
      updatedAt,
    };
    if (input.restoredFrom !== undefined) saved.restoredFrom = input.restoredFrom;
    this.pushVersion(ref, saved);
    this.update(ref, {
      title: input.title,
      content: input.content,
      version,
      updatedBy: input.updatedBy,
      updatedAt,
    });
    return version;
  }

  private pushVersion(ref: ArtifactRef, version: ArtifactVersion): void {
    const list = this.versions.get(key(ref)) ?? [];
    list.push(version);
    this.versions.set(key(ref), list);
  }

  private emit(ref: ArtifactRef): void {
    const artifact = this.get(ref);
    for (const listener of this.listeners.get(key(ref)) ?? []) listener(artifact ? { ...artifact } : null);
  }
}

/** Splits text into chunks the size of model output deltas. */
export function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

/**
 * Plays a markdown text into the source as if a model were writing it.
 * Returns a function that stops the stream.
 */
export function streamInto(
  source: MemoryArtifactSource,
  ref: ArtifactRef,
  markdown: string,
  options: { chunkSize?: number; intervalMs?: number } = {},
): () => void {
  const chunks = chunkText(markdown, options.chunkSize ?? 24);
  source.update(ref, { status: "generating", content: "" });
  let index = 0;
  const timer = setInterval(() => {
    if (index >= chunks.length) {
      clearInterval(timer);
      source.finishGeneration(ref);
      return;
    }
    source.append(ref, chunks[index]);
    index++;
  }, options.intervalMs ?? 40);
  return () => clearInterval(timer);
}
