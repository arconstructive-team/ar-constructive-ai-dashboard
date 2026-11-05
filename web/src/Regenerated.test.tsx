import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Results } from "./Results";
import type { RenderPage } from "./Regenerated";
import type { CheckResult, Finding, RegeneratedSheet } from "./lib/engine";

afterEach(cleanup);

const finding = (rule_id: string, family: Finding["family"], sheet: string, page: number, title: string): Finding => ({
  rule_id,
  family,
  severity: "high",
  title,
  subject: title,
  sheets: [sheet],
  pages: [page],
  evidence: `${sheet} evidence`,
  suggested_fix: "Fix it.",
});

const sheet = (id: string, page: number | null, heading: string, line: string): RegeneratedSheet => ({
  sheet: id,
  title: id === "A-0.1" ? "COVER SHEET" : "FIRE NOTES",
  original_page: page,
  date: "05/18/2026",
  job: "22-1955",
  address: ["428 EL RIO RD,", "DANVILLE, CA 94526"],
  title_block: ["SHEET NO.", id, "05/18/2026", "22-1955", "428 EL RIO RD,", "DANVILLE, CA 94526"],
  sections: [{ heading, lines: [line] }],
  text: `${heading}\n${line}`,
});

const RESULT: CheckResult = {
  pack: "danville-2025",
  pack_name: "Town of Danville, 2025 California codes",
  code_cycle: 2025,
  pages: [
    { page: 1, sheet: "A-0.1", label: "A-0.1", kind: "architectural", title: "COVER SHEET", date: "2026-05-18", address: "428 EL RIO", method: "title-block" },
    { page: 20, sheet: "A-5.3", label: "A-5.3", kind: "architectural", title: "FIRE NOTES", date: "2026-05-18", address: "428 EL RIO", method: "title-block" },
  ],
  sheet_index: ["A-0.1", "A-5.3"],
  findings: [
    finding("AR-002", "AR", "A-0.1", 1, "Garage area does not match"),
    finding("JB-002", "JB", "A-5.3", 20, "Fire agency from another jurisdiction: Sonoma Valley Fire"),
    finding("CY-001", "CY", "A-5.3", 20, "Citations from an older code cycle (2016)"),
  ],
  missing: [],
  counts: { JB: 1, CD: 0, CY: 1, AR: 1, XR: 0, TB: 0, DT: 0, TP: 0 },
  regenerated: {
    pack: "danville-2025",
    pack_name: "Town of Danville, 2025 California codes",
    code_cycle: 2025,
    address: "428 EL RIO RD, DANVILLE, CA 94526",
    sheets: [
      sheet("A-0.1", 1, "APPLICABLE CODES", "2025 CALIFORNIA BUILDING CODE (CBC)"),
      sheet("A-5.3", 20, "GENERAL NOTE (2) - FIRE", "SAN RAMON VALLEY FIRE PROTECTION DISTRICT (SRVFPD)"),
    ],
    to_confirm: ["The cover does not state the assessor parcel number. Fill it in on A-0.1."],
    findings: [finding("AR-002", "AR", "A-0.1", 1, "Garage area does not match")],
  },
};

const pdfFile = () => new File(["%PDF-1.7\n"], "428-el-rio-final.pdf", { type: "application/pdf" });

describe("Regenerated sheets view", () => {
  it("shows the original and the regenerated sheet side by side, with a PDF download", async () => {
    const renderPage = vi.fn<RenderPage>(async () => undefined);
    const file = pdfFile();
    render(<Results result={RESULT} file={file} fileName={file.name} onReset={() => {}} renderPage={renderPage} />);

    expect(screen.getByRole("heading", { level: 3, name: "Regenerated sheets" })).toBeTruthy();

    const original = screen.getByRole("region", { name: "Original A-0.1" });
    const regenerated = screen.getByRole("region", { name: "Regenerated A-0.1" });
    expect(within(original).getByText(/page 1/)).toBeTruthy();
    expect(within(regenerated).getByText("APPLICABLE CODES")).toBeTruthy();
    expect(within(regenerated).getByText("2025 CALIFORNIA BUILDING CODE (CBC)")).toBeTruthy();
    // The area finding is still on the regenerated cover.
    expect(within(regenerated).getByText("Still to check")).toBeTruthy();
    expect(within(regenerated).getByText("AR-002")).toBeTruthy();

    // The original page is drawn from the uploaded file.
    await waitFor(() => expect(renderPage).toHaveBeenCalledWith(file, 1, expect.any(HTMLCanvasElement)));
    expect(await within(original).findByLabelText("Original sheet A-0.1, page 1")).toBeTruthy();

    const download = screen.getByRole("link", { name: "Download regenerated sheets (PDF)" });
    expect(download.getAttribute("download")).toBe("428-el-rio-final-regenerated.pdf");
    const href = download.getAttribute("href") ?? "";
    expect(href.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(atob(href.slice("data:application/pdf;base64,".length)).startsWith("%PDF-1.4")).toBe(true);
  });

  it("switches sheets and lists the issues the regenerated sheet fixes", async () => {
    const renderPage = vi.fn<RenderPage>(async () => undefined);
    render(<Results result={RESULT} file={pdfFile()} fileName="set.pdf" onReset={() => {}} renderPage={renderPage} />);

    fireEvent.click(screen.getByRole("button", { name: "A-5.3" }));
    expect(screen.getByRole("button", { name: "A-5.3" }).getAttribute("aria-pressed")).toBe("true");
    const regenerated = screen.getByRole("region", { name: "Regenerated A-5.3" });
    expect(within(regenerated).getByText("Fixed in the regenerated sheet")).toBeTruthy();
    expect(within(regenerated).getByText("JB-002")).toBeTruthy();
    expect(within(regenerated).getByText("CY-001")).toBeTruthy();
    expect(within(regenerated).getByText("The check finds no issues on the regenerated sheet.")).toBeTruthy();
    await waitFor(() => expect(renderPage).toHaveBeenCalledWith(expect.any(File), 20, expect.any(HTMLCanvasElement)));
  });

  it("says so when the original page cannot be drawn", async () => {
    const renderPage = vi.fn<RenderPage>(async () => {
      throw new Error("bad page");
    });
    render(<Results result={RESULT} file={pdfFile()} fileName="set.pdf" onReset={() => {}} renderPage={renderPage} />);
    const original = screen.getByRole("region", { name: "Original A-0.1" });
    expect((await within(original).findByRole("alert")).textContent).toContain("could not draw page 1");
  });

  it("shows a loading state while the original page is drawn", () => {
    const renderPage = vi.fn<RenderPage>(() => new Promise<void>(() => {}));
    render(<Results result={RESULT} file={pdfFile()} fileName="set.pdf" onReset={() => {}} renderPage={renderPage} />);
    expect(screen.getByRole("status", { name: "Loading page 1" })).toBeTruthy();
  });

  it("shows an empty state when no sheets were regenerated", () => {
    render(<Results result={{ ...RESULT, regenerated: null }} fileName="set.pdf" onReset={() => {}} />);
    expect(screen.getByText(/No sheets were regenerated/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download regenerated sheets (PDF)" })).toBeNull();
  });
});
