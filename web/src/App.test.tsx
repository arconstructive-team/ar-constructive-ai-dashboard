import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";
import type { CheckSet } from "./lib/check";
import type { EngineResult } from "./lib/engine";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("#set-file");
  if (!input) throw new Error("No file input on the screen.");
  return input;
}

function startCheck() {
  fireEvent.click(screen.getByRole("button", { name: "Start the check" }));
}

describe("Check a permit set screen", () => {
  it("shows the empty state first", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Check a permit set before you submit it" })).toBeTruthy();
    expect(screen.getByText("Drop the permit set here, or choose a file")).toBeTruthy();
  });

  it("says what is missing when the form is sent empty", () => {
    render(<App />);
    startCheck();
    expect(screen.getByText(/Enter the project street address/)).toBeTruthy();
    expect(screen.getByText("Choose the jurisdiction that reviews this permit.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Choose the permit set PDF first.");
  });

  it("rejects a file that is not a PDF", async () => {
    const { container } = render(<App />);
    const notPdf = new File(["AutoCAD drawing data"], "plans.dwg", { type: "application/octet-stream" });
    fireEvent.change(fileInput(container), { target: { files: [notPdf] } });
    expect((await screen.findByRole("alert")).textContent).toContain("This file is not a PDF.");
  });

  it("uploads a PDF and shows the issues grouped by sheet, with a CSV download", async () => {
    const checkSet = vi.fn<CheckSet>(async () => FAKE_RESULT);
    const { container } = render(<App checkSet={checkSet} />);
    await fillAndUpload(container);

    startCheck();
    expect(await screen.findByRole("heading", { name: "3 issues found" })).toBeTruthy();
    expect(checkSet).toHaveBeenCalledTimes(1);
    expect(checkSet.mock.calls[0][1].jurisdiction).toBe("Town of Danville");

    // Grouped by sheet: one section per sheet, in page order.
    const sheetHeadings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(sheetHeadings[0]).toContain("A-0.2");
    expect(sheetHeadings[1]).toContain("A-2.3");
    const a02 = screen.getByRole("region", { name: /A-0\.2/ });
    expect(within(a02).getByText("High")).toBeTruthy();
    expect(within(a02).getByText("JB-001")).toBeTruthy();
    expect(within(a02).getByText(/CITY OF LAFAYETTE BUILDING DIVISION/)).toBeTruthy();
    expect(within(a02).getByText(/Replace the Lafayette notes/)).toBeTruthy();

    // Each finding lists its code sections with a link to the official source.
    const sections = within(a02).getByRole("list", { name: "Code sections" });
    expect(within(sections).getByText("CRC Section R106.1.1")).toBeTruthy();
    const link = within(sections).getByRole("link", { name: /Official source for CRC Section R106\.1\.1/ });
    expect(link.getAttribute("href")).toBe("https://codes.iccsafe.org/content/CARC2025P2");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(within(sections).getByRole("link", { name: /Danville Municipal Code/ }).getAttribute("href")).toMatch(
      /^https:\/\/codelibrary\.amlegal\.com\//,
    );
    // No jurisdiction warning when the set names the selected jurisdiction.
    expect(screen.queryByText(/but you checked it as/)).toBeNull();
    const a23 = screen.getByRole("region", { name: /A-2\.3/ });
    expect(within(a23).getByText("Medium")).toBeTruthy();
    expect(within(a23).getByText("Low")).toBeTruthy();

    // Summary count by rule family.
    expect(screen.getByTestId("count-JB").textContent).toBe("1");
    expect(screen.getByTestId("count-AR").textContent).toBe("2");
    expect(screen.getByTestId("count-TP").textContent).toBe("0");

    // Missing sheets.
    expect(screen.getByText("A-1.2")).toBeTruthy();

    // CSV download holds every finding.
    const csv = screen.getByRole("link", { name: "Download CSV" });
    expect(csv.getAttribute("download")).toBe("428-el-rio-final-issues.csv");
    const body = decodeURIComponent((csv.getAttribute("href") ?? "").replace(/^data:text\/csv;charset=utf-8,/, ""));
    expect(body.split("\n")[0]).toContain("rule_id");
    expect(body).toContain("JB-001");
    expect(body).toContain("AR-002");

    fireEvent.click(screen.getByRole("button", { name: "Check another set" }));
    expect(screen.getByText("Drop the permit set here, or choose a file")).toBeTruthy();
  });

  it("warns when the set names another jurisdiction, and checks it again as that one", async () => {
    const mismatch: EngineResult = {
      ...FAKE_RESULT,
      pack: "california-2025-base",
      pack_name: "City of Walnut Creek, 2025 California codes (base pack)",
      jurisdiction: {
        selected: "City of Walnut Creek",
        detected: "Town of Danville",
        evidence: "PROJECT ADDRESS: 428 EL RIO RD, DANVILLE, 94526",
        sheet: "A-0.1",
        page: 1,
        matches: false,
      },
    };
    const checkSet = vi.fn<CheckSet>(async (_file, project) =>
      project.jurisdiction === "Town of Danville" ? FAKE_RESULT : mismatch,
    );
    const { container } = render(<App checkSet={checkSet} />);
    await fillAndUpload(container, "City of Walnut Creek");
    startCheck();

    const warning = await screen.findByText("This set is for Town of Danville, but you checked it as City of Walnut Creek.");
    expect(warning).toBeTruthy();
    expect(screen.getByText(/PROJECT ADDRESS: 428 EL RIO RD, DANVILLE, 94526/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check again as Town of Danville" }));
    expect(await screen.findByRole("heading", { name: "3 issues found" })).toBeTruthy();
    expect(checkSet).toHaveBeenCalledTimes(2);
    expect(checkSet.mock.calls[1][1].jurisdiction).toBe("Town of Danville");
    expect(screen.queryByText(/but you checked it as/)).toBeNull();
  });

  it("opens the code library from the header", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Code library" }));
    expect(screen.getByRole("heading", { level: 1, name: "Code library" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Code library" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("link", { name: "New check" }));
    expect(screen.getByRole("heading", { level: 1, name: "Check a permit set before you submit it" })).toBeTruthy();
  });

  it("says what happened when the check fails", async () => {
    const checkSet = vi.fn<CheckSet>(async () => {
      throw new Error("This file is larger than 200 MB.");
    });
    const { container } = render(<App checkSet={checkSet} />);
    await fillAndUpload(container);
    startCheck();
    expect(await screen.findByRole("heading", { name: "The check did not finish" })).toBeTruthy();
    expect(screen.getByText("This file is larger than 200 MB.")).toBeTruthy();
  });
});

async function fillAndUpload(container: HTMLElement, jurisdiction = "Town of Danville") {
  fireEvent.change(screen.getByLabelText("Project address"), {
    target: { value: "428 El Rio Rd, Danville, CA" },
  });
  fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: jurisdiction } });
  fireEvent.change(screen.getByLabelText("ADU type"), { target: { value: "Attached ADU" } });
  const pdf = new File(["%PDF-1.7\n1 0 obj\n"], "428-el-rio-final.pdf", { type: "application/pdf" });
  fireEvent.change(fileInput(container), { target: { files: [pdf] } });
  expect(await screen.findByText("428-el-rio-final.pdf")).toBeTruthy();
}

const FAKE_RESULT: EngineResult = {
  pack: "danville-2025",
  pack_name: "Town of Danville · 2025 codes",
  code_cycle: 2025,
  pages: [
    { page: 2, sheet: "A-0.2", label: "A-0.2", kind: "architectural", title: "Abbreviation & General Note", date: "2026-05-18", address: "428 EL RIO", method: "title-block" },
    { page: 9, sheet: "A-2.3", label: "A-2.3", kind: "architectural", title: "(N) First Floor Plan", date: "2026-05-18", address: "428 EL RIO", method: "title-block" },
  ],
  sheet_index: ["A-0.2", "A-2.3", "A-1.2"],
  findings: [
    {
      rule_id: "JB-001",
      family: "JB",
      severity: "high",
      title: "Notes name another jurisdiction",
      subject: "City of Lafayette",
      sheets: ["A-0.2"],
      pages: [2],
      evidence: "CITY OF LAFAYETTE BUILDING DIVISION",
      suggested_fix: "Replace the Lafayette notes with the Town of Danville notes.",
      citations: [
        {
          id: "CRC-R106.1.1",
          label: "CRC Section R106.1.1",
          title: "Information on construction documents",
          source_url: "https://codes.iccsafe.org/content/CARC2025P2",
          edition: "2025",
        },
        {
          id: "DMC",
          label: "Danville Municipal Code",
          title: "Danville Municipal Code",
          source_url: "https://codelibrary.amlegal.com/codes/danvilleca/latest/danville_ca/",
          edition: "Danville amendment (2025 cycle)",
        },
      ],
    },
    {
      rule_id: "AR-001",
      family: "AR",
      severity: "medium",
      title: "Floor area does not match the cover",
      subject: "1st floor area",
      sheets: ["A-2.3", "A-0.1"],
      pages: [9, 1],
      evidence: "1ST FLOOR: 1,708 ± S.F.",
      suggested_fix: "Use one area on every sheet.",
    },
    {
      rule_id: "AR-002",
      family: "AR",
      severity: "low",
      title: "Area label rounding",
      subject: "ADU area",
      sheets: ["A-2.3"],
      pages: [9],
      evidence: "ADU (ATTACHED): 418 ± S.F.",
      suggested_fix: "Round areas the same way on every sheet.",
    },
  ],
  missing: [{ item: "A-1.2", reason: "The sheet index lists it, but no page has it.", cited_on: ["A-0.1"] }],
  counts: { JB: 1, CD: 0, CY: 0, AR: 2, XR: 0, TB: 0, DT: 0, TP: 0 },
};
