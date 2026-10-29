import { describe, expect, it } from "vitest";
import {
  ageBalances,
  agingBucket,
  cashShare,
  daysBetween,
  expenseNetCents,
  matchPreset,
  monthKeys,
  presetRange,
  rechargeCents,
  trailingMonths,
} from "~/domain/reports";

describe("ageing (FR-RPT-02)", () => {
  it("counts calendar days across months and years", () => {
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-05-10", "2026-05-01")).toBe(-9);
  });

  it("buckets on the boundaries", () => {
    const today = "2026-10-29";
    expect(agingBucket(null, today)).toBe("current");
    expect(agingBucket("2026-11-05", today)).toBe("current");
    expect(agingBucket(today, today)).toBe("current");
    expect(agingBucket("2026-10-28", today)).toBe("1-30");
    expect(agingBucket("2026-09-29", today)).toBe("1-30");
    expect(agingBucket("2026-09-28", today)).toBe("31-60");
    expect(agingBucket("2026-08-30", today)).toBe("31-60");
    expect(agingBucket("2026-08-29", today)).toBe("61-90");
    expect(agingBucket("2026-07-31", today)).toBe("61-90");
    expect(agingBucket("2026-07-30", today)).toBe("90+");
  });

  it("ties every bucket and client back to the open balances", () => {
    const rows = [
      { clientId: "a", dueDate: "2026-11-01", balanceCents: 1000 },
      { clientId: "a", dueDate: "2026-10-01", balanceCents: 250 },
      { clientId: "b", dueDate: "2026-06-01", balanceCents: 4000 },
      { clientId: "b", dueDate: "2026-06-01", balanceCents: 0 },
    ];
    const { byClient, total } = ageBalances(rows, "2026-10-29");
    expect(total).toEqual({
      current: 1000,
      "1-30": 250,
      "31-60": 0,
      "61-90": 0,
      "90+": 4000,
      totalCents: 5250,
    });
    expect(byClient.get("a")?.totalCents).toBe(1250);
    expect(byClient.get("b")?.["90+"]).toBe(4000);
    expect(total.totalCents).toBe(rows.reduce((s, r) => s + r.balanceCents, 0));
  });
});

describe("cash basis allocation (FR-RPT-03)", () => {
  it("allocates proportionally and sums exactly once fully paid", () => {
    const invoice = { partCents: 7_501, invoiceTotalCents: 107_514 };
    const payments = [33_333, 33_333, 40_848];
    let settled = 0;
    const shares = payments.map((p) => {
      const share = cashShare({ ...invoice, settledBeforeCents: settled, paymentCents: p });
      settled += p;
      return share;
    });
    expect(shares.reduce((a, b) => a + b, 0)).toBe(7_501);
    expect(shares[0]).toBe(2_326);
  });

  it("stays exact on large invoices (no float overflow)", () => {
    // ₦1.49m total with ₦115k VAT: the product of the two passes 2^53.
    const invoice = { partCents: 11_540_050_00, invoiceTotalCents: 149_000_000_00 };
    expect(cashShare({ ...invoice, settledBeforeCents: 0, paymentCents: 100_000_000_00 })).toBe(7_745_000_00);
    expect(
      cashShare({ ...invoice, settledBeforeCents: 0, paymentCents: 100_000_000_00 }) +
        cashShare({ ...invoice, settledBeforeCents: 100_000_000_00, paymentCents: 49_000_000_00 }),
    ).toBe(11_540_050_00);
  });

  it("ignores overpayment beyond the invoice total and empty invoices", () => {
    expect(
      cashShare({ partCents: 750, invoiceTotalCents: 10_750, settledBeforeCents: 0, paymentCents: 20_000 }),
    ).toBe(750);
    expect(
      cashShare({ partCents: 750, invoiceTotalCents: 10_750, settledBeforeCents: 10_750, paymentCents: 5 }),
    ).toBe(0);
    expect(cashShare({ partCents: 0, invoiceTotalCents: 0, settledBeforeCents: 0, paymentCents: 100 })).toBe(
      0,
    );
  });
});

describe("expenses", () => {
  it("nets VAT and recharges with markup, half up", () => {
    expect(expenseNetCents({ amountCents: 10_750, vatCents: 750 })).toBe(10_000);
    expect(rechargeCents(10_000, 1500)).toBe(11_500);
    expect(rechargeCents(333, 1500)).toBe(383);
    expect(rechargeCents(5_000, 0)).toBe(5_000);
  });
});

describe("periods", () => {
  const today = "2026-10-29";
  it("resolves presets", () => {
    expect(presetRange("this-month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("this-quarter", today)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(presetRange("this-quarter", "2028-02-10")).toEqual({ from: "2028-01-01", to: "2028-03-31" });
    expect(presetRange("this-year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(presetRange("last-year", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("matches a range back to its preset", () => {
    expect(matchPreset("2026-09-01", "2026-09-30", today)).toBe("last-month");
    expect(matchPreset("2026-09-02", "2026-09-30", today)).toBeNull();
  });

  it("lists months, across a year end, capped", () => {
    expect(monthKeys("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthKeys("2026-05-01", "2026-04-30")).toEqual([]);
    expect(monthKeys("2000-01-01", "2026-01-01")).toHaveLength(36);
  });

  it("gives trailing month ranges", () => {
    expect(trailingMonths(6, today)).toEqual({ from: "2026-05-01", to: "2026-10-31" });
    expect(trailingMonths(12, "2026-02-03")).toEqual({ from: "2025-03-01", to: "2026-02-28" });
    expect(trailingMonths(1, "2028-02-03")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
