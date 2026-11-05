import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

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

  it("accepts a PDF and confirms the set", async () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText("Project address"), {
      target: { value: "428 El Rio Rd, Danville, CA" },
    });
    fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: "Town of Danville" } });
    fireEvent.change(screen.getByLabelText("ADU type"), { target: { value: "Attached ADU" } });

    const pdf = new File(["%PDF-1.7\n1 0 obj\n"], "428-el-rio-final.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput(container), { target: { files: [pdf] } });
    expect(await screen.findByText("428-el-rio-final.pdf")).toBeTruthy();

    startCheck();
    expect(screen.getByRole("heading", { name: "Set ready for checking" })).toBeTruthy();
    expect(screen.getByText("Town of Danville")).toBeTruthy();
    expect(screen.getByText("Attached ADU")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check another set" }));
    expect(screen.getByText("Drop the permit set here, or choose a file")).toBeTruthy();
  });
});
