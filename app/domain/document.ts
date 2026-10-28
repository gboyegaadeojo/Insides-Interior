// Totals for a whole document (quote or invoice content). Pure: the builder,
// the server save, the portal, the PDF and reports all call this, so a number
// is the same everywhere (SPEC 0.1, 10).

import {
  computeDocument,
  type ComputedDocument,
  type Discount,
  type DocumentLine,
  depositDue,
  type TaxRate,
} from "./tax";

export interface ContentLine {
  id: string;
  description: string;
  qtyMilli: number;
  unit: string;
  unitPriceCents: number;
  taxRateIds: string[];
  discount?: Discount;
  optional?: boolean;
  selected?: boolean;
  fixedTaxes?: Record<string, number>;
}

export interface ContentSection {
  id: string;
  title: string;
  lines: ContentLine[];
}

export interface ContentForTotals {
  sections: ContentSection[];
  documentDiscount?: Discount;
  taxRates: TaxRate[];
}

export function flattenLines(content: ContentForTotals): DocumentLine[] {
  return content.sections.flatMap((section) =>
    section.lines.map((line) => ({
      id: line.id,
      description: line.description,
      qtyMilli: line.qtyMilli,
      unitPriceCents: line.unitPriceCents,
      taxRateIds: line.taxRateIds,
      discount: line.discount,
      optional: line.optional,
      selected: line.selected,
      fixedTaxes: line.fixedTaxes,
    })),
  );
}

export interface DocumentTotals {
  /** With the current option selection. */
  computed: ComputedDocument;
  /** Without any optional items (FR-QT-03 "Base total"). */
  baseTotalCents: number;
  hasOptions: boolean;
  depositCents: number;
  balanceCents: number;
  /** Line id → computed line, for the line table. */
  byLine: Map<string, ComputedDocument["lines"][number]>;
}

export function computeContent(content: ContentForTotals, deposit?: Discount): DocumentTotals {
  const lines = flattenLines(content);
  const computed = computeDocument({
    lines,
    taxRates: content.taxRates,
    documentDiscount: content.documentDiscount,
  });
  const hasOptions = lines.some((l) => l.optional);
  const base = hasOptions
    ? computeDocument({
        lines: lines.map((l) => (l.optional ? { ...l, selected: false } : l)),
        taxRates: content.taxRates,
        documentDiscount: content.documentDiscount,
      }).totalCents
    : computed.totalCents;
  const { depositCents, balanceCents } = depositDue(computed.totalCents, deposit);
  return {
    computed,
    baseTotalCents: base,
    hasOptions,
    depositCents,
    balanceCents,
    byLine: new Map(computed.lines.map((l) => [l.id, l])),
  };
}

/** Deposit terms stored as type + value (FR-QT-05). */
export function depositFrom(
  type: "percent" | "amount" | null | undefined,
  value: number | null | undefined,
): Discount | undefined {
  if (!type || value === null || value === undefined) return undefined;
  return type === "percent" ? { type: "percent", bp: value } : { type: "amount", cents: value };
}
