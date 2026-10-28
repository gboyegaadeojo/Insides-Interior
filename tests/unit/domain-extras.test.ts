import { describe, expect, it } from "vitest";
import { canInvoice, canQuote, isEditableDraft } from "~/domain/lifecycle";
import { applyBp, formatBp, roundHalfUpDiv } from "~/domain/money";
import { depositDue } from "~/domain/tax";

describe("lifecycle helpers", () => {
  it("answer whether a move is allowed without throwing", () => {
    expect(canQuote("viewed", "approve")).toBe(true);
    expect(canQuote("draft", "approve")).toBe(false);
    expect(canInvoice("overdue", "full_payment")).toBe(true);
    expect(canInvoice("paid", "void")).toBe(false);
  });

  it("only drafts are editable in place", () => {
    expect(isEditableDraft("draft")).toBe(true);
    expect(isEditableDraft("sent")).toBe(false);
    expect(isEditableDraft("paid")).toBe(false);
  });
});

describe("money helpers", () => {
  it("formats basis points as percentages", () => {
    expect(formatBp(500)).toBe("5");
    expect(formatBp(750)).toBe("7.5");
    expect(formatBp(1234)).toBe("12.34");
    expect(formatBp(5)).toBe("0.05");
    expect(formatBp(-250)).toBe("-2.5");
  });

  it("applies basis points with half-up rounding", () => {
    expect(applyBp(47738, 500)).toBe(2387);
    expect(applyBp(23869, 700)).toBe(1671);
  });

  it("refuses non-integers and zero denominators", () => {
    expect(() => roundHalfUpDiv(1.5, 2)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1, 0)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(Number.MAX_SAFE_INTEGER + 2, 3)).toThrow(RangeError);
  });

  it("handles negative denominators", () => {
    expect(roundHalfUpDiv(5, -2)).toBe(-3);
    expect(roundHalfUpDiv(-5, -2)).toBe(3);
  });
});

describe("deposit due (SPEC 6.8 totals card)", () => {
  it("splits a total into deposit and balance", () => {
    expect(depositDue(53467, { type: "percent", bp: 5000 })).toEqual({
      depositCents: 26734,
      balanceCents: 26733,
    });
    expect(depositDue(53467, { type: "amount", cents: 10000 })).toEqual({
      depositCents: 10000,
      balanceCents: 43467,
    });
    expect(depositDue(53467, undefined)).toEqual({ depositCents: 0, balanceCents: 53467 });
    expect(depositDue(1000, { type: "amount", cents: 5000 })).toEqual({
      depositCents: 1000,
      balanceCents: 0,
    });
  });
});
