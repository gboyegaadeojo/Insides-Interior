import { describe, expect, it } from "vitest";
import { applyChangeRequests, kindsFor, resolutionsFor } from "~/domain/change-requests";
import { describeDiff, diffContent, hasChanges } from "~/domain/diff";
import { daysPastDue, dueStep, dueWording, reminderBlock } from "~/domain/reminders";

// SPEC 5.14 (FR-MSG-03, 05, 06, 07): applying accepted change requests, the
// What changed summary, and the reminder rule.

const VAT = { id: "vat", name: "VAT", rateBp: 750 };

function line(id: string, description: string, qtyMilli: number, unitPriceCents: number, extra = {}) {
  return { id, description, qtyMilli, unit: "each", unitPriceCents, taxRateIds: ["vat"], ...extra };
}

const content = {
  sections: [
    {
      id: "s1",
      title: "Living room",
      lines: [line("sofa", "Sofa", 1000, 100_000_00), line("cushions", "Cushions", 2000, 5_000_00)],
    },
    { id: "s2", title: "Bedroom", lines: [line("lamp", "Lamp", 1000, 20_000_00)] },
  ],
  taxRates: [VAT],
};

describe("applyChangeRequests (FR-MSG-05)", () => {
  it("removes lines and sets quantities in one pass; Other is left to the owner", () => {
    const result = applyChangeRequests(content, [
      { id: "r1", lineRef: "cushions", kind: "remove", proposedQtyMilli: null },
      { id: "r2", lineRef: "sofa", kind: "quantity", proposedQtyMilli: 2000 },
      { id: "r3", lineRef: "lamp", kind: "other", proposedQtyMilli: null },
    ]);
    expect(result.applied).toEqual(["r1", "r2"]);
    expect(result.manual).toEqual(["r3"]);
    expect(result.content.sections[0]!.lines.map((l) => [l.id, l.qtyMilli])).toEqual([["sofa", 2000]]);
    expect(result.content.sections[1]!.lines).toHaveLength(1);
    // The input is untouched (pure).
    expect(content.sections[0]!.lines).toHaveLength(2);
  });

  it("skips lines that are gone or locked rather than guessing", () => {
    const locked = {
      ...content,
      sections: [
        { id: "s", title: "Deposit", lines: [line("dep", "Deposit 50%", 1000, 50_000_00, { locked: true })] },
      ],
    };
    const result = applyChangeRequests(locked, [
      { id: "a", lineRef: "dep", kind: "remove", proposedQtyMilli: null },
      { id: "b", lineRef: "missing", kind: "quantity", proposedQtyMilli: 3000 },
      { id: "c", lineRef: "dep", kind: "quantity", proposedQtyMilli: 0 },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.manual).toEqual(["a", "b", "c"]);
    expect(result.content.sections[0]!.lines).toHaveLength(1);
  });

  it("offers words-only requests on generated lines and the whole document", () => {
    expect(kindsFor({ id: "x", qtyMilli: 1000 })).toEqual(["remove", "quantity", "question", "other"]);
    expect(kindsFor({ id: "x", qtyMilli: 1000, locked: true })).toEqual(["question", "other"]);
    expect(kindsFor(null)).toEqual(["question", "other"]);
    expect(resolutionsFor("question")).toEqual(["answer"]);
    expect(resolutionsFor("remove")).toEqual(["accept", "decline"]);
  });
});

describe("diffContent (FR-MSG-06 What changed)", () => {
  it("lists added, removed and changed lines with the totals before and after", () => {
    const after = {
      ...content,
      sections: [
        { ...content.sections[0]!, lines: [line("sofa", "Sofa", 2000, 100_000_00)] },
        {
          ...content.sections[1]!,
          lines: [line("lamp", "Lamp", 1000, 18_000_00), line("rug", "Rug", 1000, 30_000_00)],
        },
      ],
    };
    const diff = diffContent(content, after);
    expect(diff.lines.map((c) => [c.kind, c.lineId, c.fields])).toEqual([
      ["changed", "sofa", ["quantity"]],
      ["changed", "lamp", ["price"]],
      ["added", "rug", []],
      ["removed", "cushions", []],
    ]);
    // Before: (100,000 + 10,000 + 20,000) × 1.075; after: (200,000 + 18,000 + 30,000) × 1.075.
    expect(diff.totalBeforeCents).toBe(139_750_00);
    expect(diff.totalAfterCents).toBe(266_600_00);
    expect(describeDiff(diff)).toEqual([
      "Changed Sofa: quantity 1 → 2",
      "Changed Lamp: price ₦20,000.00 → ₦18,000.00",
      "Added Rug",
      "Removed Cushions",
    ]);
    expect(describeDiff(diff, 2)).toEqual([
      "Changed Sofa: quantity 1 → 2",
      "Changed Lamp: price ₦20,000.00 → ₦18,000.00",
      "and 2 more changes",
    ]);
  });

  it("finds nothing when only the order of taxes differs", () => {
    const same = {
      ...content,
      sections: content.sections.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) })),
    };
    const diff = diffContent(content, same);
    expect(diff.lines).toEqual([]);
    expect(hasChanges(diff)).toBe(false);
  });

  it("names every kind of line change", () => {
    const before = {
      sections: [
        {
          id: "s",
          title: "Room",
          lines: [
            line("a", "Blind", 1000, 10_000_00, { discount: { type: "percent", bp: 1000 } }),
            line("b", "Rail", 1000, 5_000_00, { discount: { type: "amount", cents: 100 } }),
            line("c", "Fabric", 1000, 5_000_00, { optional: true, selected: false }),
          ],
        },
      ],
      taxRates: [VAT],
    };
    const after = {
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          lines: [
            line("a", "Roller blind", 1000, 10_000_00, { discount: { type: "amount", cents: 100 } }),
            line("b", "Rail", 1000, 5_000_00, {
              unit: "metre",
              discount: { type: "amount", cents: 200 },
              taxRateIds: [],
            }),
            line("c", "", 1000, 5_000_00, { optional: true, selected: true }),
          ],
        },
      ],
    };
    expect(describeDiff(diffContent(before, after))).toEqual([
      "Changed Roller blind: description, discount",
      "Changed Rail: unit, discount, tax",
      "Changed Untitled line: description, option choice",
    ]);
    const percent = {
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          lines: [line("a", "Blind", 1000, 10_000_00, { discount: { type: "percent", bp: 500 } })],
        },
      ],
    };
    expect(
      diffContent(
        { ...before, sections: [{ ...before.sections[0]!, lines: [before.sections[0]!.lines[0]!] }] },
        percent,
      ).lines[0]!.fields,
    ).toEqual(["discount"]);
  });

  it("notices an overall discount", () => {
    const diff = diffContent(content, { ...content, documentDiscount: { type: "percent", bp: 1000 } });
    expect(diff.discountChanged).toBe(true);
    expect(diff.totalAfterCents).toBeLessThan(diff.totalBeforeCents);
    expect(describeDiff(diff)).toEqual(["Changed the overall discount"]);
  });
});

describe("reminderBlock (FR-MSG-07)", () => {
  const due = { remindersPaused: false, openRequests: 0, balanceCents: 1000 };

  it("never reminds while a change request is open, whatever the status", () => {
    for (const status of ["sent", "viewed", "partially_paid", "overdue", "changes_requested"] as const) {
      expect(reminderBlock({ ...due, status, openRequests: 1 })).toBe("open_request");
    }
    expect(reminderBlock({ ...due, status: "changes_requested" })).toBe("open_request");
  });

  it("reminds outstanding, unpaused invoices with something due", () => {
    expect(reminderBlock({ ...due, status: "overdue" })).toBeNull();
    expect(reminderBlock({ ...due, status: "sent", remindersPaused: true })).toBe("paused");
    expect(reminderBlock({ ...due, status: "sent", balanceCents: 0 })).toBe("nothing_due");
    expect(reminderBlock({ ...due, status: "paid" })).toBe("status");
    expect(reminderBlock({ ...due, status: "draft" })).toBe("status");
  });
});

describe("dueStep: one email per cadence step (FR-AUTO-01)", () => {
  const cadence = { base: "2026-11-20", steps: [-3, 0, 7, 14], notBefore: "2026-11-06", max: 4 };

  it("sends each step on its day, once", () => {
    expect(dueStep({ ...cadence, today: "2026-11-16", sent: [] })).toBeNull();
    expect(dueStep({ ...cadence, today: "2026-11-17", sent: [] })).toBe(-3);
    expect(dueStep({ ...cadence, today: "2026-11-18", sent: [-3] })).toBeNull();
    expect(dueStep({ ...cadence, today: "2026-11-20", sent: [-3] })).toBe(0);
    expect(dueStep({ ...cadence, today: "2026-11-27", sent: [-3, 0] })).toBe(7);
  });

  it("after missed days sends only the latest step, never an older one later", () => {
    expect(dueStep({ ...cadence, today: "2026-12-10", sent: [-3] })).toBe(14);
    expect(dueStep({ ...cadence, today: "2026-12-11", sent: [-3, 14] })).toBeNull();
  });

  it("skips steps on or before the day the invoice went out, and stops at the maximum", () => {
    expect(dueStep({ ...cadence, notBefore: "2026-11-18", today: "2026-11-18", sent: [] })).toBeNull();
    expect(dueStep({ ...cadence, notBefore: "2026-11-18", today: "2026-11-20", sent: [] })).toBe(0);
    expect(dueStep({ ...cadence, max: 2, today: "2026-12-04", sent: [-3, 0] })).toBeNull();
    expect(dueStep({ base: "2026-11-01", steps: [3, 7], today: "2026-11-04", sent: [] })).toBe(3);
  });

  it("words where the invoice stands", () => {
    expect(daysPastDue("2026-11-20", "2026-11-17")).toBe(-3);
    expect(daysPastDue("2026-11-20", "2026-12-04")).toBe(14);
    expect(dueWording(-3)).toBe("due in 3 days");
    expect(dueWording(-1)).toBe("due in 1 day");
    expect(dueWording(0)).toBe("due today");
    expect(dueWording(1)).toBe("1 day overdue");
    expect(dueWording(14)).toBe("14 days overdue");
  });
});
