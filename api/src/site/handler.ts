/**
 * HTTP routes of the site report:
 * - POST /api/site/report {address, projectId?}: runs the pipeline for a signed-in team member and
 *   answers with the report. With a projectId the server also saves the snapshot (every fact, its
 *   source and fetchedAt) on projects/{projectId}.siteReport; the web app keeps the full report.
 * - POST /api/site/backfill {force?}: saves the snapshot on every project that has none yet.
 * - GET /api/site/image?kind=...&sig=...: forwards one Street View or satellite image from
 *   Google with the server's key. Only paths the pipeline signed work; nothing is stored.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Fetch } from "./http";
import { googleImageUrl } from "./imagery";
import { buildSiteReport } from "./pipeline";
import { backfillSiteReports, type SiteProjectStore } from "./projects";
import { siteSnapshot } from "./snapshot";

const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface SiteOptions {
  /** Where the snapshot is saved on the project. Without it a request with a projectId answers 503. */
  projects?: SiteProjectStore;
  /** The Google Maps Platform key. Kept on the server; never sent to the browser. */
  apiKey?: string;
  /**
   * Checks the Authorization header and throws when the caller may not run the pipeline (an error
   * with `status` 401 or 403). Without it, POST /api/site/report answers 503.
   */
  authorize?: (header: string | undefined) => Promise<unknown>;
  fetch?: Fetch;
  now?: () => Date;
  timeoutMs?: number;
}

const MAX_BODY = 4096;

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

/** Handles /api/site/* requests. Resolves with false for any other path. */
export function createSiteHandler(options: SiteOptions) {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const apiKey = options.apiKey?.trim() || undefined;

  const build = (address: string) =>
    buildSiteReport(address, { apiKey, fetch: doFetch, now: options.now, timeoutMs: options.timeoutMs });

  /** Checks the method and the caller. Answers and resolves false when the request may not go on. */
  async function allowed(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== "POST") {
      send(res, 405, { error: "Use POST." });
      return false;
    }
    if (!options.authorize) {
      send(res, 503, { error: "The site report service is not set up on this server yet." });
      return false;
    }
    try {
      await options.authorize(req.headers.authorization);
    } catch (err) {
      const status = (err as { status?: unknown }).status === 403 ? 403 : 401;
      send(res, status, { error: status === 403 ? "This account may not use the dashboard." : "Sign in again, then retry." });
      return false;
    }
    return true;
  }

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname === "/api/site/report") {
      if (!(await allowed(req, res))) return true;
      let address = "";
      let projectId: string | null = null;
      try {
        const body = (await readJson(req)) as { address?: unknown; projectId?: unknown };
        address = typeof body.address === "string" ? body.address.trim() : "";
        if (body.projectId !== undefined && body.projectId !== null) {
          if (typeof body.projectId !== "string" || !PROJECT_ID.test(body.projectId)) throw new Error("bad project id");
          projectId = body.projectId;
        }
      } catch {
        send(res, 400, { error: "Send JSON: {\"address\": \"...\", \"projectId\": \"...\"}." });
        return true;
      }
      if (projectId) {
        if (!options.projects) {
          send(res, 503, { error: "Saving the site report on the project is not set up on this server yet." });
          return true;
        }
        const project = await options.projects.getProject(projectId);
        if (!project) {
          send(res, 404, { error: "This project no longer exists." });
          return true;
        }
        if (!address) address = project.address.trim();
      }
      if (address.length < 5 || address.length > 300) {
        send(res, 400, { error: "Enter the project's street address, city and ZIP code." });
        return true;
      }
      const report = await build(address);
      if (projectId && options.projects) {
        try {
          await options.projects.saveSnapshot(projectId, siteSnapshot(report));
        } catch (error) {
          console.error("site report snapshot not saved", projectId, error);
          send(res, 500, { error: "The site report was built but could not be saved on the project. Refresh the site info again." });
          return true;
        }
      }
      send(res, 200, report);
      return true;
    }

    if (url.pathname === "/api/site/backfill") {
      if (!(await allowed(req, res))) return true;
      if (!options.projects) {
        send(res, 503, { error: "Saving the site report on the project is not set up on this server yet." });
        return true;
      }
      let force = false;
      try {
        force = ((await readJson(req)) as { force?: unknown }).force === true;
      } catch {
        send(res, 400, { error: "Send JSON: {} or {\"force\": true}." });
        return true;
      }
      const result = await backfillSiteReports(options.projects, { build, force, log: (line) => console.log(`site backfill: ${line}`) });
      send(res, 200, result);
      return true;
    }

    if (url.pathname === "/api/site/image") {
      if (req.method !== "GET") {
        send(res, 405, { error: "Use GET." });
        return true;
      }
      if (!apiKey) {
        send(res, 503, { error: "Google images are not set up on this server yet." });
        return true;
      }
      const google = googleImageUrl(url.searchParams, apiKey);
      if (!google) {
        send(res, 403, { error: "This image link is not valid." });
        return true;
      }
      let upstream: Response;
      try {
        upstream = await doFetch(google, { signal: AbortSignal.timeout(options.timeoutMs ?? 12_000) });
      } catch {
        send(res, 502, { error: "Google did not send the image. Try again." });
        return true;
      }
      const type = upstream.headers.get("content-type") ?? "";
      if (!upstream.ok || !type.startsWith("image/")) {
        send(res, 502, { error: "Google did not send the image. Try again." });
        return true;
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, {
        "content-type": type,
        "content-length": String(bytes.length),
        // The browser may keep it for an hour; the server keeps nothing.
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
      res.end(bytes);
      return true;
    }

    return false;
  };
}
