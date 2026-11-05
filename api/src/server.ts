import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { runCheck, type EngineOptions, type PageText } from "./engine";

/** The largest permit set the API accepts: 200 MB. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";

export type UploadProblem = { status: 413 | 415; error: string };

/** Checks an upload before any parsing: its declared size, then its first bytes. */
export function checkUpload(input: { declaredBytes?: number; head?: Uint8Array; maxBytes?: number }): UploadProblem | null {
  const max = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.declaredBytes !== undefined && input.declaredBytes > max) {
    return { status: 413, error: "The permit set is larger than 200 MB. Split it or compress it, then upload it again." };
  }
  if (input.head) {
    const magic = new TextDecoder("latin1").decode(input.head.subarray(0, PDF_MAGIC.length));
    if (magic !== PDF_MAGIC) {
      return { status: 415, error: "This file is not a PDF. Export the permit set as one PDF, then upload it again." };
    }
  }
  return null;
}

export interface AppOptions {
  /** Reads the text of every page. Tests pass a fake; production uses PDF.js. */
  extract?: (data: Uint8Array) => Promise<PageText[]>;
  maxBytes?: number;
  /** The web app's origin, for CORS. Default: any origin. */
  allowedOrigin?: string;
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, max: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > max) throw new TooLarge();
    chunks.push(buf);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * The HTTP handler. POST /api/check takes the permit set as the raw request body
 * (Content-Type: application/pdf) and the project data as query parameters:
 * jurisdiction, aduType, address. It answers with the engine result as JSON.
 */
export function createHandler(options: AppOptions = {}) {
  const max = options.maxBytes ?? MAX_UPLOAD_BYTES;
  const extract = options.extract ?? (async (data: Uint8Array) => (await import("./extract")).extractPages(data));
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("access-control-allow-origin", options.allowedOrigin ?? "*");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname !== "/api/check") {
      send(res, 404, { error: "Not found." });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "Use POST." });
      return;
    }
    const declared = req.headers["content-length"] ? Number(req.headers["content-length"]) : undefined;
    const early = checkUpload({ declaredBytes: declared, maxBytes: max });
    if (early) {
      res.setHeader("connection", "close");
      send(res, early.status, { error: early.error });
      req.resume();
      return;
    }
    let data: Uint8Array;
    try {
      data = await readBody(req, max);
    } catch (err) {
      if (err instanceof TooLarge) {
        res.setHeader("connection", "close");
        const problem = checkUpload({ declaredBytes: max + 1, maxBytes: max })!;
        send(res, problem.status, { error: problem.error });
        req.resume();
        return;
      }
      throw err;
    }
    const problem = checkUpload({ head: data, maxBytes: max });
    if (problem) {
      send(res, problem.status, { error: problem.error });
      return;
    }
    const engineOptions: EngineOptions = {
      jurisdiction: url.searchParams.get("jurisdiction") ?? undefined,
      aduType: url.searchParams.get("aduType") ?? undefined,
      address: url.searchParams.get("address") ?? undefined,
    };
    try {
      const pages = await extract(data);
      send(res, 200, runCheck(pages, engineOptions));
    } catch {
      send(res, 422, { error: "We could not read the text of this PDF. Check that it is not password-protected." });
    }
  };
}

export function createApp(options: AppOptions = {}): Server {
  const handler = createHandler(options);
  return createServer((req, res) => {
    handler(req, res).catch(() => send(res, 500, { error: "The check failed. Try again." }));
  });
}

// Started directly (npm start): listen on $PORT, as Cloud Run expects.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 8080);
  createApp({ allowedOrigin: process.env.ALLOWED_ORIGIN }).listen(port, () => {
    console.log(`permit-set check API listening on port ${port}`);
  });
}
