import { describe, expect, it } from "vitest";
import { ChatApiError, createChatApi, createSseParser } from "./chatApi";

function sse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

describe("createSseParser", () => {
  it("reads events split across chunks", () => {
    const seen: Array<[string, unknown]> = [];
    const parser = createSseParser((name, data) => seen.push([name, data]));
    parser.push('event: text\ndata: {"delta":"Hel');
    parser.push('lo"}\n\nevent: done\ndata: {"messageId":"m1"}\n\n');
    parser.end();
    expect(seen).toEqual([
      ["text", { delta: "Hello" }],
      ["done", { messageId: "m1" }],
    ]);
  });
});

describe("createChatApi", () => {
  it("sends the ID token and streams the reply", async () => {
    const request: { url?: string; init?: RequestInit } = {};
    const api = createChatApi({
      baseUrl: "https://chat.example/",
      getIdToken: async () => "token-1",
      fetch: async (url, init) => {
        request.url = String(url);
        request.init = init;
        return sse([
          'event: text\ndata: {"delta":"Hi "}\n\n',
          'event: tool\ndata: {"name":"run_permit_check"}\n\nevent: text\ndata: {"delta":"there"}\n\n',
          'event: done\ndata: {"messageId":"m9","artifactIds":["a1"]}\n\n',
        ]);
      },
    });
    const text: string[] = [];
    const tools: string[] = [];
    const reply = await api.send({ projectId: "p1", chatId: "c1" }, { onText: (d) => text.push(d), onTool: (n) => tools.push(n) });
    expect(reply).toEqual({ messageId: "m9", artifactIds: ["a1"] });
    expect(text.join("")).toBe("Hi there");
    expect(tools).toEqual(["run_permit_check"]);
    expect(request.url).toBe("https://chat.example/api/chat");
    expect((request.init!.headers as Record<string, string>).authorization).toBe("Bearer token-1");
    expect(JSON.parse(request.init!.body as string)).toEqual({ projectId: "p1", chatId: "c1" });
  });

  it("shows the server's reason when it refuses", async () => {
    const api = createChatApi({
      baseUrl: "https://chat.example",
      getIdToken: async () => "t",
      fetch: async () => new Response(JSON.stringify({ error: "This account is not on the team list." }), { status: 403 }),
    });
    await expect(api.send({ projectId: "p1", chatId: "c1" })).rejects.toEqual(
      new ChatApiError(403, "This account is not on the team list."),
    );
  });

  it("fails when the stream reports an error", async () => {
    const api = createChatApi({
      baseUrl: "https://chat.example",
      getIdToken: async () => "t",
      fetch: async () => sse(['event: error\ndata: {"error":"Claude is busy."}\n\n']),
    });
    await expect(api.send({ projectId: "p1", chatId: "c1" })).rejects.toThrow("Claude is busy.");
  });
});
