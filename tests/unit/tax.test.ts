import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { roundHalfUpDiv } from "~/domain/money";
import {
  buildFinalInvoiceLines,
  buildPortionLines,
  computeDocument,
  type DocumentLine,
  type TaxRate,
} from "~/domain/tax";

// Two-rate engine fixtures (5% and 7% on both lines): they exercise rounding
// across several taxes and hold in any currency. The Nigerian fixtures F1–F3
// (SPEC 10.2, VAT 7.5%) are below.
const GST: TaxRate = { id: "tax_gst", name: "GST", rateBp: 500 };
const PST: TaxRate = { id: "tax_pst", name: "PST", rateBp: 700 };
const RATES = [GST, PST];

const F1_LINES: DocumentLine[] = [
  {
    id: "l1",
    description: "Design consultation",
    qtyMilli: 3000,
    unitPriceCents: 9500,
    taxRateIds: ["tax_gst", "tax_pst"],
  },
  {
    id: "l2",
    description: "Drapery fabric",
    qtyMilli: 4500,
    unitPriceCents: 4275,
    taxRateIds: ["tax_gst", "tax_pst"],
  },
];

function taxOf(result: ReturnType<typeof computeDocument>, id: string) {
  return result.taxes.find((t) => t.rateId === id)?.taxCents;
}

describe("two-rate engine fixtures", () => {
  const f1 = computeDocument({ lines: F1_LINES, taxRates: RATES });

  it("F1 quote: $477.38 + GST $23.87 + PST $33.42 = $534.67", () => {
    expect(f1.lines.map((l) => l.amountCents)).toEqual([28500, 19238]);
    expect(f1.subtotalCents).toBe(47738);
    expect(taxOf(f1, "tax_gst")).toBe(2387);
    expect(taxOf(f1, "tax_pst")).toBe(3342);
    expect(f1.totalCents).toBe(53467);
  });

  const f2Lines = buildPortionLines(f1, { type: "percent", bp: 5000 }, "Deposit (50%)");
  const f2 = computeDocument({ lines: f2Lines, taxRates: RATES });

  it("F2 deposit invoice (50% of F1): $238.69 + GST $11.93 + PST $16.71 = $267.33", () => {
    expect(f2.subtotalCents).toBe(23869);
    expect(taxOf(f2, "tax_gst")).toBe(1193);
    expect(taxOf(f2, "tax_pst")).toBe(1671);
    expect(f2.totalCents).toBe(26733);
  });

  const f3Lines = buildFinalInvoiceLines(F1_LINES, [{ label: "Deposit invoice INV-1001", document: f2 }]);
  const f3 = computeDocument({ lines: f3Lines, taxRates: RATES });

  it("F3 final invoice (F1 less F2): $238.69 + GST $11.94 + PST $16.71 = $267.34", () => {
    expect(f3.subtotalCents).toBe(23869);
    expect(taxOf(f3, "tax_gst")).toBe(1194);
    expect(taxOf(f3, "tax_pst")).toBe(1671);
    expect(f3.totalCents).toBe(26734);
  });

  it("F2 + F3 = F1 exactly; rounding differences land on the final invoice", () => {
    expect(f2.totalCents + f3.totalCents).toBe(f1.totalCents);
  });
});

// SPEC 10.2 golden fixtures, worked by hand: VAT 7.5% on both lines.
describe("golden fixtures F1–F3 (SPEC 10.2, naira, VAT 7.5%)", () => {
  const VAT: TaxRate = { id: "tax_vat", name: "VAT", rateBp: 750 };
  const lines: DocumentLine[] = [
    {
      id: "l1",
      description: "Design consultation",
      qtyMilli: 3000,
      unitPriceCents: 2_500_000,
      taxRateIds: ["tax_vat"],
    },
    {
      id: "l2",
      description: "Drapery fabric",
      qtyMilli: 4500,
      unitPriceCents: 854_275,
      taxRateIds: ["tax_vat"],
    },
  ];
  const f1 = computeDocument({ lines, taxRates: [VAT] });

  it("F1 quote: ₦113,442.38 + VAT ₦8,508.18 = ₦121,950.56", () => {
    // 4.5 × ₦8,542.75 = ₦38,442.375 → ₦38,442.38; VAT per line ₦5,625.00 + ₦2,883.18.
    expect(f1.lines.map((l) => l.amountCents)).toEqual([7_500_000, 3_844_238]);
    expect(f1.subtotalCents).toBe(11_344_238);
    expect(taxOf(f1, "tax_vat")).toBe(850_818);
    expect(f1.totalCents).toBe(12_195_056);
  });

  const f2 = computeDocument({
    lines: buildPortionLines(f1, { type: "percent", bp: 5000 }, "Deposit (50%)"),
    taxRates: [VAT],
  });

  it("F2 deposit invoice (50% of F1): ₦56,721.19 + VAT ₦4,254.09 = ₦60,975.28", () => {
    expect(f2.subtotalCents).toBe(5_672_119);
    expect(taxOf(f2, "tax_vat")).toBe(425_409);
    expect(f2.totalCents).toBe(6_097_528);
  });

  const f3 = computeDocument({
    lines: buildFinalInvoiceLines(lines, [{ label: "Deposit invoice INV-1001", document: f2 }]),
    taxRates: [VAT],
  });

  it("F3 final invoice (F1 less F2): ₦56,721.19 + VAT ₦4,254.09 = ₦60,975.28; F2 + F3 = F1", () => {
    expect(f3.subtotalCents).toBe(5_672_119);
    expect(taxOf(f3, "tax_vat")).toBe(425_409);
    expect(f3.totalCents).toBe(6_097_528);
    expect(f2.totalCents + f3.totalCents).toBe(f1.totalCents);
  });
});

describe("line maths (SPEC 10.1)", () => {
  it("rounds each line half up once: 4.5 × $42.75 = $192.375 → $192.38", () => {
    const r = computeDocument({ lines: [F1_LINES[1]!], taxRates: [] });
    expect(r.lines[0]!.amountCents).toBe(19238);
  });

  it("applies percent and fixed line discounts before tax", () => {
    const r = computeDocument({
      lines: [
        { ...F1_LINES[0]!, discount: { type: "percent", bp: 1000 } },
        { ...F1_LINES[1]!, discount: { type: "amount", cents: 238 } },
      ],
      taxRates: RATES,
    });
    expect(r.lines.map((l) => l.netCents)).toEqual([25650, 19000]);
    expect(r.discountCents).toBe(2850 + 238);
    // GST: 1282.5→1283, 950 → 2233
    expect(taxOf(r, "tax_gst")).toBe(1283 + 950);
  });

  it("excludes optional items until selected", () => {
    const optional: DocumentLine = {
      id: "opt",
      description: "Blackout lining",
      qtyMilli: 1000,
      unitPriceCents: 5000,
      taxRateIds: ["tax_gst"],
      optional: true,
    };
    const without = computeDocument({ lines: [...F1_LINES, optional], taxRates: RATES });
    expect(without.totalCents).toBe(53467);
    expect(without.lines[2]!.included).toBe(false);
    const withIt = computeDocument({
      lines: [...F1_LINES, { ...optional, selected: true }],
      taxRates: RATES,
    });
    expect(withIt.totalCents).toBe(53467 + 5000 + 250);
  });

  it("allocates a document discount pro rata, remainder on the largest line", () => {
    const r = computeDocument({
      lines: [
        { id: "a", description: "A", qtyMilli: 1000, unitPriceCents: 10000, taxRateIds: [] },
        { id: "b", description: "B", qtyMilli: 1000, unitPriceCents: 5000, taxRateIds: [] },
        { id: "c", description: "C", qtyMilli: 1000, unitPriceCents: 5000, taxRateIds: [] },
      ],
      documentDiscount: { type: "amount", cents: 1001 },
      taxRates: [],
    });
    expect(r.lines.map((l) => l.documentDiscountCents)).toEqual([501, 250, 250]);
    expect(r.discountCents).toBe(1001);
    expect(r.totalCents).toBe(20000 - 1001);
  });

  it("never discounts below zero", () => {
    const r = computeDocument({
      lines: [{ ...F1_LINES[0]!, discount: { type: "amount", cents: 999999 } }],
      documentDiscount: { type: "percent", bp: 10000 },
      taxRates: RATES,
    });
    expect(r.lines[0]!.netCents).toBe(0);
    expect(r.totalCents).toBe(0);
  });

  it("ignores tax ids that are not in the rate list", () => {
    const r = computeDocument({ lines: [{ ...F1_LINES[0]!, taxRateIds: ["tax_gone"] }], taxRates: RATES });
    expect(r.taxCents).toBe(0);
  });
});

describe("portions and credits", () => {
  it("groups portion lines by tax set", () => {
    const doc = computeDocument({
      lines: [
        { id: "s", description: "Service", qtyMilli: 1000, unitPriceCents: 10000, taxRateIds: ["tax_gst"] },
        {
          id: "p",
          description: "Product",
          qtyMilli: 1000,
          unitPriceCents: 5001,
          taxRateIds: ["tax_gst", "tax_pst"],
        },
      ],
      taxRates: RATES,
    });
    const lines = buildPortionLines(doc, { type: "percent", bp: 3000 }, "Progress (30%)");
    expect(lines.map((l) => [l.unitPriceCents, l.taxRateIds])).toEqual([
      [3000, ["tax_gst"]],
      [1500, ["tax_gst", "tax_pst"]],
    ]);
  });

  it("splits a fixed-amount deposit across tax groups pro rata, summing exactly", () => {
    const doc = computeDocument({
      lines: [
        { id: "s", description: "Service", qtyMilli: 1000, unitPriceCents: 10000, taxRateIds: ["tax_gst"] },
        {
          id: "p",
          description: "Product",
          qtyMilli: 1000,
          unitPriceCents: 5000,
          taxRateIds: ["tax_gst", "tax_pst"],
        },
      ],
      taxRates: RATES,
    });
    const lines = buildPortionLines(doc, { type: "amount", cents: 1001 }, "Deposit");
    expect(lines.reduce((s, l) => s + l.unitPriceCents, 0)).toBe(1001);
  });

  it("credit lines carry the exact taxes charged on the prior invoice", () => {
    const prior = computeDocument({
      lines: [
        { id: "d", description: "Deposit", qtyMilli: 1000, unitPriceCents: 333, taxRateIds: ["tax_gst"] },
      ],
      taxRates: RATES,
    });
    const lines = buildFinalInvoiceLines([], [{ label: "Deposit", document: prior }]);
    expect(lines[0]!.unitPriceCents).toBe(-333);
    expect(lines[0]!.fixedTaxes).toEqual({ tax_gst: -17 });
  });
});

// Property-based checks (SPEC 13: 50+ cases).
const line = fc.record({
  qtyMilli: fc.integer({ min: 0, max: 1_000_000 }),
  unitPriceCents: fc.integer({ min: 0, max: 5_000_000 }),
  gst: fc.boolean(),
  pst: fc.boolean(),
  discountBp: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
});

type RawLine = typeof line extends fc.Arbitrary<infer T> ? T : never;

function toLines(raw: RawLine[]): DocumentLine[] {
  return raw.map((l, i) => ({
    id: `l${i}`,
    description: `Line ${i}`,
    qtyMilli: l.qtyMilli,
    unitPriceCents: l.unitPriceCents,
    taxRateIds: [...(l.gst ? ["tax_gst"] : []), ...(l.pst ? ["tax_pst"] : [])],
    discount: l.discountBp === undefined ? undefined : { type: "percent" as const, bp: l.discountBp },
  }));
}

describe("properties", () => {
  const params = { numRuns: 200 };

  it("total = Σ net + Σ tax, and every value is an integer", () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (raw) => {
        const r = computeDocument({ lines: toLines(raw), taxRates: RATES });
        const net = r.lines.reduce((s, l) => s + l.netCents, 0);
        const tax = r.taxes.reduce((s, t) => s + t.taxCents, 0);
        expect(r.totalCents).toBe(net + tax);
        expect(r.subtotalCents - r.discountCents).toBe(net);
        for (const v of [r.totalCents, r.subtotalCents, r.discountCents, r.taxCents]) {
          expect(Number.isSafeInteger(v)).toBe(true);
        }
      }),
      params,
    );
  });

  it("per-rate tax totals equal the sum of their line taxes (the PDF adds up)", () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (raw) => {
        const r = computeDocument({ lines: toLines(raw), taxRates: RATES });
        for (const t of r.taxes) {
          const sum = r.lines
            .flatMap((l) => l.taxes)
            .filter((x) => x.rateId === t.rateId)
            .reduce((s, x) => s + x.taxCents, 0);
          expect(t.taxCents).toBe(sum);
        }
      }),
      params,
    );
  });

  it("a document discount is fully allocated and never pushes a line negative", () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 10_000 }),
        (raw, bp) => {
          const r = computeDocument({
            lines: toLines(raw),
            documentDiscount: { type: "percent", bp },
            taxRates: RATES,
          });
          const allocated = r.lines.reduce((s, l) => s + l.documentDiscountCents, 0);
          const base = r.lines.reduce((s, l) => s + l.amountCents - l.lineDiscountCents, 0);
          expect(allocated).toBe(roundHalfUpDiv(base * bp, 10_000));
          for (const l of r.lines) expect(l.netCents).toBeGreaterThanOrEqual(0);
        },
      ),
      params,
    );
  });

  it("a deposit plus its final invoice always equals the quote total", () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 10_000 }),
        (raw, bp) => {
          const lines = toLines(raw).map((l) => ({ ...l, discount: undefined }));
          const quote = computeDocument({ lines, taxRates: RATES });
          const deposit = computeDocument({
            lines: buildPortionLines(quote, { type: "percent", bp }, "Deposit"),
            taxRates: RATES,
          });
          const final = computeDocument({
            lines: buildFinalInvoiceLines(lines, [{ label: "Deposit", document: deposit }]),
            taxRates: RATES,
          });
          expect(deposit.totalCents + final.totalCents).toBe(quote.totalCents);
          for (const rate of RATES) {
            const q = quote.taxes.find((t) => t.rateId === rate.id)?.taxCents ?? 0;
            const d = deposit.taxes.find((t) => t.rateId === rate.id)?.taxCents ?? 0;
            const f = final.taxes.find((t) => t.rateId === rate.id)?.taxCents ?? 0;
            expect(d + f).toBe(q);
          }
        },
      ),
      params,
    );
  });

  it("deposit, progress and final invoices together equal the quote", () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        (raw, depositBp, progressBp) => {
          const lines = toLines(raw).map((l) => ({ ...l, discount: undefined }));
          const quote = computeDocument({ lines, taxRates: RATES });
          const deposit = computeDocument({
            lines: buildPortionLines(quote, { type: "percent", bp: depositBp }, "Deposit"),
            taxRates: RATES,
          });
          const progress = computeDocument({
            lines: buildPortionLines(quote, { type: "percent", bp: progressBp }, "Progress"),
            taxRates: RATES,
          });
          const final = computeDocument({
            lines: buildFinalInvoiceLines(lines, [
              { label: "Deposit", document: deposit },
              { label: "Progress", document: progress },
            ]),
            taxRates: RATES,
          });
          expect(deposit.totalCents + progress.totalCents + final.totalCents).toBe(quote.totalCents);
        },
      ),
      params,
    );
  });
});

describe("roundHalfUpDiv", () => {
  it.each([
    [5, 2, 3],
    [4, 2, 2],
    [-5, 2, -3],
    [1, 3, 0],
    [2, 3, 1],
    [192375, 1000, 192],
    [0, 7, 0],
  ])("%d / %d → %d (half away from zero)", (n, d, expected) => {
    expect(roundHalfUpDiv(n, d)).toBe(expected);
  });

  it("is exact for large values", () => {
    expect(roundHalfUpDiv(1_000_000 * 5_000_000 + 500, 1000)).toBe(5_000_000_001);
  });
});
