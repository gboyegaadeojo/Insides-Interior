import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCentsPlain,
  formatQuantity,
  parseMoneyToCents,
  parseQuantityToMilli,
} from "~/domain/money";

describe("parseMoneyToCents", () => {
  it.each([
    ["0", 0],
    ["42.75", 4275],
    ["42.7", 4270],
    ["42", 4200],
    [".5", 50],
    ["1,234.56", 123456],
    ["$1,234.56", 123456],
    [" 95 ", 9500],
    ["-12.30", -1230],
    ["1234567.89", 123456789],
  ])("%s → %d", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it("rounds a third decimal half up, without floating point", () => {
    expect(parseMoneyToCents("0.125")).toBe(13);
    expect(parseMoneyToCents("0.124")).toBe(12);
    expect(parseMoneyToCents("1.005")).toBe(101);
    expect(parseMoneyToCents("-1.005")).toBe(-101);
  });

  it.each(["", "abc", "1.2.3", "12,34,5.6x", "--1", "1-"])("rejects %j", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats en-CA CAD", () => {
    expect(formatCents(53467)).toBe("$534.67");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-1230)).toBe("-$12.30");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats plain values for editing", () => {
    expect(formatCentsPlain(4275)).toBe("42.75");
    expect(formatCentsPlain(-5)).toBe("-0.05");
    expect(formatCentsPlain(123456)).toBe("1,234.56");
  });

  it("round-trips through parse", () => {
    for (const cents of [0, 1, 99, 100, 4275, 19238, -1230, 99999999]) {
      expect(parseMoneyToCents(formatCents(cents))).toBe(cents);
    }
  });
});

describe("quantities (integer thousandths, SPEC 10.1)", () => {
  it.each([
    ["4.5", 4500],
    ["3", 3000],
    ["0.001", 1],
    ["1,000", 1000000],
    ["2.25", 2250],
  ])("%s → %d", (input, milli) => {
    expect(parseQuantityToMilli(input)).toBe(milli);
  });

  it("rejects more than three decimals and junk", () => {
    expect(parseQuantityToMilli("1.0001")).toBeNull();
    expect(parseQuantityToMilli("x")).toBeNull();
  });

  it("formats without trailing zeros", () => {
    expect(formatQuantity(4500)).toBe("4.5");
    expect(formatQuantity(3000)).toBe("3");
    expect(formatQuantity(1)).toBe("0.001");
    expect(formatQuantity(1234500)).toBe("1,234.5");
  });
});
