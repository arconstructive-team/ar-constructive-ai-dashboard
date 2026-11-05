import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Assistant } from "./assistant";
import { MemoryStore } from "./memoryStore";
import { Workspace } from "./Workspace";
import { fakeCheck, PAGES, pdfFile } from "./fixtures.test-utils";

const AHK = { uid: "u1", email: "ahk.archteam@gmail.com", name: "Ahk" };
const REZA = { uid: "u2", email: "rdghoorchian@gmail.com", name: "Reza" };

afterEach(cleanup);

/** One team member's browser: its own assistant, the shared store. */
function browser(store: MemoryStore, user: typeof AHK) {
  const assistant = new Assistant({ store, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
  const { container } = render(<Workspace store={store} assistant={assistant} user={user} />);
  return within(container);
}

async function createProject(view: ReturnType<typeof browser>) {
  fireEvent.click(view.getAllByRole("button", { name: "New project" })[0]);
  const form = within(view.getByRole("form", { name: "New project" }));
  fireEvent.change(form.getByLabelText("Project name"), { target: { value: "El Rio ADU" } });
  fireEvent.change(form.getByLabelText("Project address"), { target: { value: "428 El Rio Rd, Danville" } });
  fireEvent.change(form.getByLabelText("Jurisdiction"), { target: { value: "City of San Ramon" } });
  fireEvent.click(form.getByRole("button", { name: "Create project" }));
  await view.findByRole("button", { name: "El Rio ADU" });
}

describe("Workspace", () => {
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
    expect(within(chats).getByRole("button", { name: "Chat 1" }).getAttribute("aria-current")).toBe("page");
    expect(view.getByRole("heading", { level: 1, name: "Chat 1" })).toBeTruthy();
    expect(view.getByLabelText("Message").getAttribute("placeholder")).toBe("Type / for commands");

    fireEvent.click(view.getByRole("button", { name: "Chat options" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Rename chat" }));
    fireEvent.change(view.getByLabelText("Chat name"), { target: { value: "Plan check, round 1" } });
    fireEvent.click(view.getByRole("button", { name: "Save name" }));
    expect(await view.findByRole("heading", { level: 1, name: "Plan check, round 1" })).toBeTruthy();
    expect(within(chats).getByRole("button", { name: "Plan check, round 1" })).toBeTruthy();
    expect([...store.chats.values()][0].title).toBe("Plan check, round 1");
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
      "/check Upload a permit set PDF and check it",
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
    fireEvent.click(await reza.findByRole("button", { name: "El Rio ADU" }));

    fireEvent.click(ahk.getAllByRole("button", { name: "New chat" })[0]);
    await ahk.findByRole("heading", { level: 1, name: "Chat 1" });
    fireEvent.click(await reza.findByRole("button", { name: "Chat 1" }));
    await reza.findByRole("heading", { level: 1, name: "Chat 1" });

    // Ahk uploads the set. Reza sees the messages and the issue report.
    fireEvent.change(ahk.getByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
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

  it("opens the earlier artifact from its message", async () => {
    const store = new MemoryStore();
    const view = browser(store, AHK);
    await createProject(view);
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    fireEvent.change(await view.findByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
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
