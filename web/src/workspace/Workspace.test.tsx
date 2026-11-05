import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Assistant } from "./assistant";
import { MemoryStore } from "./memoryStore";
import { Workspace } from "./Workspace";
import { memoryRouter } from "./router";
import { fakeCheck, PAGES, pdfFile } from "./fixtures.test-utils";

const AHK = { uid: "u1", email: "ahk.archteam@gmail.com", name: "Ahk" };
const REZA = { uid: "u2", email: "rdghoorchian@gmail.com", name: "Reza" };

afterEach(cleanup);

/** One team member's browser: its own assistant, the shared store. */
function browser(store: MemoryStore, user: typeof AHK) {
  const assistant = new Assistant({ store, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
  // Each member gets a router of their own, like two browsers with their own address bars.
  const { container } = render(<Workspace store={store} assistant={assistant} user={user} router={memoryRouter()} />);
  return within(container);
}

async function createProject(view: ReturnType<typeof browser>) {
  fireEvent.click(view.getAllByRole("button", { name: "New project" })[0]);
  const form = within(view.getByRole("form", { name: "New project" }));
  fireEvent.change(form.getByLabelText("Project name"), { target: { value: "El Rio ADU" } });
  fireEvent.change(form.getByLabelText("Project address"), { target: { value: "428 El Rio Rd, Danville" } });
  fireEvent.change(form.getByLabelText("Jurisdiction"), { target: { value: "City of San Ramon" } });
  fireEvent.click(form.getByRole("button", { name: "Create project" }));
  await view.findByRole("link", { name: /^El Rio ADU/ });
}

describe("Workspace", () => {
  it("opens new project as a modal dialog that Escape, the backdrop and Cancel close", () => {
    const view = browser(new MemoryStore(), AHK);
    const opener = view.getAllByRole("button", { name: "New project" })[0];
    opener.focus();
    fireEvent.click(opener);
    const dialog = view.getByRole("dialog", { name: "New project" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Focus lands on the first field, the address.
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Project address"));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    fireEvent.mouseDown(view.getByRole("dialog").parentElement!);
    expect(view.queryByRole("dialog")).toBeNull();

    fireEvent.click(opener);
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("creates a project, then creates and renames a chat", async () => {
    const store = new MemoryStore();
    const view = browser(store, AHK);
    expect(await view.findByText("No projects yet.", { exact: false })).toBeTruthy();

    // A project needs an address and a jurisdiction.
    fireEvent.click(view.getAllByRole("button", { name: "New project" })[0]);
    fireEvent.click(view.getByRole("button", { name: "Create project" }));
    expect(view.getByRole("alert").textContent).toContain("Enter the project street address");
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));

    await createProject(view);
    expect([...store.projects.values()][0]).toMatchObject({
      name: "El Rio ADU",
      jurisdiction: "City of San Ramon",
      createdBy: AHK.email,
      members: ["team"],
    });

    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    const chats = await view.findByRole("list", { name: "Chats in El Rio ADU" });
    expect(within(chats).getByRole("link", { name: /^Chat 1\b/ }).getAttribute("aria-current")).toBe("page");
    expect(view.getByRole("heading", { level: 1, name: "Chat 1" })).toBeTruthy();
    expect(view.getByLabelText("Message").getAttribute("placeholder")).toBe("Type @ to attach a document, / for commands");

    fireEvent.click(view.getByRole("button", { name: "Chat options" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Rename chat" }));
    fireEvent.change(view.getByLabelText("Chat name"), { target: { value: "Plan check, round 1" } });
    fireEvent.click(view.getByRole("button", { name: "Save name" }));
    expect(await view.findByRole("heading", { level: 1, name: "Plan check, round 1" })).toBeTruthy();
    expect(within(chats).getByRole("link", { name: /^Plan check, round 1/ })).toBeTruthy();
    expect([...store.chats.values()][0].title).toBe("Plan check, round 1");
  });

  it("gives every project and chat its own link, and opens them from a link", async () => {
    const store = new MemoryStore();
    const router = memoryRouter();
    const assistant = new Assistant({ store, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
    const first = render(<Workspace store={store} assistant={assistant} user={AHK} router={router} />);
    const view = within(first.container);
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    expect(router.current()).toEqual({ projectId, chatId: null });
    expect(view.getByRole("link", { name: /^El Rio ADU/ }).getAttribute("href")).toBe(`#/projects/${projectId}`);
    expect(view.getByRole("heading", { level: 1, name: "El Rio ADU" })).toBeTruthy();

    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    await view.findByRole("heading", { level: 1, name: "Chat 1" });
    const chatId = [...store.chats.values()][0]!.id;
    expect(router.current()).toEqual({ projectId, chatId });

    // The project name over the chat goes back to the project page.
    fireEvent.click(view.getByRole("link", { name: "El Rio ADU" }));
    expect(router.current()).toEqual({ projectId, chatId: null });
    expect(await view.findByRole("heading", { level: 1, name: "El Rio ADU" })).toBeTruthy();

    // A link opened in another browser lands on the same chat.
    first.unmount();
    const other = within(
      render(<Workspace store={store} assistant={assistant} user={REZA} router={memoryRouter({ projectId, chatId })} />).container,
    );
    expect(await other.findByRole("heading", { level: 1, name: "Chat 1" })).toBeTruthy();

    // Back and forward buttons move the open project.
    const back = memoryRouter({ projectId, chatId });
    cleanup();
    const third = within(render(<Workspace store={store} assistant={assistant} user={AHK} router={back} />).container);
    await third.findByRole("heading", { level: 1, name: "Chat 1" });
    act(() => back.go({ projectId, chatId: null }));
    expect(await third.findByRole("heading", { level: 1, name: "El Rio ADU" })).toBeTruthy();
  });

  it("says when a link points to a project that is not there", async () => {
    const store = new MemoryStore();
    const assistant = new Assistant({ store, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
    const view = within(
      render(<Workspace store={store} assistant={assistant} user={AHK} router={memoryRouter({ projectId: "gone", chatId: null })} />).container,
    );
    expect(await view.findByRole("heading", { level: 1, name: "This project is not in the workspace" })).toBeTruthy();
  });

  it("shows slash commands in the composer", async () => {
    const store = new MemoryStore();
    const view = browser(store, AHK);
    await createProject(view);
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    const message = await view.findByLabelText("Message");
    fireEvent.change(message, { target: { value: "/" } });
    const commands = within(view.getByRole("list", { name: "Commands" }));
    expect(commands.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "/upload Upload a permit set PDF to work on",
      "/check Check the set and write an issue report",
      "/regenerate Regenerate the cover data and notes sheets",
      "/help What I can do in this chat",
    ]);
  });

  // Realtime: two team members on one store, like two browsers on one Firestore database.
  it("shows one member's messages and artifact updates to the other at once", async () => {
    const store = new MemoryStore();
    const ahk = browser(store, AHK);
    const reza = browser(store, REZA);

    await createProject(ahk);
    // Reza sees the new project without reloading.
    fireEvent.click(await reza.findByRole("link", { name: /^El Rio ADU/ }));

    fireEvent.click(ahk.getAllByRole("button", { name: "New chat" })[0]);
    await ahk.findByRole("heading", { level: 1, name: "Chat 1" });
    fireEvent.click(within(await reza.findByRole("list", { name: "Chats in El Rio ADU" })).getByRole("link", { name: /^Chat 1\b/ }));
    await reza.findByRole("heading", { level: 1, name: "Chat 1" });

    // Ahk uploads the set and the assistant asks what to do. Ahk asks for the check; Reza sees the report.
    fireEvent.change(ahk.getByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
    expect(await reza.findByText(/What do you want to do with it\?/)).toBeTruthy();
    expect(store.artifacts.size).toBe(0);
    await askForCheck(ahk);
    expect(await reza.findByText(/The check found 1 issue in 2 pages/)).toBeTruthy();
    expect(await reza.findByRole("heading", { level: 1, name: "Issue report: 428 El Rio Rd, Danville" })).toBeTruthy();
    expect(reza.getByText("Version 1")).toBeTruthy();
    expect(reza.getByText(/Uploaded 428-el-rio.pdf/)).toBeTruthy();

    // Reza asks for a change. Ahk sees version 2 of the same report.
    const message = reza.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "check it as Danville" } });
    fireEvent.keyDown(message, { key: "Enter" });
    expect(await ahk.findByText(/I changed the jurisdiction to Town of Danville/)).toBeTruthy();
    expect(await ahk.findByText("Version 2")).toBeTruthy();
    expect(ahk.getByText("The check found no issues.")).toBeTruthy();
    expect(ahk.getByText("check it as Danville")).toBeTruthy();
    expect(store.artifacts.size).toBe(1);
  });

  it("shows that the assistant is working while its reply streams", async () => {
    const store = new MemoryStore();
    const view = browser(store, AHK);
    await createProject(view);
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    await view.findByRole("heading", { level: 1, name: "Chat 1" });
    const projectId = [...store.projects.keys()][0];
    const chatId = [...store.chats.keys()][0];

    // The chat API starts its reply empty, flagged as streaming, and fills it in.
    await act(() => store.addMessage(projectId, chatId, { role: "assistant", text: "", author: "arconstructive", streaming: true } as never));
    expect((await view.findByRole("status")).textContent).toContain("Thinking…");
  });

  it("opens the earlier artifact from its message", async () => {
    const store = new MemoryStore();
    const view = browser(store, AHK);
    await createProject(view);
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    fireEvent.change(await view.findByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
    await askForCheck(view);
    await view.findByText(/The check found 1 issue in 2 pages/);

    const message = view.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "/regenerate" } });
    fireEvent.keyDown(message, { key: "Enter" });
    expect(await view.findByRole("heading", { level: 1, name: "Regenerated sheets: 428 EL RIO RD, DANVILLE" })).toBeTruthy();

    fireEvent.click(view.getAllByRole("button", { name: "Open the artifact" })[0]);
    expect(await view.findByRole("heading", { level: 1, name: "Issue report: 428 El Rio Rd, Danville" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Regenerated sheets: 428 EL RIO RD, DANVILLE" })).toBeNull();
  });
});

/** After an upload the assistant asks what to do: this answers with /check, for the issue report. */
async function askForCheck(view: Pick<ReturnType<typeof render>, "findByText" | "getByRole" | "getByLabelText">) {
  await view.findByText(/What do you want to do with it\?/);
  const message = view.getByLabelText("Message");
  // The upload is done when + can be used again.
  await waitFor(() => expect((view.getByRole("button", { name: "Upload a permit set PDF" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(message, { target: { value: "/check" } });
  fireEvent.keyDown(message, { key: "Enter" });
}
