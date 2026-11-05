import { describe, expect, it } from "vitest";
import {
  JURISDICTIONS,
  MAX_SET_BYTES,
  RULE_FAMILIES,
  checkSetFile,
  formatBytes,
  hasPdfHeader,
  validateProject,
} from "./project";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("validateProject", () => {
  it("accepts a complete project", () => {
    expect(
      validateProject({ address: "428 El Rio Rd, Danville", jurisdiction: "Town of Danville", aduType: "Attached ADU" }),
    ).toEqual({});
  });

  it("asks for the address and the jurisdiction when they are missing", () => {
    const errors = validateProject({ address: "  ", jurisdiction: "", aduType: "No ADU" });
    expect(errors.address).toMatch(/street address/);
    expect(errors.jurisdiction).toMatch(/jurisdiction/);
  });
});

describe("hasPdfHeader", () => {
  it("finds the PDF signature at the start", () => {
    expect(hasPdfHeader(bytes("%PDF-1.7\n%âãÏÓ"))).toBe(true);
  });

  it("finds the PDF signature after leading bytes", () => {
    expect(hasPdfHeader(bytes("\n\n  %PDF-1.4"))).toBe(true);
  });

  it("rejects files without the signature", () => {
    expect(hasPdfHeader(bytes("PK\u0003\u0004 a zip file"))).toBe(false);
    expect(hasPdfHeader(new Uint8Array())).toBe(false);
  });
});

describe("checkSetFile", () => {
  const pdf = bytes("%PDF-1.7");

  it("accepts a PDF under the size limit", () => {
    expect(checkSetFile({ size: 5_000_000 }, pdf)).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(checkSetFile({ size: 0 }, pdf)).toMatch(/empty/);
  });

  it("rejects a file over 200 MB", () => {
    expect(checkSetFile({ size: MAX_SET_BYTES + 1 }, pdf)).toMatch(/limit is 200 MB/);
  });

  it("rejects a file that is not a PDF", () => {
    expect(checkSetFile({ size: 100 }, bytes("AutoCAD drawing"))).toMatch(/not a PDF/);
  });
});

describe("formatBytes", () => {
  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(14.5 * 1024 * 1024)).toBe("14.5 MB");
  });
});

describe("spec data", () => {
  it("lists the 7 release-1 jurisdictions, Danville first", () => {
    expect(JURISDICTIONS).toHaveLength(7);
    expect(JURISDICTIONS[0]).toBe("Town of Danville");
  });

  it("lists the 8 rule families", () => {
    expect(RULE_FAMILIES.map((r) => r.code)).toEqual(["JB", "CD", "CY", "AR", "XR", "TB", "DT", "TP"]);
  });
});
