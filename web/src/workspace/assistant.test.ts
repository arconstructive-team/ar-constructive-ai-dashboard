import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME, Assistant, type ChatContext } from "./assistant";
import { MemoryStore } from "./memoryStore";
import type { ArtifactStatus } from "./types";
import { PAGES, fakeCheck, pdfFile } from "./fixtures.test-utils";

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
  it("checks an uploaded PDF and writes the issue report a part at a time", async () => {
    const { store, chatId, assistant, ctx, statuses } = await setup();
    const contents: string[] = [];
    const update = store.updateArtifact.bind(store);
    store.updateArtifact = async (projectId, artifactId, patch) => {
      if (patch.content) contents.push(patch.content);
      return update(projectId, artifactId, patch);
    };

    await assistant.upload(ctx(), pdfFile());

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
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(messages[0]).toMatchObject({ author: "Ahk", text: expect.stringContaining("Uploaded 428-el-rio.pdf") });
    expect(messages[2]).toMatchObject({ artifactId: report.id, text: expect.stringContaining("found 1 issue in 2 pages") });
    expect(store.sets.get(chatId)?.[0].pages).toEqual(PAGES);
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
    expect(store.artifacts.size).toBe(2);
  });

  it("lets another team member continue from the set stored in the chat", async () => {
    const { store, assistant, ctx, chatId } = await setup();
    await assistant.upload(ctx(), pdfFile());

    const otherBrowser = new Assistant({ store, check: fakeCheck, pause: async () => undefined });
    await otherBrowser.send(ctx(RD.name), "regenerate the sheets");

    expect([...store.artifacts.values()].map((a) => a.kind)).toEqual(["issue_report", "sheet_set"]);
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

  it("sets status error when the work fails", async () => {
    const { store, assistant, ctx, chatId, statuses } = await setup(async () => {
      throw new Error("The PDF has no text layer.");
    });
    await assistant.upload(ctx(), pdfFile());

    const [report] = [...store.artifacts.values()];
    expect(report).toMatchObject({ status: "error", error: "The PDF has no text layer.", version: 0 });
    expect(statuses.get(report.id)).toEqual(["generating", "error"]);
    expect((store.messages.get(chatId) ?? []).at(-1)?.text).toBe("The work stopped: The PDF has no text layer.");
  });

  it("refuses a file that is not a PDF", async () => {
    const { store, assistant, ctx, chatId } = await setup();
    await assistant.upload(ctx(), new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(store.artifacts.size).toBe(0);
    expect((store.messages.get(chatId) ?? []).at(-1)?.role).toBe("assistant");
  });
});
