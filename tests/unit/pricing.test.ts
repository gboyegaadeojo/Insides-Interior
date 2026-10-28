import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { markupFromPrice, priceFromMarkup, projectProgress } from "~/domain/pricing";

describe("cost, markup and price (FR-CAT-02)", () => {
  it("price = cost × (1 + markup), rounded half up", () => {
    expect(priceFromMarkup(2000, 5000)).toBe(3000);
    expect(priceFromMarkup(4275, 3333)).toBe(5700);
    expect(priceFromMarkup(1, 5000)).toBe(2);
    expect(priceFromMarkup(0, 5000)).toBe(0);
  });

  it("markup = (price − cost) / cost, in basis points", () => {
    expect(markupFromPrice(2000, 3000)).toBe(5000);
    expect(markupFromPrice(3000, 3000)).toBe(0);
    expect(markupFromPrice(3000, 2000)).toBe(-3333);
  });

  it("has no markup without a cost", () => {
    expect(markupFromPrice(0, 3000)).toBeNull();
  });

  it("round-trips within a cent", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        (cost, markup) => {
          const price = priceFromMarkup(cost, markup);
          const back = markupFromPrice(cost, price)!;
          expect(Math.abs(priceFromMarkup(cost, back) - price)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("project progress (SPEC 6.8 Projects)", () => {
  it("splits the contract into paid, invoiced-unpaid and remaining", () => {
    expect(projectProgress({ contractCents: 10000, invoicedCents: 6000, paidCents: 2500 })).toEqual({
      paidPct: 25,
      invoicedUnpaidPct: 35,
      remainingPct: 40,
      remainingToBillCents: 4000,
    });
  });

  it("caps at 100% when invoicing runs over the contract", () => {
    const p = projectProgress({ contractCents: 10000, invoicedCents: 12000, paidCents: 12000 });
    expect(p.paidPct + p.invoicedUnpaidPct + p.remainingPct).toBe(100);
    expect(p.remainingToBillCents).toBe(0);
  });

  it("is all remaining with no contract yet", () => {
    expect(projectProgress({ contractCents: 0, invoicedCents: 0, paidCents: 0 })).toEqual({
      paidPct: 0,
      invoicedUnpaidPct: 0,
      remainingPct: 100,
      remainingToBillCents: 0,
    });
  });
});
