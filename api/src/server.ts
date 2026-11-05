import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { runCheck, type EngineOptions, type PageText } from "./engine";
import { ChatError, runChatTurn } from "./chat/agent";
import { AuthError, authorize, type ChatUser, type VerifyToken } from "./chat/auth";
import type { ChatConfig } from "./chat/config";
import type { ModelClient } from "./chat/model";
import type { ChatStore } from "./chat/store";
import { createSiteHandler, type SiteOptions } from "./site/handler";

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

export interface ChatOptions {
  verifyToken: VerifyToken;
  config: ChatConfig;
  store: ChatStore;
  /** null when the server has no Anthropic key: the chat then answers 503. */
  model: ModelClient | null;
}

export interface AppOptions {
  /** Reads the text of every page. Tests pass a fake; production uses PDF.js. */
  extract?: (data: Uint8Array) => Promise<PageText[]>;
  maxBytes?: number;
  /** The web app's origins, comma separated, for CORS. Default: any origin. */
  allowedOrigin?: string;
  /** The team chat assistant (POST /api/chat). Without it the route answers 503. */
  chat?: ChatOptions;
  /** The site report routes (/api/site/*). Without them they answer 503. */
  site?: SiteOptions;
}

/** The largest chat request body: it only names the project and the chat. */
const MAX_CHAT_BODY = 16 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function corsOrigin(allowed: string | undefined, origin: string | undefined): string | null {
  if (!allowed || allowed.trim() === "*") return "*";
  const list = allowed.split(",").map((o) => o.trim()).filter(Boolean);
  if (origin && list.includes(origin)) return origin;
  return list[0] ?? null;
}

async function drain(req: IncomingMessage) {
  req.resume();
}

/**
 * POST /api/chat {projectId, chatId}: Claude answers the newest messages of a team chat. The
 * caller sends a Firebase ID token (Authorization: Bearer …) of a team member. The reply streams
 * back as server-sent events (text, tool, done, error) and is saved to the shared chat as it grows.
 */
async function handleChat(req: IncomingMessage, res: ServerResponse, chat: ChatOptions | undefined) {
  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST." });
    return drain(req);
  }
  if (!chat) {
    send(res, 503, { error: "The chat assistant is not set up on this server." });
    return drain(req);
  }
  let user: ChatUser;
  try {
    user = await authorize(req.headers.authorization, chat.verifyToken, chat.config.allowedEmails);
  } catch (error) {
    if (error instanceof AuthError) {
      send(res, error.status, { error: error.message });
      return drain(req);
    }
    throw error;
  }
  if (!chat.model) {
    send(res, 503, { error: "The assistant is not set up yet: the server has no Anthropic key." });
    return drain(req);
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBody(req, MAX_CHAT_BODY)));
  } catch (error) {
    if (error instanceof TooLarge) res.setHeader("connection", "close");
    send(res, 400, { error: "Send JSON: {\"projectId\": \"…\", \"chatId\": \"…\"}." });
    return;
  }
  const { projectId, chatId } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof projectId !== "string" || !ID.test(projectId) || typeof chatId !== "string" || !ID.test(chatId)) {
    send(res, 400, { error: "projectId and chatId are required." });
    return;
  }

  const event = (name: string, data: unknown) => {
    if (!res.headersSent) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      });
    }
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const result = await runChatTurn(
      { store: chat.store, model: chat.model, config: chat.config },
      { projectId, chatId, user },
      { onText: (delta) => event("text", { delta }), onTool: (name) => event("tool", { name }) },
    );
    event("done", { messageId: result.messageId, artifactIds: result.artifactIds });
    res.end();
  } catch (error) {
    const status = error instanceof ChatError ? error.status : 500;
    const message = error instanceof ChatError ? error.message : "The assistant could not answer. Try again.";
    if (status === 500) console.error("chat failed", error);
    if (!res.headersSent) {
      send(res, status, { error: message });
      return;
    }
    event("error", { error: message });
    res.end();
  }
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
  const site = createSiteHandler(options.site ?? {});
  return async (req: IncomingMessage, res: ServerResponse) => {
    const origin = corsOrigin(options.allowedOrigin, req.headers.origin);
    if (origin) res.setHeader("access-control-allow-origin", origin);
    if (origin !== "*") res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/chat") {
      await handleChat(req, res, options.chat);
      return;
    }
    if (url.pathname.startsWith("/api/site/") && (await site(req, res, url))) return;
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
    handler(req, res).catch(() => {
      if (res.headersSent) res.end();
      else send(res, 500, { error: "The request failed. Try again." });
    });
  });
}
