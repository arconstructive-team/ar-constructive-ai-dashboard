import { describe, expect, it } from "vitest";
import { isAllowedEmail, parseAllowedEmails } from "./access";

describe("parseAllowedEmails", () => {
  it("returns an empty list when nothing is set", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
  });

  it("splits, trims and lowercases the list", () => {
    expect(parseAllowedEmails(" A@Example.com, b@example.com ,,")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});

describe("isAllowedEmail", () => {
  const allowed = ["team@example.com"];

  it("allows a listed email in any case", () => {
    expect(isAllowedEmail("Team@Example.com", allowed)).toBe(true);
  });

  it("refuses an email that is not listed", () => {
    expect(isAllowedEmail("stranger@example.com", allowed)).toBe(false);
  });

  it("refuses a missing email", () => {
    expect(isAllowedEmail(null, allowed)).toBe(false);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
  });

  it("refuses everyone when the list is empty", () => {
    expect(isAllowedEmail("team@example.com", [])).toBe(false);
  });
});
