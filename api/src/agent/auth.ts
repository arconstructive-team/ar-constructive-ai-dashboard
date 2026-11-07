// Who may call chat-api's engines (site report, permit-set check, sheet regeneration, export).
// Three kinds of caller:
// 1. A team member: a Firebase ID token whose email is on the team list (as the web app does now).
// 2. A machine: a Google-signed identity token of an allowlisted service account in the company's
//    Google project, minted for this service's URL (the audience). This is what Autopo agents use.
// 3. A machine with a shared API key (AGENT_API_KEY in Secret Manager), for callers that cannot
//    mint a Google identity token.
// A call without a token, or with one that none of these accept, is refused.
import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { AuthError, authorize, type VerifyToken } from "../chat/auth";
import type { Fetch } from "../site/http";

export type Caller =
  | { kind: "team"; uid: string; email: string; name: string }
  | { kind: "service_account"; email: string }
  | { kind: "api_key" };

/** The claims chat-api reads from a Google-signed identity token. */
export interface GoogleIdClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  exp: number;
  iat?: number;
}

/** Checks a Google-signed identity token (signature, issuer, audience, expiry). Throws when it is not valid. */
export type VerifyGoogleIdToken = (token: string) => Promise<GoogleIdClaims>;

export interface CallerAuthOptions {
  /** Checks a Firebase ID token (the web app's sign-in). */
  verifyFirebase: VerifyToken;
  /** The team list (ALLOWED_EMAILS). */
  allowedEmails: string[];
  /** Service accounts that may call as machines (AGENT_SERVICE_ACCOUNTS). Empty: no machine tokens. */
  serviceAccounts?: string[];
  /** Checks a Google identity token. Without it machine tokens are refused. */
  verifyGoogle?: VerifyGoogleIdToken;
  /** Shared API keys (AGENT_API_KEY, comma separated). Empty: no API keys. */
  apiKeys?: string[];
}

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** Comma separated, trimmed; emails in lower case. */
export function parseList(raw: string | undefined, lower = false): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => (lower ? v.trim().toLowerCase() : v.trim()))
    .filter((v) => v.length > 0);
}

function base64url(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** The header and claims of a JWT, without checking anything. null when it is not a JWT. */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64url(parts[0]!).toString("utf8")) as unknown;
    const payload = JSON.parse(base64url(parts[1]!).toString("utf8")) as unknown;
    if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
    return { header: header as Record<string, unknown>, payload: payload as Record<string, unknown> };
  } catch {
    return null;
  }
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** True when the token is one of the keys, compared in constant time. */
export function matchesApiKey(token: string, keys: string[]): boolean {
  const given = digest(token);
  let found = false;
  for (const key of keys) {
    if (key.length >= 16 && timingSafeEqual(given, digest(key))) found = true;
  }
  return found;
}

export interface GoogleVerifierOptions {
  /** The audiences chat-api accepts: its own URLs (AGENT_AUDIENCES). Empty: every token is refused. */
  audiences: string[];
  fetch?: Fetch;
  now?: () => Date;
  certsUrl?: string;
  /** How long the downloaded keys are kept. Default: one hour. */
  cacheMs?: number;
}

/**
 * Verifies Google-signed identity tokens (RS256) with Google's public keys, the same checks as
 * google-auth-library's verifyIdToken: signature, issuer, audience, expiry and issue time.
 */
export function createGoogleIdTokenVerifier(options: GoogleVerifierOptions): VerifyGoogleIdToken {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? 60 * 60 * 1000;
  let keys: Map<string, JsonWebKey> | null = null;
  let loadedAt = 0;

  async function loadKeys(): Promise<Map<string, JsonWebKey>> {
    const res = await doFetch(options.certsUrl ?? GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Google keys: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const map = new Map<string, JsonWebKey>();
    for (const key of body.keys ?? []) if (typeof key.kid === "string") map.set(key.kid, key);
    keys = map;
    loadedAt = now().getTime();
    return map;
  }

  async function keyFor(kid: string): Promise<JsonWebKey | undefined> {
    const fresh = keys && now().getTime() - loadedAt < cacheMs;
    const current = fresh ? keys! : await loadKeys();
    // Google rotates its keys: a token signed with a new key means the cache is old.
    return current.get(kid) ?? (fresh ? (await loadKeys()).get(kid) : undefined);
  }

  return async (token) => {
    if (options.audiences.length === 0) throw new Error("No audience is set: machine tokens are off.");
    const decoded = decodeJwt(token);
    if (!decoded) throw new Error("Not a JWT.");
    const { header, payload } = decoded;
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Not an RS256 token.");
    const jwk = await keyFor(header.kid);
    if (!jwk) throw new Error("Unknown signing key.");
    const [h, p, s] = token.split(".");
    const valid = verifySignature("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), base64url(s!));
    if (!valid) throw new Error("Bad signature.");
    const claims = payload as unknown as GoogleIdClaims;
    if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error("Wrong issuer.");
    if (typeof claims.aud !== "string" || !options.audiences.includes(claims.aud)) throw new Error("Wrong audience.");
    const seconds = now().getTime() / 1000;
    const skew = 300;
    if (typeof claims.exp !== "number" || claims.exp + skew < seconds) throw new Error("Expired.");
    if (typeof claims.iat === "number" && claims.iat - skew > seconds) throw new Error("Issued in the future.");
    return claims;
  };
}

/**
 * Makes the check every engine route runs on its Authorization header. It resolves with the caller
 * or throws an AuthError (401: no token or a token nobody accepts; 403: a valid token of an
 * account that is not on a list).
 */
export function createCallerAuth(options: CallerAuthOptions) {
  const serviceAccounts = (options.serviceAccounts ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const apiKeys = options.apiKeys ?? [];
  return async (header: string | undefined): Promise<Caller> => {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    if (!match) throw new AuthError(401, "Send a token: Authorization: Bearer <token>.");
    const token = match[1]!;
    if (apiKeys.length > 0 && matchesApiKey(token, apiKeys)) return { kind: "api_key" };

    const decoded = decodeJwt(token);
    const issuer = decoded?.payload.iss;
    if (typeof issuer === "string" && GOOGLE_ISSUERS.includes(issuer)) {
      if (!options.verifyGoogle || serviceAccounts.length === 0) {
        throw new AuthError(401, "Machine tokens are not set up on this server.");
      }
      let claims: GoogleIdClaims;
      try {
        claims = await options.verifyGoogle(token);
      } catch {
        throw new AuthError(401, "This Google identity token is not valid for this service. Mint a new one for its URL.");
      }
      const email = claims.email?.trim().toLowerCase();
      if (!email || claims.email_verified === false || !serviceAccounts.includes(email)) {
        throw new AuthError(403, "This service account may not call chat-api.");
      }
      return { kind: "service_account", email };
    }

    const user = await authorize(header, options.verifyFirebase, options.allowedEmails);
    return { kind: "team", ...user };
  };
}
