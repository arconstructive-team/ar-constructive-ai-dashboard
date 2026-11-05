/**
 * HTTP routes of the site report:
 * - POST /api/site/report {address}: runs the pipeline for a signed-in team member and answers
 *   with the report. The web app saves it on the project.
 * - GET /api/site/image?kind=...&sig=...: forwards one Street View or satellite image from
 *   Google with the server's key. Only paths the pipeline signed work; nothing is stored.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Fetch } from "./http";
import { googleImageUrl } from "./imagery";
import { buildSiteReport } from "./pipeline";

export interface SiteOptions {
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

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname === "/api/site/report") {
      if (req.method !== "POST") {
        send(res, 405, { error: "Use POST." });
        return true;
      }
      if (!options.authorize) {
        send(res, 503, { error: "The site report service is not set up on this server yet." });
        return true;
      }
      try {
        await options.authorize(req.headers.authorization);
      } catch (err) {
        const status = (err as { status?: unknown }).status === 403 ? 403 : 401;
        send(res, status, { error: status === 403 ? "This account may not use the dashboard." : "Sign in again, then retry." });
        return true;
      }
      let address = "";
      try {
        const body = (await readJson(req)) as { address?: unknown };
        address = typeof body.address === "string" ? body.address.trim() : "";
      } catch {
        send(res, 400, { error: "Send the address as JSON: {\"address\": \"...\"}." });
        return true;
      }
      if (address.length < 5 || address.length > 300) {
        send(res, 400, { error: "Enter the project's street address, city and ZIP code." });
        return true;
      }
      const report = await buildSiteReport(address, { apiKey, fetch: doFetch, now: options.now, timeoutMs: options.timeoutMs });
      send(res, 200, report);
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
