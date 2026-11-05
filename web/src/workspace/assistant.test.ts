import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME, Assistant, type ChatContext } from "./assistant";
import { MemoryStore } from "./memoryStore";
import type { ArtifactStatus } from "./types";
import { PAGES, fakeCheck, pdfFile } from "./fixtures.test-utils";
import { ChatApiError, type ChatApi, type ChatTarget } from "../lib/chatApi";

const AHK = { uid: "u1", email: "ahk.archteam@gmail.com", name: "Ahk" };
const RD = { uid: "u2", email: "rdghoorchian@gmail.com", name: "Reza" };

async function setup(extractPages = async () => PAGES) {
  const store = new MemoryStore();
  const projectId = await store.createProject(
    { name: "El Rio ADU", address: "428 El Rio Rd, Danville", jurisdiction: "City of San Ramon", aduType: "No ADU" },
    AHK,
  );
  const chatId = await store.createChat(projectId, "Chat 1", AHK);
  const assistant = new Assistant({ store, extractPages, check: fakeCheck, pause: async () => undefined });
  const ctx = (author = AHK.name): ChatContext => {
    const p = store.projects.get(projectId);
    if (!p) throw new Error("no project");
    return {
      projectId,
      chatId,
      project: { address: p.address, jurisdiction: p.jurisdiction, aduType: p.aduType },
      author,
      messages: store.messages.get(chatId) ?? [],
    };
  };
  // Every write reaches every listener, so this records each status an artifact goes through.
  const statuses = new Map<string, ArtifactStatus[]>();
  store.watchProjects(() => {
    for (const a of store.artifacts.values()) {
      const seen = statuses.get(a.id) ?? [];
      if (seen[seen.length - 1] !== a.status) statuses.set(a.id, [...seen, a.status]);
    }
  });
  return { store, projectId, chatId, assistant, ctx, statuses };
}

describe("Assistant", () => {
  it("reads an uploaded PDF, keeps it for the team and asks what to do, without writing a report", async () => {
    const { store, chatId, assistant, ctx } = await setup();
    await assistant.upload(ctx(), pdfFile());

    expect(store.artifacts.size).toBe(0);
    expect(store.sets.get(chatId)?.[0].pages).toEqual(PAGES);
    const messages = store.messages.get(chatId) ?? [];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]).toMatchObject({ author: "Ahk", text: expect.stringContaining("Uploaded 428-el-rio.pdf") });
    expect(messages[1].text).toContain("I read 428-el-rio.pdf (2 pages) and kept it for the team");
    expect(messages[1].text).toContain("What do you want to do with it?");
    expect(messages[1].text).toContain('write "check the set"');
  });

  it("checks the set when asked and writes the issue report a part at a time", async () => {
    const { store, chatId, assistant, ctx, statuses } = await setup();
    const contents: string[] = [];
    const update = store.updateArtifact.bind(store);
    store.updateArtifact = async (projectId, artifactId, patch) => {
      if (patch.content) contents.push(patch.content);
      return update(projectId, artifactId, patch);
    };

    await assistant.upload(ctx(), pdfFile());
    await assistant.send(ctx(), "check the set");

    const [report] = [...store.artifacts.values()];
    expect(report).toMatchObject({ kind: "issue_report", status: "ready", version: 1, chatId, updatedBy: ASSISTANT_NAME });
    expect(report.title).toBe("Issue report: 428 El Rio Rd, Danville");
    expect(report.content).toContain("Boilerplate names another city than City of San Ramon");
    expect(statuses.get(report.id)).toEqual(["generating", "ready"]);
    // The content grows while the status is "generating".
    expect(contents.length).toBeGreaterThan(3);
    expect(contents[contents.length - 1]).toBe(report.content);
    expect(store.versions.get(report.id)?.map((v) => v.version)).toEqual([1]);

    const messages = store.messages.get(chatId) ?? [];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[3]).toMatchObject({ artifactId: report.id, text: expect.stringContaining("found 1 issue in 2 pages") });
  });

  it("keeps new project data without writing a report nobody asked for", async () => {
    const { store, chatId, assistant, ctx } = await setup();
    await assistant.upload(ctx(), pdfFile());
    await assistant.send(ctx(), "this is an attached ADU");

    expect(store.artifacts.size).toBe(0);
    expect((store.messages.get(chatId) ?? []).at(-1)?.text).toContain("I changed the ADU type to Attached ADU.");
    expect(store.sets.get(chatId)?.[0].project.aduType).toBe("Attached ADU");
  });

  it("regenerates the sheets as a sheet set artifact", async () => {
    const { store, chatId, assistant, ctx } = await setup();
    await assistant.upload(ctx(), pdfFile());
    await assistant.send(ctx(), "regenerate the sheets");

    const sheets = [...store.artifacts.values()].find((a) => a.kind === "sheet_set");
    expect(sheets).toMatchObject({ status: "ready", version: 1, title: "Regenerated sheets: 428 EL RIO RD, DANVILLE" });
    expect(sheets?.content).toContain("All work shall comply with the City of San Ramon code.");
    const last = (store.messages.get(chatId) ?? []).at(-1);
    expect(last).toMatchObject({ role: "assistant", artifactId: sheets?.id, text: expect.stringContaining("I regenerated A-0.1") });
  });

  it("writes a follow-up as a new version of the same artifact", async () => {
    const { store, assistant, ctx } = await setup();
    await assistant.upload(ctx(), pdfFile());
    await assistant.send(ctx(), "check the set");
    const [report] = [...store.artifacts.values()];

    await assistant.send(ctx(), "check it as Danville");

    expect(store.artifacts.size).toBe(1);
    const next = store.artifacts.get(report.id);
    expect(next).toMatchObject({ status: "ready", version: 2 });
    expect(next?.content).toContain("The check found no issues.");
    expect(store.versions.get(report.id)?.map((v) => v.version)).toEqual([1, 2]);
    expect(store.versions.get(report.id)?.[0].content).toContain("City of San Ramon");
  });

  it("edits the sheet set when the follow-up is about the sheets", async () => {
    const { store, assistant, ctx } = await setup();
    await assistant.upload(ctx(), pdfFile());
    await assistant.send(ctx(), "regenerate the sheets");
    await assistant.send(ctx(), "fix the jurisdiction on the sheets");

    const sheets = [...store.artifacts.values()].find((a) => a.kind === "sheet_set");
    expect(sheets).toMatchObject({ version: 2, status: "ready" });
    expect(sheets?.content).toContain("All work shall comply with the Town of Danville code.");
    expect(store.artifacts.size).toBe(1);
  });

  it("lets another team member continue from the set stored in the chat", async () => {
    const { store, assistant, ctx, chatId } = await setup();
    await assistant.upload(ctx(), pdfFile());

    const otherBrowser = new Assistant({ store, check: fakeCheck, pause: async () => undefined });
    await otherBrowser.send(ctx(RD.name), "regenerate the sheets");

    expect([...store.artifacts.values()].map((a) => a.kind)).toEqual(["sheet_set"]);
    expect(store.messages.get(chatId)?.find((m) => m.author === "Reza")?.text).toBe("regenerate the sheets");
  });

  it("asks for the PDF first, and explains what it can do", async () => {
    const { store, assistant, ctx, chatId } = await setup();
    await assistant.send(ctx(), "regenerate the sheets");
    await assistant.send(ctx(), "hello");
    const replies = (store.messages.get(chatId) ?? []).filter((m) => m.role === "assistant").map((m) => m.text);
    expect(replies[0]).toContain("Upload the permit set PDF here first");
    expect(replies[1]).toContain("I can do these things in this chat");
    expect(store.artifacts.size).toBe(0);
  });

  it("says why when the PDF cannot be read", async () => {
    const { store, assistant, ctx, chatId } = await setup(async () => {
      throw new Error("The PDF has no text layer.");
    });
    await assistant.upload(ctx(), pdfFile());

    expect(store.artifacts.size).toBe(0);
    expect((store.messages.get(chatId) ?? []).at(-1)?.text).toBe("I could not read 428-el-rio.pdf. The PDF has no text layer.");
  });

  it("sets status error when writing the report fails", async () => {
    const { store, assistant, ctx, chatId, statuses } = await setup();
    await assistant.upload(ctx(), pdfFile());
    store.commitVersion = async () => {
      throw new Error("The database is offline.");
    };
    await assistant.send(ctx(), "check the set");

    const [report] = [...store.artifacts.values()];
    expect(report).toMatchObject({ status: "error", error: "The database is offline.", version: 0 });
    expect(statuses.get(report.id)).toEqual(["generating", "error"]);
    expect((store.messages.get(chatId) ?? []).at(-1)?.text).toBe("The work stopped: The database is offline.");
  });

  it("still answers when the file cannot be stored in the documents", async () => {
    const { store, assistant, ctx, chatId } = await setup();
    store.addDocument = async () => {
      throw new Error("storage/retry-limit-exceeded");
    };
    await assistant.upload(ctx(), pdfFile());
    const last = (store.messages.get(chatId) ?? []).at(-1)?.text ?? "";
    expect(last).toContain("What do you want to do with it?");
    expect(last).toContain("the file could not be stored");
  });

  it("refuses a file that is not a PDF", async () => {
    const { store, assistant, ctx, chatId } = await setup();
    await assistant.upload(ctx(), new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(store.artifacts.size).toBe(0);
    expect((store.messages.get(chatId) ?? []).at(-1)?.role).toBe("assistant");
  });
});

describe("Assistant with Claude (the chat API)", () => {
  /** A chat API that stands in for the server: it writes Claude's reply into the shared chat. */
  function fakeChat(store: MemoryStore, reply: (target: ChatTarget) => Promise<string> | string) {
    const calls: ChatTarget[] = [];
    const chat: ChatApi = {
      async send(target) {
        calls.push(target);
        const text = await reply(target);
        const messageId = await store.addMessage(target.projectId, target.chatId, { role: "assistant", text, author: ASSISTANT_NAME });
        return { messageId, artifactIds: [] };
      },
    };
    return { chat, calls };
  }

  it("sends a free-form message to Claude instead of the help text", async () => {
    const store = new MemoryStore();
    const { chat, calls } = fakeChat(store, () => "For a detached ADU, check the side and rear setbacks in the city's ADU ordinance.");
    const { assistant, ctx, chatId, projectId } = await setupWith(store, chat);

    await assistant.send(ctx(), "What setbacks apply to a detached ADU?");

    expect(calls).toEqual([{ projectId, chatId }]);
    const messages = store.messages.get(chatId) ?? [];
    expect(messages.map((m) => [m.role, m.author])).toEqual([
      ["user", "Ahk"],
      ["assistant", ASSISTANT_NAME],
    ]);
    expect(messages[1].text).toContain("setbacks");
    expect(messages.some((m) => m.text.includes("I can do these things in this chat"))).toBe(false);
  });

  it("sends commands to Claude too, which runs the tools on the server", async () => {
    const store = new MemoryStore();
    const { chat, calls } = fakeChat(store, () => "I regenerated the sheets.");
    const { assistant, ctx } = await setupWith(store, chat);
    await assistant.send(ctx(), "regenerate the sheets");
    expect(calls).toHaveLength(1);
    // The browser writes no artifact: the server's tools do.
    expect(store.artifacts.size).toBe(0);
  });

  it("says why when the server refuses the request", async () => {
    const store = new MemoryStore();
    const chat: ChatApi = {
      async send() {
        throw new ChatApiError(403, "This account is not on the team list.");
      },
    };
    const { assistant, ctx, chatId } = await setupWith(store, chat);
    await assistant.send(ctx(), "hello");
    expect((store.messages.get(chatId) ?? []).at(-1)).toMatchObject({
      role: "assistant",
      text: "The assistant could not answer: This account is not on the team list.",
    });
  });

  it("adds nothing when the server already wrote the failure into its reply", async () => {
    const store = new MemoryStore();
    const chat: ChatApi = {
      async send() {
        throw new ChatApiError(500, "The model is overloaded.");
      },
    };
    const { assistant, ctx, chatId } = await setupWith(store, chat);
    await assistant.send(ctx(), "hello");
    expect((store.messages.get(chatId) ?? []).map((m) => m.role)).toEqual(["user"]);
  });

  it("saves the uploaded set, then lets Claude say what it is and ask what to work on", async () => {
    const store = new MemoryStore();
    let setWhenAsked: unknown = null;
    const { chat, calls } = fakeChat(store, (target) => {
      setWhenAsked = store.sets.get(target.chatId)?.[0]?.fileName ?? null;
      return "This is a 2-sheet set for 428 El Rio Rd. What do you want to work on first?";
    });
    const { assistant, ctx, chatId, projectId } = await setupWith(store, chat);
    await assistant.upload(ctx(), pdfFile());

    expect(calls).toEqual([{ projectId, chatId }]);
    // Claude reads the set from the chat, so it is saved before Claude is asked.
    expect(setWhenAsked).toBe("428-el-rio.pdf");
    // The browser writes no report: the team chooses the work.
    expect(store.artifacts.size).toBe(0);
    expect((store.messages.get(chatId) ?? []).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  async function setupWith(store: MemoryStore, chat: ChatApi) {
    const projectId = await store.createProject(
      { name: "El Rio ADU", address: "428 El Rio Rd, Danville", jurisdiction: "City of San Ramon", aduType: "No ADU" },
      AHK,
    );
    const chatId = await store.createChat(projectId, "Chat 1", AHK);
    const assistant = new Assistant({ store, chat, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
    const ctx = (): ChatContext => ({
      projectId,
      chatId,
      project: { address: "428 El Rio Rd, Danville", jurisdiction: "City of San Ramon", aduType: "No ADU" },
      author: AHK.name,
      messages: store.messages.get(chatId) ?? [],
    });
    return { assistant, ctx, chatId, projectId };
  }
});
