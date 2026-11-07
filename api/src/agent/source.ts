// Reads a permit set PDF that a caller names instead of uploading it: a Cloud Storage path
// (gs://bucket/path, or a project document's storagePath in the default bucket) or an https URL.
import type { Fetch } from "../site/http";

export type ReadStorage = (bucket: string, path: string, maxBytes: number) => Promise<Uint8Array>;

export interface PdfSourceOptions {
  fetch?: Fetch;
  /** Reads one Cloud Storage object. Without it Cloud Storage paths answer 503. */
  readStorage?: ReadStorage;
  /** The bucket of a storagePath without gs:// (the web app's default bucket). */
  defaultBucket?: string;
  maxBytes: number;
  timeoutMs?: number;
}

export type PdfSource = { kind: "gcs"; bucket: string; path: string } | { kind: "https"; url: string };

/** A problem with the named PDF, with the HTTP status the route answers. */
export class SourceProblem extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 415 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** Reads what the caller sent. Throws a 400 SourceProblem when it is neither form. */
export function parsePdfSource(raw: string, defaultBucket?: string): PdfSource {
  const value = raw.trim();
  const gs = /^gs:\/\/([^/]+)\/(.+)$/.exec(value);
  if (gs) {
    if (!BUCKET.test(gs[1]!)) throw new SourceProblem(400, "This Cloud Storage bucket name is not valid.");
    return { kind: "gcs", bucket: gs[1]!, path: gs[2]! };
  }
  if (/^https:\/\//i.test(value)) {
    try {
      return { kind: "https", url: new URL(value).toString() };
    } catch {
      throw new SourceProblem(400, "This URL is not valid.");
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new SourceProblem(400, "Send the PDF as gs://bucket/path, a project document's storagePath, or an https URL.");
  }
  // A project document's storagePath, e.g. projects/{id}/documents/{docId}/set.pdf.
  const path = value.replace(/^\/+/, "");
  if (!path || path.includes("..")) throw new SourceProblem(400, "Send the PDF as gs://bucket/path, a project document's storagePath, or an https URL.");
  if (!defaultBucket) throw new SourceProblem(400, "Name the bucket: gs://bucket/path.");
  return { kind: "gcs", bucket: defaultBucket, path };
}

/** The file name the reports show: the last part of the path. */
export function sourceFileName(source: PdfSource): string {
  const path = source.kind === "gcs" ? source.path : new URL(source.url).pathname;
  const last = path.split("/").filter(Boolean).pop() ?? "permit-set.pdf";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function describeSource(source: PdfSource): string {
  return source.kind === "gcs" ? `gs://${source.bucket}/${source.path}` : source.url;
}

const PDF_MAGIC = "%PDF-";
const tooLarge = () => new SourceProblem(413, "The permit set is larger than 200 MB. Split it or compress it, then try again.");

async function readHttps(url: string, options: PdfSourceOptions): Promise<Uint8Array> {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  let res: Response;
  try {
    res = await doFetch(url, { redirect: "follow", signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
  } catch {
    throw new SourceProblem(502, "The PDF could not be downloaded from this URL. Check that it is public, then try again.");
  }
  if (res.status === 404) throw new SourceProblem(404, "There is no file at this URL.");
  if (!res.ok) throw new SourceProblem(502, `The URL answered HTTP ${res.status}. Check that the file is public, then try again.`);
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > options.maxBytes) throw tooLarge();
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > options.maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Downloads the PDF and checks that it is one. Throws a SourceProblem when it cannot. */
export async function loadPdf(source: PdfSource, options: PdfSourceOptions): Promise<Uint8Array> {
  let data: Uint8Array;
  if (source.kind === "gcs") {
    if (!options.readStorage) throw new SourceProblem(503, "Reading from Cloud Storage is not set up on this server.");
    try {
      data = await options.readStorage(source.bucket, source.path, options.maxBytes);
    } catch (error) {
      if (error instanceof SourceProblem) throw error;
      const code = (error as { code?: unknown }).code;
      if (code === 404) throw new SourceProblem(404, `There is no file at ${describeSource(source)}.`);
      if (code === 403) throw new SourceProblem(502, `chat-api may not read ${describeSource(source)}.`);
      throw new SourceProblem(502, `The file at ${describeSource(source)} could not be read. Try again.`);
    }
    if (data.length > options.maxBytes) throw tooLarge();
  } else {
    data = await readHttps(source.url, options);
  }
  const magic = new TextDecoder("latin1").decode(data.subarray(0, PDF_MAGIC.length));
  if (magic !== PDF_MAGIC) throw new SourceProblem(415, "This file is not a PDF. Export the permit set as one PDF, then try again.");
  return data;
}
