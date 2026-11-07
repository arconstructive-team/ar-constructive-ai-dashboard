/**
 * The engine routes for callers outside the web app (Autopo agents and team scripts). Every route
 * needs a token (see ./auth.ts).
 * - POST /api/check with a JSON body {pdf, jurisdiction?, aduType?, address?}: the permit-set check
 *   on a PDF named by Cloud Storage path or https URL. Answers the issue report (JSON and markdown)
 *   and the regenerated sheets. A raw PDF body (the web app's upload) is handled by server.ts.
 * - POST /api/regenerate {pdf, jurisdiction?, aduType?, address?}: only the regenerated sheets
 *   (A-0.1, A-0.2, A-5.2, A-5.3) as JSON, markdown and a PDF in base64.
 * - GET /api/export: every project with its client, status, siteReport, documents and artifacts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { regeneratedPdf, runCheck, toBase64, type EngineOptions, type PageText } from "../engine";
import { issueReportMarkdown, issueReportTitle, sheetSetMarkdown, sheetSetTitle } from "../chat/report";
import type { ExportResult, ExportStore } from "./export";
import { describeSource, loadPdf, parsePdfSource, sourceFileName, SourceProblem, type PdfSourceOptions } from "./source";

export interface AgentOptions {
  /** Checks the Authorization header; throws an error with `status` 401 or 403 when refused. */
  authorize: (header: string | undefined) => Promise<unknown>;
  /** Where the export reads projects. Without it GET /api/export answers 503. */
  exportStore?: ExportStore;
  /** How a named PDF is read (Cloud Storage reader, default bucket, fetch). */
  source?: Omit<PdfSourceOptions, "maxBytes">;
  now?: () => Date;
}

export interface AgentRouteContext {
  extract: (data: Uint8Array) => Promise<PageText[]>;
  maxBytes: number;
}

const MAX_BODY = 8 * 1024;
const FIELD_MAX = 300;

function send(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const field = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, FIELD_MAX) : undefined;

const USAGE =
  'Send JSON: {"pdf": "gs://bucket/path.pdf or https://…/set.pdf", "jurisdiction": "Town of Danville", "aduType": "Attached ADU", "address": "…"}.';

/** True for a request whose body is JSON: the agent form of POST /api/check. */
export function isJsonRequest(req: IncomingMessage): boolean {
  return (req.headers["content-type"] ?? "").toLowerCase().includes("application/json");
}

/** Handles the agent routes. Resolves with false for any other request. */
export function createAgentHandler(options: AgentOptions | undefined, ctx: AgentRouteContext) {
  const now = options?.now ?? (() => new Date());

  /** Checks the method, the set-up and the caller. Answers and resolves false when the request may not go on. */
  async function allowed(req: IncomingMessage, res: ServerResponse, method: "GET" | "POST"): Promise<boolean> {
    if (req.method !== method) {
      send(res, 405, { error: `Use ${method}.` });
      req.resume();
      return false;
    }
    if (!options) {
      send(res, 503, { error: "Agent access is not set up on this server." });
      req.resume();
      return false;
    }
    try {
      await options.authorize(req.headers.authorization);
    } catch (err) {
      const status = (err as { status?: unknown }).status === 403 ? 403 : 401;
      const message = err instanceof Error && err.message ? err.message : "Send a valid token.";
      send(res, status, { error: message });
      req.resume();
      return false;
    }
    return true;
  }

  /** Reads the body, downloads the PDF and extracts its pages. Answers and resolves null on a problem. */
  async function readSet(req: IncomingMessage, res: ServerResponse) {
    let body: Record<string, unknown>;
    try {
      const parsed = await readJson(req);
      body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      send(res, 400, { error: USAGE });
      return null;
    }
    const raw = field(body.pdf) ?? field(body.storagePath) ?? field(body.url);
    if (!raw) {
      send(res, 400, { error: USAGE });
      return null;
    }
    const engine: EngineOptions = {
      jurisdiction: field(body.jurisdiction),
      aduType: field(body.aduType),
      address: field(body.address),
    };
    try {
      const source = parsePdfSource(raw, options!.source?.defaultBucket);
      const data = await loadPdf(source, { ...options!.source, maxBytes: ctx.maxBytes });
      let pages: PageText[];
      try {
        pages = await ctx.extract(data);
      } catch {
        send(res, 422, { error: "We could not read the text of this PDF. Check that it is not password-protected." });
        return null;
      }
      return { source, pages, engine, fileName: field(body.fileName) ?? sourceFileName(source) };
    } catch (error) {
      if (error instanceof SourceProblem) {
        send(res, error.status, { error: error.message });
        return null;
      }
      throw error;
    }
  }

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname === "/api/check" && req.method === "POST" && isJsonRequest(req)) {
      if (!(await allowed(req, res, "POST"))) return true;
      const set = await readSet(req, res);
      if (!set) return true;
      const result = runCheck(set.pages, set.engine);
      const project = {
        address: set.engine.address ?? result.regenerated?.address ?? "",
        jurisdiction: set.engine.jurisdiction ?? result.pack_name,
        aduType: set.engine.aduType ?? "",
      };
      send(res, 200, {
        source: describeSource(set.source),
        fileName: set.fileName,
        checkedAt: now().toISOString(),
        report: result,
        issueReport: { title: issueReportTitle(project), markdown: issueReportMarkdown(result, project, set.fileName) },
        regenerated: result.regenerated
          ? { title: sheetSetTitle(result.regenerated), markdown: sheetSetMarkdown(result.regenerated) }
          : null,
      });
      return true;
    }

    if (url.pathname === "/api/regenerate") {
      if (!(await allowed(req, res, "POST"))) return true;
      const set = await readSet(req, res);
      if (!set) return true;
      // runCheck also checks the regenerated sheets on their own (their findings).
      const regenerated = runCheck(set.pages, set.engine).regenerated;
      if (!regenerated) {
        send(res, 422, { error: "This permit set has no architectural cover sheet (A-0.1) to read the project data from." });
        return true;
      }
      send(res, 200, {
        source: describeSource(set.source),
        fileName: set.fileName,
        generatedAt: now().toISOString(),
        title: sheetSetTitle(regenerated),
        markdown: sheetSetMarkdown(regenerated),
        regenerated,
        pdf: { contentType: "application/pdf", fileName: "regenerated-sheets.pdf", base64: toBase64(regeneratedPdf(regenerated)) },
      });
      return true;
    }

    if (url.pathname === "/api/export") {
      if (!(await allowed(req, res, "GET"))) return true;
      if (!options?.exportStore) {
        send(res, 503, { error: "The export is not set up on this server." });
        return true;
      }
      const projects = await options.exportStore.exportProjects();
      const result: ExportResult = { exportedAt: now().toISOString(), count: projects.length, projects };
      send(res, 200, result);
      return true;
    }

    return false;
  };
}
