// The team chat assistant, with Claude replaced by a scripted model: no key, no network.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ASSISTANT_AUTHOR, runChatTurn, toModelMessages } from "../src/chat/agent";
import { AuthError, authorize, type VerifyToken } from "../src/chat/auth";
import { DEFAULT_MODEL, chatConfig, type ChatConfig } from "../src/chat/config";
import type { ModelClient, ModelRequest, ModelResponse, ToolResultBlock } from "../src/chat/model";
import { SYSTEM_PROMPT } from "../src/chat/prompt";
import { MemoryChatStore } from "../src/chat/store";
import { createApp } from "../src/server";
import { loadElRio } from "./fixtures/el-rio/load";

const MEMBER = { uid: "u1", email: "rafi@example.com", name: "Rafi" };
const config: ChatConfig = { ...chatConfig({}), allowedEmails: ["rafi@example.com"] };

type Turn = (req: ModelRequest) => ModelResponse;

/** A model that plays back fixed replies and records what it was asked. */
function scripted(turns: Turn[]): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async stream(req, onText) {
      requests.push(structuredClone(req));
      const turn = turns[requests.length - 1];
      if (!turn) throw new Error("The scripted model has no more replies.");
      const res = turn(req);
      for (const block of res.content) {
        if (block.type === "text") for (const piece of (block.text as string).match(/[\s\S]{1,12}/g) ?? []) onText(piece);
      }
      return res;
    },
  };
}

const say = (text: string): Turn => () => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const call = (name: string, input: unknown, id = "call_1"): Turn => () => ({
  content: [
    { type: "text", text: "I will run the check." },
    { type: "tool_use", id, name, input },
  ],
  stop_reason: "tool_use",
});

function lastToolResult(req: ModelRequest): ToolResultBlock {
  const last = req.messages[req.messages.length - 1]!;
  const blocks = last.content as ToolResultBlock[];
  return blocks[0]!;
}

function setup(withSet = true) {
  const store = new MemoryChatStore();
  store.addProject({ id: "p1", name: "El Rio ADU", address: "428 El Rio Rd", jurisdiction: "Town of Danville", aduType: "Attached ADU" });
  store.chats.set("p1/c1", { messages: [], sets: [] });
  if (withSet) {
    store.addSet("p1", "c1", {
      fileName: "el-rio.pdf",
      pages: loadElRio(),
      project: { address: "428 El Rio Rd", jurisdiction: "Town of Danville", aduType: "Attached ADU" },
    });
  }
  return store;
}

describe("chat config", () => {
  it("defaults to a current Sonnet and the built-in prompt", () => {
    const c = chatConfig({});
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(c.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(c.allowedEmails).toEqual([]);
  });

  it("reads the model, prompt and team list from the environment", () => {
    const c = chatConfig({
      ANTHROPIC_MODEL: "claude-opus-5-5",
      CHAT_SYSTEM_PROMPT: "Be brief.",
      ALLOWED_EMAILS: " A@x.com, b@y.com ,",
      CHAT_MAX_TOKENS: "1200",
    });
    expect(c).toMatchObject({ model: "claude-opus-5-5", systemPrompt: "Be brief.", allowedEmails: ["a@x.com", "b@y.com"], maxTokens: 1200 });
  });

  it("tells Claude never to invent code sections and to say when it is unsure", () => {
    expect(SYSTEM_PROMPT).toMatch(/Never invent a code section number/);
    expect(SYSTEM_PROMPT).toMatch(/When you are not sure, say so/);
    expect(SYSTEM_PROMPT).toMatch(/2025 California Building Standards Code/);
  });
});

describe("authorize", () => {
  const verify: VerifyToken = async (token) => {
    if (token === "member") return MEMBER;
    if (token === "outsider") return { uid: "u2", email: "someone@else.com" };
    throw new Error("bad token");
  };
  const status = (p: Promise<unknown>) => p.then(() => 200, (e: unknown) => (e instanceof AuthError ? e.status : 500));

  it("needs a bearer token", async () => {
    expect(await status(authorize(undefined, verify, config.allowedEmails))).toBe(401);
    expect(await status(authorize("Basic abc", verify, config.allowedEmails))).toBe(401);
  });
  it("refuses a token Firebase does not accept", async () => {
    expect(await status(authorize("Bearer forged", verify, config.allowedEmails))).toBe(401);
  });
  it("refuses a signed-in user who is not on the team", async () => {
    expect(await status(authorize("Bearer outsider", verify, config.allowedEmails))).toBe(403);
  });
  it("lets nobody in when the team list is empty", async () => {
    expect(await status(authorize("Bearer member", verify, []))).toBe(403);
  });
  it("accepts a team member", async () => {
    await expect(authorize("Bearer member", verify, config.allowedEmails)).resolves.toMatchObject({ email: "rafi@example.com" });
  });
});

describe("toModelMessages", () => {
  it("names each writer, joins turns of the same side and starts with the user", () => {
    const out = toModelMessages([
      { id: "1", role: "assistant", text: "Welcome", author: ASSISTANT_AUTHOR },
      { id: "2", role: "user", text: "Hi", author: "Rafi" },
      { id: "3", role: "user", text: "Check it", author: "Ahk" },
      { id: "4", role: "assistant", text: "", author: ASSISTANT_AUTHOR },
    ]);
    expect(out).toEqual([{ role: "user", content: "Rafi: Hi\n\nAhk: Check it" }]);
  });
});

describe("runChatTurn", () => {
  let store: MemoryChatStore;
  beforeEach(() => {
    store = setup();
  });

  it("answers a free-form question with Claude's reply and saves it to the shared chat", async () => {
    store.addUserMessage("p1", "c1", "Rafi", "what is the max height for a detached ADU in Danville?");
    const answer =
      "State law (Gov. Code 66321) sets a floor of 16 feet for a detached ADU; Danville's own limit can differ, so confirm it with the planning desk.";
    const model = scripted([say(answer)]);
    const streamed: string[] = [];
    const result = await runChatTurn({ store, model, config }, { projectId: "p1", chatId: "c1", user: MEMBER }, { onText: (d) => streamed.push(d) });

    expect(result.text).toBe(answer);
    expect(streamed.length).toBeGreaterThan(1);
    expect(streamed.join("")).toBe(answer);
    const saved = store.chats.get("p1/c1")!.messages.at(-1)!;
    expect(saved).toMatchObject({ role: "assistant", author: ASSISTANT_AUTHOR, text: answer, streaming: false });
    expect(saved.text).not.toMatch(/Upload a permit set|I can run/);

    const req = model.requests[0]!;
    expect(req.model).toBe(config.model);
    expect(req.system[0]).toBe(config.systemPrompt);
    expect(req.system[1]).toMatch(/Jurisdiction: Town of Danville/);
    expect(req.system[1]).toMatch(/el-rio\.pdf \(51 pages\)/);
    expect(req.messages.at(-1)).toEqual({ role: "user", content: "Rafi: what is the max height for a detached ADU in Danville?" });
    expect(req.tools.map((t) => t.name)).toEqual([
      "run_permit_check",
      "regenerate_sheets",
      "read_sheet_text",
      "create_or_update_artifact",
      "read_site_report",
    ]);
  });

  it("runs the permit check as a tool and saves the issue report as a new artifact version", async () => {
    store.addUserMessage("p1", "c1", "Rafi", "Check this set please");
    const model = scripted([call("run_permit_check", {}), say("The check found issues; the report is on the canvas.")]);
    const result = await runChatTurn({ store, model, config }, { projectId: "p1", chatId: "c1", user: MEMBER });

    const toolResult = lastToolResult(model.requests[1]!);
    expect(toolResult.is_error).toBeUndefined();
    const summary = JSON.parse(toolResult.content);
    expect(summary.findings_total).toBeGreaterThan(0);
    expect(summary.version).toBe(1);

    const artifact = store.artifacts.get(`p1/${summary.artifact_id}`)!;
    expect(artifact).toMatchObject({ kind: "issue_report", status: "ready", version: 1, chatId: "c1", updatedBy: "rafi@example.com" });
    expect(artifact.content).toMatch(/^# Issue report: 428 El Rio Rd/);
    expect(artifact.versions).toHaveLength(1);
    expect(result.artifactIds).toEqual([summary.artifact_id]);
    const saved = store.chats.get("p1/c1")!.messages.at(-1)!;
    expect(saved.artifactId).toBe(summary.artifact_id);
    expect(saved.text).toBe("I will run the check.\n\nThe check found issues; the report is on the canvas.");

    // A second check writes version 2 of the same report.
    store.addUserMessage("p1", "c1", "Rafi", "Check it again");
    const again = scripted([call("run_permit_check", { jurisdiction: "Town of Danville" }), say("Done.")]);
    await runChatTurn({ store, model: again, config }, { projectId: "p1", chatId: "c1", user: MEMBER });
    expect(store.artifacts.get(`p1/${summary.artifact_id}`)!.version).toBe(2);
  });

  it("writes a document and a new version of it", async () => {
    store.addUserMessage("p1", "c1", "Rafi", "Draft a plan check response");
    const model = scripted([
      call("create_or_update_artifact", { title: "Plan check response", content: "# Plan check response\n\n1. Fixed." }),
      say("Drafted."),
    ]);
    await runChatTurn({ store, model, config }, { projectId: "p1", chatId: "c1", user: MEMBER });
    const created = JSON.parse(lastToolResult(model.requests[1]!).content);
    expect(created.version).toBe(1);

    store.addUserMessage("p1", "c1", "Rafi", "Add item 2");
    const edit = scripted([
      call("create_or_update_artifact", {
        artifact_id: created.artifact_id,
        title: "Plan check response",
        content: "# Plan check response\n\n1. Fixed.\n\n2. Added.",
      }),
      say("Updated."),
    ]);
    await runChatTurn({ store, model: edit, config }, { projectId: "p1", chatId: "c1", user: MEMBER });
    const artifact = store.artifacts.get(`p1/${created.artifact_id}`)!;
    expect(artifact).toMatchObject({ kind: "document", version: 2, status: "ready" });
    expect(artifact.content).toMatch(/2\. Added\./);
  });

  it("reads one sheet's text", async () => {
    store.addUserMessage("p1", "c1", "Rafi", "What does the cover say?");
    const model = scripted([call("read_sheet_text", { sheet: "a-0.1" }), say("It says …")]);
    await runChatTurn({ store, model, config }, { projectId: "p1", chatId: "c1", user: MEMBER });
    expect(lastToolResult(model.requests[1]!).content).toMatch(/^Page \d+ · sheet A-0\.1/);
  });

  it("asks for the PDF when no set is uploaded", async () => {
    store = setup(false);
    store.addUserMessage("p1", "c1", "Rafi", "Check the set");
    const model = scripted([call("run_permit_check", {}), say("Please upload the PDF.")]);
    await runChatTurn({ store, model, config }, { projectId: "p1", chatId: "c1", user: MEMBER });
    expect(lastToolResult(model.requests[1]!).content).toMatch(/No permit set is uploaded/);
    expect(store.artifacts.size).toBe(0);
  });

  it("saves the reason in the chat when Claude fails", async () => {
    store.addUserMessage("p1", "c1", "Rafi", "Hello");
    const model: ModelClient = {
      async stream() {
        throw new Error("overloaded");
      },
    };
    await expect(runChatTurn({ store, model, config }, { projectId: "p1", chatId: "c1", user: MEMBER })).rejects.toThrow("overloaded");
    expect(store.chats.get("p1/c1")!.messages.at(-1)).toMatchObject({ streaming: false, text: expect.stringMatching(/overloaded/) });
  });
});

// The server listens on the loopback interface only.
describe("POST /api/chat", () => {
  let server: Server;
  let noModel: Server;
  let base: string;
  let noModelBase: string;
  let store: MemoryChatStore;
  const verifyToken: VerifyToken = async (token) => {
    if (token === "member") return MEMBER;
    if (token === "outsider") return { uid: "u2", email: "someone@else.com" };
    throw new Error("bad token");
  };
  const listen = async (s: Server) => {
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };

  beforeAll(async () => {
    store = setup();
    store.addUserMessage("p1", "c1", "Rafi", "Hello there");
    server = createApp({
      allowedOrigin: "https://arconstructive.web.app,https://arconstructive.firebaseapp.com",
      chat: { verifyToken, config, store, model: scripted([say("Hello Rafi, how can I help with the set?")]) },
    });
    noModel = createApp({ chat: { verifyToken, config, store, model: null } });
    base = await listen(server);
    noModelBase = await listen(noModel);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => noModel.close(() => resolve()));
  });

  const post = (url: string, token?: string, body: unknown = { projectId: "p1", chatId: "c1" }) =>
    fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://arconstructive.firebaseapp.com", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it("answers 401 without a token", async () => {
    expect((await post(base)).status).toBe(401);
  });
  it("answers 401 for a token Firebase does not accept", async () => {
    expect((await post(base, "forged")).status).toBe(401);
  });
  it("answers 403 for a user who is not on the team", async () => {
    expect((await post(base, "outsider")).status).toBe(403);
  });
  it("answers 400 without a project and chat", async () => {
    expect((await post(base, "member", { projectId: "../x" })).status).toBe(400);
  });
  it("answers 503 when the server has no Anthropic key", async () => {
    expect((await post(noModelBase, "member")).status).toBe(503);
  });
  it("lets the web app's origin send the token", async () => {
    const res = await fetch(`${base}/api/chat`, { method: "OPTIONS", headers: { origin: "https://arconstructive.firebaseapp.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://arconstructive.firebaseapp.com");
    expect(res.headers.get("access-control-allow-headers")).toMatch(/authorization/);
  });
  it("streams Claude's reply to a team member and saves it", async () => {
    const res = await post(base, "member");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const body = await res.text();
    expect(body).toMatch(/event: text\ndata: /);
    expect(body).toMatch(/event: done\ndata: \{"messageId":"m\d+"/);
    expect(store.chats.get("p1/c1")!.messages.at(-1)).toMatchObject({ text: "Hello Rafi, how can I help with the set?", streaming: false });
  });
});
