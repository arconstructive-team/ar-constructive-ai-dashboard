import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Assistant } from "./assistant";
import { capPages, MAX_DOCUMENT_CHARS, readDocument, splitText } from "./documents";
import { fakeCheck, PAGES, pdfFile } from "./fixtures.test-utils";
import { MemoryStore } from "./memoryStore";
import { memoryRouter } from "./router";
import { Workspace } from "./Workspace";

const AHK = { uid: "u1", email: "ahk.archteam@gmail.com", name: "Ahk" };

afterEach(cleanup);

function mount(store = new MemoryStore()) {
  const assistant = new Assistant({ store, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
  const router = memoryRouter();
  const view = within(render(<Workspace store={store} assistant={assistant} user={AHK} router={router} />).container);
  return { store, view, router };
}

async function createProject(view: ReturnType<typeof mount>["view"]) {
  fireEvent.click(view.getAllByRole("button", { name: "New project" })[0]);
  const form = within(view.getByRole("form", { name: "New project" }));
  fireEvent.change(form.getByLabelText("Project name"), { target: { value: "El Rio ADU" } });
  fireEvent.change(form.getByLabelText("Project address"), { target: { value: "428 El Rio Rd, Danville" } });
  fireEvent.change(form.getByLabelText("Jurisdiction"), { target: { value: "City of San Ramon" } });
  fireEvent.click(form.getByRole("button", { name: "Create project" }));
  await view.findByRole("heading", { level: 1, name: "El Rio ADU" });
}

describe("reading a document's text", () => {
  it("reads PDFs page by page and text files in parts, and keeps other files without text", async () => {
    const pdf = await readDocument(pdfFile("soils.pdf"), "Ahk", async () => PAGES);
    expect(pdf).toMatchObject({ name: "soils.pdf", contentType: "application/pdf", uploadedBy: "Ahk", pages: PAGES });

    const notes = await readDocument(new File(["Plan check comment 1\nAdd the egress window."], "comments.txt", { type: "text/plain" }), "Ahk", async () => []);
    expect(notes.pages).toEqual([{ page: 1, text: "Plan check comment 1\nAdd the egress window." }]);

    const photo = await readDocument(new File([new Uint8Array([1, 2, 3])], "lot.jpg", { type: "image/jpeg" }), "Ahk", async () => PAGES);
    expect(photo.pages).toEqual([]);

    const scan = await readDocument(pdfFile("scan.pdf"), "Ahk", async () => {
      throw new Error("no text layer");
    });
    expect(scan.pages).toEqual([]);
  });

  it("splits long text at line breaks and keeps whole pages up to the limit", () => {
    const parts = splitText(`${"a".repeat(3000)}\n${"b".repeat(3000)}\n${"c".repeat(100)}`);
    expect(parts.map((p) => p.page)).toEqual([1, 2]);
    expect(parts[0]!.text).toBe("a".repeat(3000));
    const big = Array.from({ length: 3 }, (_, i) => ({ page: i + 1, text: "x".repeat(MAX_DOCUMENT_CHARS / 2) }));
    expect(capPages(big)).toEqual({ pages: big.slice(0, 2), truncated: true });
  });
});

describe("project page", () => {
  it("adds a link and a file in the Documents section, lists them and changes a status", async () => {
    const { store, view } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    const section = within(await view.findByRole("region", { name: "Documents" }));
    expect(await section.findByText(/No documents yet/)).toBeTruthy();

    fireEvent.click(section.getByRole("button", { name: "Add link" }));
    const formElement = section.getByRole("form", { name: "Add a link" });
    const form = within(formElement);
    fireEvent.change(form.getByLabelText("Title"), { target: { value: "Survey on the shared drive" } });
    fireEvent.change(form.getByLabelText("Link"), { target: { value: "not a link" } });
    // Submit directly: the browser's own check of a URL field would stop a click first.
    fireEvent.submit(formElement);
    expect(await form.findByText(/starts with https/)).toBeTruthy();
    fireEvent.change(form.getByLabelText("Link"), { target: { value: "https://drive.google.com/file/d/abc" } });
    fireEvent.change(form.getByLabelText("Kind"), { target: { value: "survey" } });
    fireEvent.click(form.getByRole("button", { name: "Add link" }));

    const list = within(await section.findByRole("list", { name: "Documents of the project" }));
    expect(list.getByText("Survey on the shared drive")).toBeTruthy();
    expect(list.getByText(/Link to drive\.google\.com · Updated .* · Added by Ahk/)).toBeTruthy();
    const open = list.getByRole("link", { name: "Open Survey on the shared drive" });
    expect(open.getAttribute("href")).toBe("https://drive.google.com/file/d/abc");
    expect(store.documents.get(projectId)?.[0]).toMatchObject({ source: "link", kind: "survey", status: "draft" });

    fireEvent.change(section.getByLabelText("File to add to the project"), {
      target: { files: [new File(["Expansive clay"], "soils-report.txt", { type: "text/plain" })] },
    });
    expect(await section.findByText("Added soils-report.txt")).toBeTruthy();
    expect(await section.findByRole("button", { name: "Open soils-report.txt" })).toBeTruthy();

    fireEvent.change(section.getByLabelText("Status of Survey on the shared drive"), { target: { value: "final" } });
    await waitFor(() =>
      expect(store.documents.get(projectId)?.find((d) => d.source === "link")).toMatchObject({ status: "final" }),
    );
  });

  it("saves the project's status and client for the team", async () => {
    const { store, view } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    const form = within(view.getByRole("form", { name: "Project status and client" }));
    expect((form.getByLabelText("Status") as HTMLSelectElement).value).toBe("intake");

    fireEvent.change(form.getByLabelText("Status"), { target: { value: "permit_set" } });
    await waitFor(() => expect(store.projects.get(projectId)?.status).toBe("permit_set"));

    const save = form.getByRole("button", { name: "Save client" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(form.getByLabelText("Client"), { target: { value: "  Rivera family " } });
    fireEvent.click(save);
    await waitFor(() => expect(store.projects.get(projectId)?.client).toBe("Rivera family"));
    expect(await form.findByText("Saved for the team.")).toBeTruthy();
  });
});

describe("Documents page", () => {
  it("uploads files, lists them with the assistant's artifacts, and opens an artifact in its chat", async () => {
    const { store, view, router } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;

    // A chat upload: the set is checked, and joins the project's documents.
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    fireEvent.change(await view.findByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
    await askForCheck(view);
    await view.findByText(/The check found 1 issue in 2 pages/);
    await waitFor(() => expect(store.documents.get(projectId)?.[0]).toMatchObject({ name: "428-el-rio.pdf", pageCount: 2 }));

    fireEvent.click(view.getByRole("link", { name: "El Rio ADU" }));
    const projectPage = within(await view.findByRole("region", { name: "Project" }));
    fireEvent.click(projectPage.getByRole("link", { name: "Documents" }));
    expect(router.current()).toEqual({ projectId, chatId: null, page: "documents" });
    expect(await view.findByRole("heading", { level: 1, name: "Documents" })).toBeTruthy();

    fireEvent.change(view.getByLabelText("Files to add to the project"), {
      target: { files: [new File(["Expansive clay; bearing 1,500 psf"], "soils-report.txt", { type: "text/plain" })] },
    });
    expect(await view.findByText("Added soils-report.txt")).toBeTruthy();

    const table = within(view.getByRole("table"));
    expect(table.getByRole("button", { name: "Open soils-report.txt" })).toBeTruthy();
    expect(table.getByRole("button", { name: "Open 428-el-rio.pdf" })).toBeTruthy();
    expect(table.getByRole("link", { name: "Open Issue report: 428 El Rio Rd, Danville" })).toBeTruthy();
    expect(table.getByText("Ahk in Chat 1")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "From the assistant 1" }));
    expect(within(view.getByRole("table")).queryByRole("button", { name: "Open soils-report.txt" })).toBeNull();

    const artifact = [...store.artifacts.values()][0]!;
    fireEvent.click(within(view.getByRole("table")).getByRole("link", { name: /Open Issue report/ }));
    expect(router.current()).toEqual({ projectId, chatId: artifact.chatId, artifactId: artifact.id });
    expect(await view.findByRole("heading", { level: 1, name: "Issue report: 428 El Rio Rd, Danville" })).toBeTruthy();
  });

  it("attaches project documents to a chat message", async () => {
    const { store, view } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    const soils = await store.addDocument(projectId, {
      file: new Blob(["Expansive clay"]),
      name: "Soils report.pdf",
      contentType: "application/pdf",
      uploadedBy: "Ahk",
      pages: [{ page: 1, text: "Expansive clay" }],
    });

    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    fireEvent.click(await view.findByRole("button", { name: "Attach project documents" }));
    fireEvent.click(within(view.getByRole("list", { name: "Project documents to attach" })).getByLabelText(/Soils report\.pdf/));
    expect(within(view.getByRole("list", { name: "Attached documents" })).getByText("Soils report.pdf")).toBeTruthy();

    const message = view.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "what bearing value should we use?" } });
    fireEvent.keyDown(message, { key: "Enter" });

    await waitFor(() => {
      const sent = [...store.messages.values()].flat().find((m) => m.text === "what bearing value should we use?");
      expect(sent?.sources).toEqual([{ id: `doc:${soils}`, name: "Soils report.pdf" }]);
    });
    // The message shows what it carried; the composer is empty again.
    expect(view.queryByRole("button", { name: "Remove Soils report.pdf" })).toBeNull();
  });

  it("attaches a document or an earlier artifact with @ in a new chat", async () => {
    const { store, view } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    // An artifact from an earlier chat, and an uploaded file.
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    fireEvent.change(await view.findByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
    await askForCheck(view);
    await view.findByText(/The check found 1 issue in 2 pages/);
    const report = [...store.artifacts.values()][0]!;
    await store.addDocument(projectId, {
      file: new Blob(["clay"]),
      name: "Soils report.pdf",
      contentType: "application/pdf",
      uploadedBy: "Ahk",
      pages: [{ page: 1, text: "clay" }],
    });

    // A new chat refers to both.
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    await view.findByRole("heading", { level: 1, name: "Chat 2" });
    const box = view.getByLabelText("Message") as HTMLTextAreaElement;
    const type = (value: string) => {
      fireEvent.change(box, { target: { value, selectionStart: value.length } });
    };
    type("compare @iss");
    const options = within(view.getByRole("listbox", { name: "Project documents" }));
    expect(options.getAllByRole("option").map((o) => o.textContent)).toEqual([`${report.title}Issue report, version 1`]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe(`compare @${report.title} `);

    type(`${box.value}with @soils`);
    fireEvent.mouseDown(within(view.getByRole("listbox", { name: "Project documents" })).getByRole("option", { name: /Soils report\.pdf/ }));
    expect(box.value).toBe(`compare @${report.title} with @Soils report.pdf `);
    expect(within(view.getByRole("list", { name: "Attached documents" })).getAllByRole("listitem")).toHaveLength(2);

    // Escape closes the list; Enter then sends.
    type(`${box.value}@`);
    expect(view.getByRole("listbox", { name: "Project documents" })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(view.queryByRole("listbox", { name: "Project documents" })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => {
      const sent = [...store.messages.values()].flat().find((m) => m.text.startsWith("compare"));
      expect(sent?.sources?.map((x) => x.name)).toEqual([report.title, "Soils report.pdf"]);
    });
  });
});

describe("deleting", () => {
  it("deletes a chat with its messages and artifacts, and keeps its files in the documents", async () => {
    const { store, view, router } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    fireEvent.click(view.getAllByRole("button", { name: "New chat" })[0]);
    fireEvent.change(await view.findByLabelText("Permit set PDF"), { target: { files: [pdfFile()] } });
    await askForCheck(view);
    await view.findByText(/The check found 1 issue in 2 pages/);
    await waitFor(() => expect(store.documents.get(projectId)).toHaveLength(1));

    fireEvent.click(view.getByRole("button", { name: "Chat options" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Delete chat" }));
    expect(view.getByText("Delete Chat 1?")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(store.chats.size).toBe(1);

    fireEvent.click(view.getByRole("button", { name: "Chat options" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Delete chat" }));
    fireEvent.click(view.getByRole("button", { name: "Delete chat" }));
    await waitFor(() => expect(router.current()).toEqual({ projectId, chatId: null }));
    expect(store.chats.size).toBe(0);
    expect(store.messages.size).toBe(0);
    expect(store.artifacts.size).toBe(0);
    expect(store.documents.get(projectId)).toHaveLength(1);
    expect(await view.findByRole("heading", { level: 1, name: "El Rio ADU" })).toBeTruthy();
  });

  it("deletes a project only after its name is typed", async () => {
    const { store, view, router } = mount();
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    await store.createChat(projectId, "Chat 1", AHK);
    await store.addDocument(projectId, { file: new Blob(["x"]), name: "survey.pdf", contentType: "application/pdf", uploadedBy: "Ahk", pages: [] });

    fireEvent.click(view.getByRole("button", { name: "Project options" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Delete project" }));
    const confirm = view.getByRole("button", { name: "Delete project" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(view.getByLabelText(/Type the project name/), { target: { value: "El Rio" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(view.getByLabelText(/Type the project name/), { target: { value: "El Rio ADU" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(store.projects.size).toBe(0));
    expect(store.chats.size).toBe(0);
    expect(store.documents.has(projectId)).toBe(false);
    expect(router.current()).toEqual({ projectId: null, chatId: null });
    expect(await view.findByText("No projects yet.", { exact: false })).toBeTruthy();
  });
});

/** After an upload the assistant asks what to do: this answers with /check, for the issue report. */
async function askForCheck(view: Pick<ReturnType<typeof render>, "findByText" | "getByRole" | "getByLabelText">) {
  await view.findByText(/What do you want to do with it\?/);
  await waitFor(() => expect((view.getByRole("button", { name: "Upload a permit set PDF" }) as HTMLButtonElement).disabled).toBe(false));
  const message = view.getByLabelText("Message");
  fireEvent.change(message, { target: { value: "/check" } });
  fireEvent.keyDown(message, { key: "Enter" });
}
