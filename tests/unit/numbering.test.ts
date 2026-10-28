import { describe, expect, it } from "vitest";
import { formatDocumentNumber, pdfFileName, validateNextNumber, validatePrefix } from "~/domain/numbering";
import { newId } from "~/lib/ids";

describe("numbering (SPEC 10.3, FR-SET-04)", () => {
  it("formats numbers with their prefix", () => {
    expect(formatDocumentNumber("Q-", 1001)).toBe("Q-1001");
    expect(formatDocumentNumber("INV-", 1042)).toBe("INV-1042");
  });

  it("names PDFs per SPEC 10.4", () => {
    expect(pdfFileName("INV-1042")).toBe("Insides-Interior-INV-1042.pdf");
    expect(pdfFileName("INV-1042", 2)).toBe("Insides-Interior-INV-1042-rev2.pdf");
  });

  it("only lets the next number increase", () => {
    expect(validateNextNumber(1001, 1001)).toBeNull();
    expect(validateNextNumber(1001, 2000)).toBeNull();
    expect(validateNextNumber(1001, 1000)).toMatch(/only go up/);
    expect(validateNextNumber(1001, 0)).toMatch(/whole number/);
    expect(validateNextNumber(1001, 1.5)).toMatch(/whole number/);
  });

  it("validates prefixes", () => {
    expect(validatePrefix("INV-")).toBeNull();
    expect(validatePrefix("")).toBeNull();
    expect(validatePrefix("Q 1")).toMatch(/letters/);
    expect(validatePrefix("ABCDEFGHIJKLM")).toMatch(/12/);
  });
});

describe("ids (SPEC 8.1)", () => {
  it("are prefixed ULIDs, unique and time-sortable", () => {
    const a = newId("cli");
    const b = newId("cli");
    expect(a).toMatch(/^cli_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
    expect([b, a].sort()).toEqual([a, b].sort());
  });
});
