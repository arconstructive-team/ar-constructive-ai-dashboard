import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthError, type VerifyToken } from "../src/chat/auth";
import { createCallerAuth, createGoogleIdTokenVerifier, matchesApiKey, parseList } from "../src/agent/auth";
import { exportArtifactFrom, exportDocumentFrom, exportProjectFrom, isoTime, type ExportProject } from "../src/agent/export";
import { parsePdfSource, sourceFileName, SourceProblem } from "../src/agent/source";
import { createApp } from "../src/server";
import type { Fetch } from "../src/site/http";
import { loadElRio } from "./fixtures/el-rio/load";

const AUDIENCE = "https://chat-api-kfzvlbf5aq-wl.a.run.app";
const AGENT = "autopo@arconstructive.iam.gserviceaccount.com";
const NOW = new Date("2026-11-07T12:00:00.000Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);
const API_KEY = "agent-key-0123456789abcdef0123456789";

// A stand-in for Google's signing key; the verifier downloads its public half as Google's JWKS.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "google-1", alg: "RS256", use: "sig" }] };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function googleToken(claims: Record<string, unknown> = {}, key: KeyObject = privateKey, kid = "google-1"): string {
  const payload = {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    sub: "1234567890",
    email: AGENT,
    email_verified: true,
    iat: nowSeconds - 60,
    exp: nowSeconds + 3000,
    ...claims,
  };
  const head = `${b64({ alg: "RS256", kid, typ: "JWT" })}.${b64(payload)}`;
  return `${head}.${sign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
}

let certFetches = 0;
const certsFetch: Fetch = async () => {
  certFetches += 1;
  return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
};

const MEMBER = { uid: "u1", email: "rafi@example.com", name: "Rafi" };
const verifyFirebase: VerifyToken = async (token) => {
  if (token === "member") return MEMBER;
  if (token === "outsider") return { uid: "u2", email: "someone@else.com" };
  throw new Error("invalid");
};

const callerAuth = createCallerAuth({
  verifyFirebase,
  allowedEmails: ["rafi@example.com"],
  serviceAccounts: [AGENT],
  verifyGoogle: createGoogleIdTokenVerifier({ audiences: [AUDIENCE], fetch: certsFetch, now: () => NOW }),
  apiKeys: [API_KEY],
});

async function status(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof AuthError ? error.status : -1;
  }
}

describe("caller auth", () => {
  it("refuses a call without a token", async () => {
    expect(await status(callerAuth(undefined))).toBe(401);
    expect(await status(callerAuth(""))).toBe(401);
    expect(await status(callerAuth("Basic abc"))).toBe(401);
  });

  it("accepts an allowlisted service account's Google identity token", async () => {
    await expect(callerAuth(`Bearer ${googleToken()}`)).resolves.toEqual({ kind: "service_account", email: AGENT });
  });

  it("refuses a service account that is not on the list", async () => {
    expect(await status(callerAuth(`Bearer ${googleToken({ email: "stranger@other.iam.gserviceaccount.com" })}`))).toBe(403);
    expect(await status(callerAuth(`Bearer ${googleToken({ email_verified: false })}`))).toBe(403);
  });

  it("refuses a Google token for another audience, an expired one and a forged one", async () => {
    expect(await status(callerAuth(`Bearer ${googleToken({ aud: "https://example.com" })}`))).toBe(401);
    expect(await status(callerAuth(`Bearer ${googleToken({ exp: nowSeconds - 3600, iat: nowSeconds - 7200 })}`))).toBe(401);
    expect(await status(callerAuth(`Bearer ${googleToken({}, otherKey)}`))).toBe(401);
    expect(await status(callerAuth(`Bearer ${googleToken({}, privateKey, "unknown-kid")}`))).toBe(401);
    expect(await status(callerAuth(`Bearer ${googleToken({ iss: "https://evil.example" })}`))).toBe(401);
  });

  it("keeps Google's keys between calls", async () => {
    const before = certFetches;
    await callerAuth(`Bearer ${googleToken()}`);
    await callerAuth(`Bearer ${googleToken()}`);
    expect(certFetches - before).toBe(0);
  });

  it("accepts the Secret Manager API key and refuses another", async () => {
    await expect(callerAuth(`Bearer ${API_KEY}`)).resolves.toEqual({ kind: "api_key" });
    expect(await status(callerAuth("Bearer agent-key-wrong-0000000000000000000"))).toBe(401);
    expect(matchesApiKey("short", ["short"])).toBe(false);
  });

  it("still accepts a team member's Firebase token, and refuses an outsider", async () => {
    await expect(callerAuth("Bearer member")).resolves.toMatchObject({ kind: "team", email: "rafi@example.com" });
    expect(await status(callerAuth("Bearer outsider"))).toBe(403);
    expect(await status(callerAuth("Bearer forged"))).toBe(401);
  });

  it("refuses machine tokens when no service account or audience is set", async () => {
    const teamOnly = createCallerAuth({ verifyFirebase, allowedEmails: ["rafi@example.com"] });
    expect(await status(teamOnly(`Bearer ${googleToken()}`))).toBe(401);
    expect(await status(teamOnly(`Bearer ${API_KEY}`))).toBe(401);
    const noAudience = createCallerAuth({
      verifyFirebase,
      allowedEmails: [],
      serviceAccounts: [AGENT],
      verifyGoogle: createGoogleIdTokenVerifier({ audiences: [], fetch: certsFetch, now: () => NOW }),
    });
    expect(await status(noAudience(`Bearer ${googleToken()}`))).toBe(401);
  });

  it("reads comma separated lists", () => {
    expect(parseList(" A@x.com, b@y.com ,,", true)).toEqual(["a@x.com", "b@y.com"]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe("PDF sources", () => {
  it("reads gs:// paths, project storage paths and https URLs", () => {
    expect(parsePdfSource("gs://arconstructive.firebasestorage.app/projects/p1/documents/d1/set.pdf")).toEqual({
      kind: "gcs",
      bucket: "arconstructive.firebasestorage.app",
      path: "projects/p1/documents/d1/set.pdf",
    });
    expect(parsePdfSource("projects/p1/documents/d1/set.pdf", "my-bucket")).toEqual({
      kind: "gcs",
      bucket: "my-bucket",
      path: "projects/p1/documents/d1/set.pdf",
    });
    expect(parsePdfSource("https://example.com/sets/El%20Rio.pdf")).toEqual({ kind: "https", url: "https://example.com/sets/El%20Rio.pdf" });
    expect(sourceFileName({ kind: "https", url: "https://example.com/sets/El%20Rio.pdf" })).toBe("El Rio.pdf");
  });

  it("refuses other schemes and paths that climb out", () => {
    for (const raw of ["http://example.com/set.pdf", "file:///etc/passwd", "projects/../secret.pdf", "gs://Bad_Bucket!/x.pdf"]) {
      expect(() => parsePdfSource(raw, "b")).toThrow(SourceProblem);
    }
    expect(() => parsePdfSource("projects/p1/set.pdf")).toThrow(SourceProblem);
  });
});

describe("export mapping", () => {
  const ts = (iso: string) => ({ toDate: () => new Date(iso) });

  it("turns Firestore timestamps into ISO strings", () => {
    expect(isoTime(ts("2026-11-01T10:00:00.000Z"))).toBe("2026-11-01T10:00:00.000Z");
    expect(isoTime(null)).toBeNull();
  });

  it("maps a project with its client, status, siteReport, documents and artifacts", () => {
    const upload = exportDocumentFrom(
      "d1",
      { name: "Permit set", kind: "drawings", status: "final", source: "upload", storagePath: "projects/p1/documents/d1/set.pdf", contentType: "application/pdf", size: 1234, updatedAt: ts("2026-11-02T00:00:00.000Z") },
      "arconstructive.firebasestorage.app",
    );
    expect(upload).toMatchObject({
      title: "Permit set",
      kind: "drawings",
      status: "final",
      link: "gs://arconstructive.firebasestorage.app/projects/p1/documents/d1/set.pdf",
      storagePath: "projects/p1/documents/d1/set.pdf",
      updatedAt: "2026-11-02T00:00:00.000Z",
    });
    const link = exportDocumentFrom("d2", { name: "Survey", kind: "survey", status: "draft", source: "link", url: "https://example.com/survey" });
    expect(link).toMatchObject({ link: "https://example.com/survey", storagePath: null });
    const artifact = exportArtifactFrom("a1", { title: "Issue report", kind: "issue_report", status: "ready", version: 2, content: "# Report" });
    const project = exportProjectFrom(
      "p1",
      {
        name: "El Rio",
        address: "428 El Rio Rd",
        client: "Smith",
        status: "permit_set",
        siteReport: { fetchedAt: "2026-11-01T00:00:00.000Z", facts: [{ key: "flood", sources: [{ url: "https://hazards.fema.gov" }] }] },
        createdAt: ts("2026-10-01T00:00:00.000Z"),
      },
      [upload, link],
      [artifact],
    );
    expect(project).toMatchObject({ client: "Smith", status: "permit_set", createdAt: "2026-10-01T00:00:00.000Z" });
    expect(project.siteReport).toMatchObject({ fetchedAt: "2026-11-01T00:00:00.000Z" });
    expect(project.documents).toHaveLength(2);
    expect(project.artifacts[0]).toMatchObject({ kind: "issue_report", version: 2, content: "# Report" });
  });
});

describe("agent routes", () => {
  let server: Server;
  let base: string;
  const storageReads: string[] = [];
  const project: ExportProject = exportProjectFrom(
    "p1",
    { address: "428 El Rio Rd", client: "Smith", status: "design", siteReport: { fetchedAt: "2026-11-01T00:00:00.000Z", facts: [] } },
    [exportDocumentFrom("d1", { name: "Permit set", kind: "drawings", status: "final", storagePath: "projects/p1/documents/d1/set.pdf" }, "bucket")],
    [],
  );
  const pdfFetch: Fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/set.pdf")) return new Response("%PDF-1.7\n", { status: 200, headers: { "content-type": "application/pdf" } });
    if (url.endsWith("/page.html")) return new Response("<html></html>", { status: 200 });
    return new Response("missing", { status: 404 });
  };

  beforeAll(async () => {
    server = createApp({
      extract: async () => loadElRio(),
      agent: {
        authorize: callerAuth,
        exportStore: { exportProjects: async () => [project] },
        source: {
          defaultBucket: "arconstructive.firebasestorage.app",
          fetch: pdfFetch,
          readStorage: async (bucket, path) => {
            storageReads.push(`${bucket}/${path}`);
            if (path.endsWith("missing.pdf")) throw Object.assign(new Error("No such object"), { code: 404 });
            return new TextEncoder().encode("%PDF-1.7\n");
          },
        },
        now: () => NOW,
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  const OPTIONS = { jurisdiction: "Town of Danville", aduType: "Attached ADU", address: "428 El Rio Rd, Danville, CA 94526" };

  it("refuses the check, the regeneration and the export without a token", async () => {
    expect((await post("/api/check", { pdf: "gs://b1/set.pdf" })).status).toBe(401);
    expect((await post("/api/regenerate", { pdf: "gs://b1/set.pdf" })).status).toBe(401);
    expect((await fetch(`${base}/api/export`)).status).toBe(401);
    expect(storageReads).toEqual([]);
  });

  it("checks a permit set named by Cloud Storage path and answers the issue report", async () => {
    const res = await post("/api/check", { pdf: "projects/p1/documents/d1/set.pdf", ...OPTIONS }, googleToken());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      report: { pack: string; pages: unknown[]; findings: unknown[] };
      issueReport: { title: string; markdown: string };
      regenerated: { title: string; markdown: string } | null;
    };
    expect(body.source).toBe("gs://arconstructive.firebasestorage.app/projects/p1/documents/d1/set.pdf");
    expect(body.report.pack).toBe("danville-2025");
    expect(body.report.pages).toHaveLength(51);
    expect(body.report.findings.length).toBeGreaterThanOrEqual(22);
    expect(body.issueReport.title).toContain("428 El Rio Rd");
    expect(body.issueReport.markdown).toContain("|");
    expect(body.regenerated?.markdown).toContain("A-0.1");
  });

  it("checks a permit set named by https URL", async () => {
    const res = await post("/api/check", { pdf: "https://files.example.com/set.pdf", ...OPTIONS }, API_KEY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { fileName: string }).fileName).toBe("set.pdf");
  });

  it("regenerates the sheets as JSON, markdown and a PDF", async () => {
    const res = await post("/api/regenerate", { pdf: "gs://arconstructive.firebasestorage.app/projects/p1/set.pdf", ...OPTIONS }, googleToken());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      markdown: string;
      regenerated: { sheets: { sheet: string }[]; code_cycle: number };
      pdf: { contentType: string; base64: string };
    };
    expect(body.regenerated.sheets.map((s) => s.sheet)).toEqual(["A-0.1", "A-0.2", "A-5.2", "A-5.3"]);
    expect(body.regenerated.code_cycle).toBe(2025);
    expect(body.markdown).toContain("A-5.3");
    expect(Buffer.from(body.pdf.base64, "base64").subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("answers clear errors for a bad source", async () => {
    const token = googleToken();
    expect((await post("/api/check", {}, token)).status).toBe(400);
    expect((await post("/api/check", { pdf: "http://files.example.com/set.pdf" }, token)).status).toBe(400);
    expect((await post("/api/check", { pdf: "https://files.example.com/page.html" }, token)).status).toBe(415);
    expect((await post("/api/check", { pdf: "https://files.example.com/nothing" }, token)).status).toBe(404);
    expect((await post("/api/regenerate", { pdf: "gs://bucket-1/missing.pdf" }, token)).status).toBe(404);
  });

  it("exports every project with client, status, siteReport and documents", async () => {
    const res = await fetch(`${base}/api/export`, { headers: { authorization: "Bearer member" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exportedAt: string; count: number; projects: ExportProject[] };
    expect(body.exportedAt).toBe(NOW.toISOString());
    expect(body.count).toBe(1);
    expect(body.projects[0]).toMatchObject({ id: "p1", client: "Smith", status: "design", siteReport: { fetchedAt: "2026-11-01T00:00:00.000Z" } });
    expect(body.projects[0]?.documents[0]).toMatchObject({ title: "Permit set", kind: "drawings", status: "final", link: "gs://bucket/projects/p1/documents/d1/set.pdf" });
  });

  it("keeps the web app's raw PDF upload working without a token", async () => {
    const res = await fetch(`${base}/api/check?jurisdiction=Town%20of%20Danville&aduType=Attached%20ADU`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: "%PDF-1.7\n",
    });
    expect(res.status).toBe(200);
  });

  it("answers 503 for the agent routes on a server without them", async () => {
    const bare = createApp({});
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const port = (bare.address() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${port}/api/export`)).status).toBe(503);
    await new Promise<void>((resolve) => bare.close(() => resolve()));
  });
});
