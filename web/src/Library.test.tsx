import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Library } from "./Library";
import { CODE_LIBRARY, type CodeLibraryData } from "./lib/engine";

afterEach(cleanup);

describe("Code library page", () => {
  it("lists each pack with its edition and last-checked date", () => {
    render(<Library />);
    const packs = within(screen.getByRole("list", { name: "Code packs" })).getAllByRole("listitem");
    expect(packs).toHaveLength(CODE_LIBRARY.packs.length);
    const danville = packs.find((p) => p.textContent?.includes("Town of Danville"))!;
    expect(within(danville).getByText("Danville amendment (2025 cycle)")).toBeTruthy();
    expect(within(danville).getByText(CODE_LIBRARY.packs[1].last_checked)).toBeTruthy();
    const state = packs.find((p) => p.textContent?.includes("State of California"))!;
    expect(within(state).getByText("2025")).toBeTruthy();
  });

  it("lists every section by jurisdiction and code part, with an official source link", () => {
    render(<Library />);
    expect(screen.getByRole("heading", { level: 2, name: /State of California/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Town of Danville/ })).toBeTruthy();
    const crc = screen.getByRole("region", { name: "State of California: Title 24, Part 2.5" });
    expect(within(crc).getByText("CRC Section R314")).toBeTruthy();
    const link = within(crc).getByRole("link", { name: /Official source for CRC Section R314/ });
    expect(link.getAttribute("href")).toBe("https://codes.iccsafe.org/content/CARC2025P2");
    expect(screen.getByText(`${CODE_LIBRARY.sections.length} of ${CODE_LIBRARY.sections.length} sections`)).toBeTruthy();
    expect(screen.getByText("Danville Municipal Code Section 32-79")).toBeTruthy();
  });

  it("filters the sections, and shows an empty state with a way back", () => {
    render(<Library />);
    const filter = screen.getByLabelText("Find a section");
    fireEvent.change(filter, { target: { value: "smoke alarms" } });
    expect(screen.getByText("CRC Section R314")).toBeTruthy();
    expect(screen.queryByText("CRC Section R315")).toBeNull();

    fireEvent.change(filter, { target: { value: "no such code" } });
    expect(screen.getByText("No section matches “no such code”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(screen.getByText("CRC Section R315")).toBeTruthy();
  });

  it("shows the data problems when the library data is wrong", () => {
    const bad: CodeLibraryData = {
      ...CODE_LIBRARY,
      sections: [{ ...CODE_LIBRARY.sections[0], pack: "nowhere", text: "copied words" }],
    };
    render(<Library data={bad} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/data problems/);
    expect(alert.textContent).toMatch(/unknown pack nowhere/);
    expect(alert.textContent).toMatch(/only Energy Code text may be stored/);
  });

  it("says so when the library is empty", () => {
    render(<Library data={{ ...CODE_LIBRARY, sections: [] }} />);
    expect(screen.getByText("The code library has no sections yet.")).toBeTruthy();
  });
});
