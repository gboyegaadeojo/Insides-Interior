import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  balanceCents,
  checkPayment,
  deriveInvoiceStatus,
  percentPaid,
  settledCents,
  suggestedWhtCents,
} from "~/domain/invoice";

describe("balance (SPEC 8.3)", () => {
  const input = {
    totalCents: 6_097_528,
    payments: [
      { amountCents: 3_000_000, whtCents: 0 },
      { amountCents: 2_000_000, whtCents: 283_605 },
      { amountCents: 999_999, whtCents: 0, deleted: true },
    ],
    creditsAppliedCents: 100,
  };

  it("counts cash, WHT and applied credit, and ignores deleted payments", () => {
    expect(settledCents(input)).toBe(5_283_705);
    expect(balanceCents(input)).toBe(813_823);
    expect(settledCents({ totalCents: 1, payments: [] })).toBe(0);
  });

  it("reports percent paid for the progress ring", () => {
    expect(percentPaid(1000, 333)).toBe(33);
    expect(percentPaid(1000, 1500)).toBe(100);
    expect(percentPaid(1000, -5)).toBe(0);
    expect(percentPaid(0, 0)).toBe(100);
  });
});

describe("derived status (FR-INV-07, SPEC 5.13)", () => {
  const base = { totalCents: 1000, settledCents: 0, viewed: false, pastDue: false, openRequest: false };

  it("follows the money", () => {
    expect(deriveInvoiceStatus(base)).toBe("sent");
    expect(deriveInvoiceStatus({ ...base, viewed: true })).toBe("viewed");
    expect(deriveInvoiceStatus({ ...base, settledCents: 1 })).toBe("partially_paid");
    expect(deriveInvoiceStatus({ ...base, settledCents: 1000 })).toBe("paid");
  });

  it("keeps an open request and a past due date until paid", () => {
    expect(deriveInvoiceStatus({ ...base, settledCents: 500, openRequest: true })).toBe("changes_requested");
    expect(deriveInvoiceStatus({ ...base, settledCents: 500, pastDue: true })).toBe("overdue");
    expect(deriveInvoiceStatus({ ...base, settledCents: 1000, pastDue: true, openRequest: true })).toBe(
      "paid",
    );
  });
});

describe("recording a payment (FR-PAY-01, 02, 06)", () => {
  it("applies cash and WHT up to the balance", () => {
    expect(checkPayment({ balanceCents: 1000, cashCents: 900, whtCents: 100, allowCredit: false })).toEqual({
      ok: true,
      appliedCents: 900,
      creditCents: 0,
    });
  });

  it("refuses an overpayment unless it becomes client credit", () => {
    expect(checkPayment({ balanceCents: 1000, cashCents: 1200, whtCents: 0, allowCredit: false })).toEqual({
      ok: false,
      reason: "overpayment",
      excessCents: 200,
    });
    expect(checkPayment({ balanceCents: 1000, cashCents: 1200, whtCents: 50, allowCredit: true })).toEqual({
      ok: true,
      appliedCents: 950,
      creditCents: 250,
    });
  });

  it("refuses nothing, negatives, a settled invoice and WHT above the balance", () => {
    const ok = { balanceCents: 1000, cashCents: 1, whtCents: 0, allowCredit: true };
    expect(checkPayment({ ...ok, cashCents: 0 })).toMatchObject({ reason: "not_positive" });
    expect(checkPayment({ ...ok, cashCents: -1, whtCents: 5 })).toMatchObject({ reason: "not_positive" });
    expect(checkPayment({ ...ok, balanceCents: 0 })).toMatchObject({ reason: "nothing_due" });
    expect(checkPayment({ ...ok, whtCents: 1001 })).toMatchObject({ reason: "wht_too_large" });
  });

  it("never applies more than the balance (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 ** 12 }),
        fc.integer({ min: 0, max: 10 ** 12 }),
        fc.integer({ min: 0, max: 10 ** 12 }),
        (balance, cash, wht) => {
          const result = checkPayment({
            balanceCents: balance,
            cashCents: cash,
            whtCents: wht,
            allowCredit: true,
          });
          if (result.ok) {
            expect(result.appliedCents + wht).toBeLessThanOrEqual(balance);
            expect(result.appliedCents + result.creditCents).toBe(cash);
          }
        },
      ),
    );
  });
});

describe("suggested WHT (FR-PAY-06)", () => {
  it("is worked on the pre-VAT share of what's being settled", () => {
    // F2: ₦60,975.28 total, VAT ₦4,254.09; 5% WHT on ₦56,721.19 = ₦2,836.06.
    expect(
      suggestedWhtCents({ totalCents: 6_097_528, taxCents: 425_409, settleCents: 6_097_528, rateBp: 500 }),
    ).toBe(283_606);
    // Half the invoice: half the pre-VAT amount.
    expect(
      suggestedWhtCents({ totalCents: 6_097_528, taxCents: 425_409, settleCents: 3_048_764, rateBp: 1000 }),
    ).toBe(283_606);
    expect(suggestedWhtCents({ totalCents: 0, taxCents: 0, settleCents: 5, rateBp: 500 })).toBe(0);
    expect(suggestedWhtCents({ totalCents: 5, taxCents: 0, settleCents: 0, rateBp: 500 })).toBe(0);
  });

  it("handles invoices too large for float multiplication", () => {
    const total = 9_000_000_000_000;
    expect(suggestedWhtCents({ totalCents: total, taxCents: 0, settleCents: total, rateBp: 500 })).toBe(
      450_000_000_000,
    );
  });
});
