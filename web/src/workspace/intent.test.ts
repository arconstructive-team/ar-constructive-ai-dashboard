import { describe, expect, it } from "vitest";
import { applyChanges, hasChanges, readInstruction } from "./intent";

describe("readInstruction", () => {
  it("reads a request to regenerate the sheets", () => {
    expect(readInstruction("regenerate the sheets", null)).toMatchObject({ regenerate: true, changes: {} });
    expect(readInstruction("Please make the cover and general notes", null).regenerate).toBe(true);
    expect(readInstruction("what did you find?", null).regenerate).toBe(false);
  });

  it("reads a jurisdiction by its place name", () => {
    expect(readInstruction("check it as San Ramon", null).changes).toEqual({ jurisdiction: "City of San Ramon" });
    expect(readInstruction("this one is in contra costa", null).changes).toEqual({
      jurisdiction: "Unincorporated Contra Costa County",
    });
  });

  it("switches to the jurisdiction the set names when asked to fix the jurisdiction", () => {
    const instruction = readInstruction("fix the jurisdiction notes", "Town of Danville");
    expect(instruction.changes).toEqual({ jurisdiction: "Town of Danville" });
    expect(instruction.aboutSheets).toBe(true);
    expect(hasChanges(readInstruction("fix the jurisdiction notes", null))).toBe(false);
  });

  it("reads the ADU type and the address", () => {
    expect(readInstruction("it is a detached ADU", null).changes).toEqual({ aduType: "Detached ADU" });
    expect(readInstruction("the address is 12 Oak Ct, Orinda", null).changes).toMatchObject({
      address: "12 Oak Ct, Orinda",
      jurisdiction: "City of Orinda",
    });
  });
});

describe("applyChanges", () => {
  it("says only what changed", () => {
    const base = { address: "428 El Rio Rd", jurisdiction: "Town of Danville" as const, aduType: "No ADU" as const };
    expect(applyChanges(base, { jurisdiction: "Town of Danville" }).said).toEqual([]);
    const { project, said } = applyChanges(base, { jurisdiction: "City of San Ramon", aduType: "JADU" });
    expect(project.jurisdiction).toBe("City of San Ramon");
    expect(said).toEqual(["jurisdiction to City of San Ramon", "ADU type to JADU"]);
  });
});
