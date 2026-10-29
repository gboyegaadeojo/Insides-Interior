import { describe, expect, it } from "vitest";
import { planSchema } from "~/features/migration/schema";
import {
  buildPlan,
  dateOf,
  isoOf,
  kobo,
  mapCategory,
  mapInvoiceStatus,
  mapMethod,
  mapQuoteStatus,
  mergeExports,
  scaled,
} from "../../scripts/migrate/transform";
import { oldAppExports } from "../fixtures/old-app";

describe("parsing the old app's values", () => {
  it("turns float naira into exact kobo, rounding half up on the decimal", () => {
    expect(kobo(6184.5)).toBe(618_450);
    expect(kobo(0.1 + 0.2)).toBe(30);
    expect(kobo(1.005)).toBe(101);
    expect(kobo("12,500.75")).toBe(1_250_075);
    expect(kobo(-3.335)).toBe(-334);
    expect(kobo("abc")).toBeNull();
    expect(scaled(2.5, 3)).toBe(2500);
    expect(scaled(8.5, 2)).toBe(850);
  });

  it("reads Firestore timestamps and date strings", () => {
    expect(isoOf({ seconds: 1_790_000_000 })).toBe(new Date(1_790_000_000_000).toISOString());
    expect(isoOf({ _seconds: 0 })).toBe("1970-01-01T00:00:00.000Z");
    expect(isoOf("not a date")).toBe("");
    expect(isoOf(42)).toBe("");
    expect(dateOf("2026-07-15")).toBe("2026-07-15");
    expect(dateOf("2026-07-15T10:00:00Z")).toBe("2026-07-15");
    expect(dateOf(null)).toBeNull();
  });

  it("maps statuses per SPEC 12.2", () => {
    expect(mapInvoiceStatus("pending")).toBe("sent");
    expect(mapInvoiceStatus("overdue")).toBe("sent");
    expect(mapInvoiceStatus("paid")).toBe("paid");
    expect(mapInvoiceStatus("void")).toBe("void");
    expect(mapInvoiceStatus("weird")).toBeNull();
    expect(mapQuoteStatus("sent_for_approval")).toEqual({ status: "sent", converted: false });
    expect(mapQuoteStatus("accepted")).toEqual({ status: "approved", converted: false });
    expect(mapQuoteStatus("converted")).toEqual({ status: "approved", converted: true });
    expect(mapQuoteStatus("rejected")).toEqual({ status: "declined", converted: false });
    expect(mapQuoteStatus(undefined)).toBeNull();
  });

  it("maps categories and payment methods", () => {
    expect(mapCategory("travel")).toBe("transport");
    expect(mapCategory("Equipment")).toBe("tools");
    expect(mapCategory("anything")).toBe("other");
    expect(mapMethod("Bank Transfer")).toBe("bank");
    expect(mapMethod("cash")).toBe("cash");
    expect(mapMethod("Credit card")).toBe("card");
    expect(mapMethod("POS")).toBe("pos");
    expect(mapMethod("cheque")).toBe("cheque");
    expect(mapMethod(null)).toBe("other");
  });
});

describe("merging the exports (SPEC 12.1 step 4)", () => {
  it("unions Firestore and browser copies, keeps the newer, and drops the demo seed", () => {
    const merged = mergeExports(oldAppExports());
    expect(merged.counts.invoices.demo).toBeGreaterThan(0);
    expect(merged.records.customers.map((c) => c.name)).not.toContain("Acme Corporation");
    // The browser had a newer edit of the Ade client than Firestore.
    expect(merged.records.customers.find((c) => c.id === "cust_ade")?.phone).toBe("0803 000 1111");
    // A record only the browser had (the silent localStorage fallback) is kept.
    expect(merged.records.invoices.some((i) => i.id === "inv_browser_only")).toBe(true);
  });

  it("builds a plan that the importer's schema accepts, with warnings for the owner", () => {
    const plan = buildPlan(mergeExports(oldAppExports()));
    expect(() => planSchema.parse(plan)).not.toThrow();
    expect(plan.invoices.find((i) => i.number === "INV-2026-104")).toMatchObject({
      status: "sent",
      legacyTotalCents: 107_500_00,
      fromQuoteNumber: "QT-2026-010",
    });
    expect(plan.quotes.find((q) => q.number === "QT-2026-011")?.clientComment).toBe(
      "Can the curtains be lined?",
    );
    expect(plan.warnings.join("\n")).toContain("8.5%");
    expect(plan.warnings.join("\n")).toContain("share the number INV-2026-105");
    expect(plan.payments.every((p) => p.amountCents > 0)).toBe(true);
    // Discount lines become negative lines.
    const discounted = plan.invoices.find((i) => i.number === "INV-2026-106")!;
    expect(discounted.lines.find((l) => l.description === "Loyalty discount")?.unitPriceCents).toBeLessThan(
      0,
    );
  });
});
