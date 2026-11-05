import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ArtifactPane, type Exporters } from "./ArtifactPane";
import { MemoryArtifactSource, chunkText } from "./memorySource";
import { SAMPLE_REPORT_MD, sampleArtifact } from "./fixtures";

// The real editor is Tiptap; its round trip has its own tests. Here a text area stands in.
vi.mock("./ArtifactEditor", () => ({
  default: (props: { initialMarkdown: string; onChange: (md: string) => void; locked: boolean; header: ReactNode }) => (
    <div>
      {props.header}
      <textarea
        aria-label="Artifact text"
        defaultValue={props.initialMarkdown}
        disabled={props.locked}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  ),
}));

afterEach(cleanup);

const sample = sampleArtifact();
const ref = { projectId: sample.projectId, artifactId: sample.id };
const TITLE = sample.title;

function setup(options: { exporters?: Exporters; download?: (file: Blob, name: string) => void } = {}) {
  const source = new MemoryArtifactSource(() => new Date("2026-11-06T10:00:00Z"));
  const view = () =>
    render(
      <ArtifactPane
        source={source}
        projectId={ref.projectId}
        artifactId={ref.artifactId}
        projectName="Sample project"
        editorName="Dana Lee"
        exporters={options.exporters}
        download={options.download}
      />,
    );
  return { source, view };
}

describe("Artifact pane", () => {
  it("shows the artifact as a document: title, chips, headings, code chips and tables", () => {
    const { source, view } = setup();
    source.put(sample);
    const { container } = view();

    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([TITLE]);
    expect(screen.getByText("@arconstructive")).toBeTruthy();
    expect(screen.getByText("Nov 5, 2026")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Findings" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Suggested fix" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(Array.from(container.querySelectorAll(".artifact-doc code")).map((c) => c.textContent)).toContain("high");
    expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty("disabled", false);
  });

  it("says when the artifact is missing", () => {
    const { view } = setup();
    view();
    expect(screen.getByRole("alert").textContent).toMatch(/deleted, or you no longer have access/);
  });

  it("updates live while the artifact generates, with Edit and Export locked", () => {
    const { source, view } = setup();
    source.put(sampleArtifact({ status: "generating", content: "", version: 0 }));
    view();

    expect(screen.getByRole("status").textContent).toMatch(/Writing the first section/);
    expect(screen.getByText("Generating")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Export" })).toHaveProperty("disabled", true);

    const chunks = chunkText(SAMPLE_REPORT_MD, 24);
    let sawPartialTable = false;
    let lastLength = 0;
    for (const chunk of chunks) {
      act(() => source.append(ref, chunk));
      const length = screen.getByTestId("artifact-scroll").textContent?.length ?? 0;
      expect(length).toBeGreaterThanOrEqual(lastLength - 40);
      lastLength = length;
      const status = screen.getByRole("status").textContent ?? "";
      if (screen.queryByRole("table") && /Writing “Findings”/.test(status)) sawPartialTable = true;
    }
    expect(sawPartialTable).toBe(true);
    expect(screen.getByText(/Replace the notes with the Town of Danville notes/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Writing “Method”/);

    act(() => source.finishGeneration(ref));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Generating")).toBeNull();
    expect(screen.getByText("Version 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty("disabled", false);
  });

  it("follows new text, and stops following when the reader scrolls up", () => {
    const { source, view } = setup();
    source.put(sampleArtifact({ status: "generating", content: "## Summary\n\n", version: 0 }));
    view();

    const scroller = screen.getByTestId("artifact-scroll");
    let top = 0;
    let height = 2000;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 500 });

    act(() => source.append(ref, "First line. "));
    expect(top).toBe(2000);

    top = 100;
    fireEvent.scroll(scroller);
    height = 3000;
    act(() => source.append(ref, "Second line. "));
    expect(top).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(top).toBe(3000);
    height = 3400;
    act(() => source.append(ref, "Third line."));
    expect(top).toBe(3400);
  });

  it("saves an edit as a new version with the editor's name", async () => {
    const { source, view } = setup();
    source.put(sample);
    view();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const text = (await screen.findByRole("textbox", { name: "Artifact text" })) as HTMLTextAreaElement;
    expect(text.value.startsWith("## Summary")).toBe(true);
    expect(screen.getByRole("button", { name: "Save version" })).toHaveProperty("disabled", true);

    fireEvent.change(text, { target: { value: "## Summary\n\nWe fixed the notes.\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    expect(await screen.findByText("Saved version 2.")).toBeTruthy();
    const saved = source.get(ref);
    expect(saved).toMatchObject({ version: 2, updatedBy: "Dana Lee", title: TITLE });
    expect(saved?.content).toBe(`# ${TITLE}\n\n## Summary\n\nWe fixed the notes.\n`);
    expect((await source.listVersions(ref)).map((v) => [v.version, v.updatedBy])).toEqual([
      [2, "Dana Lee"],
      [1, "arconstructive"],
    ]);
    expect(screen.getByText("We fixed the notes.")).toBeTruthy();
    expect(screen.getByText("@Dana Lee")).toBeTruthy();
  });

  it("locks the editor when a new generation starts", async () => {
    const { source, view } = setup();
    source.put(sample);
    view();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const text = await screen.findByRole("textbox", { name: "Artifact text" });
    act(() => source.update(ref, { status: "generating" }));
    expect(text).toHaveProperty("disabled", true);
    expect(screen.getByText(/Editing is locked until it finishes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save version" })).toHaveProperty("disabled", true);
  });

  it("shows an earlier version and restores it", async () => {
    const { source, view } = setup();
    const v1 = { version: 1, title: TITLE, content: SAMPLE_REPORT_MD, updatedBy: "arconstructive", updatedAt: sample.updatedAt };
    const v2 = { version: 2, title: TITLE, content: `# ${TITLE}\n\nShort text.\n`, updatedBy: "Sam", updatedAt: new Date("2026-11-06T09:00:00Z") };
    source.put({ ...sample, ...v2 }, [v1, v2]);
    view();
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `Versions of ${TITLE}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Version 1/ }));

    expect(screen.getByText(/You are viewing version 1, saved by arconstructive/)).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    expect(await screen.findByText("Restored version 1 as version 3.")).toBeTruthy();
    expect(source.get(ref)).toMatchObject({ version: 3, content: SAMPLE_REPORT_MD, updatedBy: "Dana Lee" });
    expect((await source.listVersions(ref))[0]).toMatchObject({ version: 3, restoredFrom: 1 });
    expect(screen.queryByText(/You are viewing version/)).toBeNull();
  });

  it("exports PDF and Word with the project name and a file name", async () => {
    const exporters = {
      pdf: vi.fn(async () => new Blob(["pdf"])),
      docx: vi.fn(async () => new Blob(["docx"])),
    };
    const download = vi.fn();
    const { source, view } = setup({ exporters, download });
    source.put(sample);
    view();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export as PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/v1\.pdf$/)));
    const [blocks, meta] = exporters.pdf.mock.calls[0] as unknown as [Array<{ type: string }>, Record<string, unknown>];
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(meta).toMatchObject({ title: TITLE, projectName: "Sample project", author: "arconstructive", version: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export as Word \(\.docx\)/ }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/v1\.docx$/)));
  });

  it("says so when an export fails", async () => {
    const exporters = {
      pdf: vi.fn(async (): Promise<Blob> => {
        throw new Error("boom");
      }),
      docx: vi.fn(async () => new Blob(["docx"])),
    };
    const { source, view } = setup({ exporters, download: vi.fn() });
    source.put(sample);
    view();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export as PDF/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not make the PDF file/);
  });
});
