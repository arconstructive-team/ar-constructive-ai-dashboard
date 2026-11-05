import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { MAX_UPLOAD_BYTES, checkUpload, createApp } from "../src/server";
import { loadElRio } from "./fixtures/el-rio/load";

const enc = (s: string) => new TextEncoder().encode(s);

describe("upload checks", () => {
  it("rejects a file over 200 MB before reading it", () => {
    expect(checkUpload({ declaredBytes: MAX_UPLOAD_BYTES + 1 })?.status).toBe(413);
    expect(checkUpload({ declaredBytes: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it("rejects a file that does not start like a PDF", () => {
    expect(checkUpload({ head: enc("AutoCAD drawing") })?.status).toBe(415);
    expect(checkUpload({ head: enc("%PDF-1.7\n") })).toBeNull();
  });
});

// The server listens on the loopback interface only; the tests need no network.
describe("POST /api/check", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createApp({ maxBytes: 64, extract: async () => loadElRio() });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (body: string) =>
    fetch(`${base}/api/check?jurisdiction=Town%20of%20Danville&aduType=Attached%20ADU`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body,
    });

  it("answers 415 for a non-PDF", async () => {
    const res = await post("PK\u0003\u0004 zip data");
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: string }).error).toContain("not a PDF");
  });

  it("answers 413 for a file over the size limit", async () => {
    const res = await post(`%PDF-1.7\n${"x".repeat(100)}`);
    expect(res.status).toBe(413);
  });

  it("runs the check on a PDF", async () => {
    const res = await post("%PDF-1.7\n");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pack: string; pages: unknown[]; findings: unknown[] };
    expect(body.pack).toBe("danville-2025");
    expect(body.pages).toHaveLength(51);
    expect(body.findings.length).toBeGreaterThanOrEqual(22);
  });
});
