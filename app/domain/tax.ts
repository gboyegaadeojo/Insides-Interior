// Totals and tax engine (SPEC 10.1, 10.2). Pure: no UI, no database. Used by the
// builder, portal, PDF, Home and reports so a number is the same everywhere.
//
//   amount(line)    = round_half_up(qty_milli × unit_price / 1000)
//   net(line)       = amount − line discount − share of document discount
//   tax(line, rate) = round_half_up(net × rate)       (once per line per rate)
//   total           = Σ net + Σ tax
//
// Deposit and progress invoices bill a portion of a quote as one line per tax
// group; final invoices credit each prior invoice with the exact taxes it
// charged, so rounding differences land on the final invoice and the parts
// always add up to the quote (golden fixtures F1–F3).

import { applyBp, lineAmountCents } from "./money";

export interface TaxRate {
  id: string;
  name: string;
  rateBp: number;
}

export type Discount = { type: "percent"; bp: number } | { type: "amount"; cents: number };

export interface DocumentLine {
  id: string;
  description: string;
  qtyMilli: number;
  unitPriceCents: number;
  taxRateIds: string[];
  discount?: Discount;
  /** Optional items are excluded from totals until selected (SPEC 0.2). */
  optional?: boolean;
  selected?: boolean;
  /** Credit lines carry the exact tax already charged, by rate id. */
  fixedTaxes?: Record<string, number>;
}

export interface LineTax {
  rateId: string;
  taxableCents: number;
  taxCents: number;
}

export interface ComputedLine {
  id: string;
  included: boolean;
  amountCents: number;
  lineDiscountCents: number;
  documentDiscountCents: number;
  netCents: number;
  taxes: LineTax[];
}

export interface DocumentTax extends LineTax {
  name: string;
  rateBp: number;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  /** Σ line amounts before discounts (included lines; credits are negative). */
  subtotalCents: number;
  /** Line plus document discounts. */
  discountCents: number;
  taxes: DocumentTax[];
  taxCents: number;
  totalCents: number;
}

export function computeDocument(input: {
  lines: DocumentLine[];
  taxRates: TaxRate[];
  documentDiscount?: Discount;
}): ComputedDocument {
  const rates = new Map(input.taxRates.map((r) => [r.id, r]));

  const lines = input.lines.map((line) => {
    const included = !line.optional || line.selected === true;
    const amountCents = included ? lineAmountCents(line.qtyMilli, line.unitPriceCents) : 0;
    return {
      source: line,
      id: line.id,
      included,
      amountCents,
      lineDiscountCents: amountCents > 0 ? discountCents(amountCents, line.discount) : 0,
      documentDiscountCents: 0,
    };
  });

  // Document discount, pro rata by discounted amount; positive lines only.
  const bases = lines.map((l) => Math.max(0, l.amountCents - l.lineDiscountCents));
  const allocations = allocate(discountCents(sum(bases), input.documentDiscount), bases);
  lines.forEach((l, i) => (l.documentDiscountCents = allocations[i]!));

  const computed: ComputedLine[] = lines.map((l) => {
    const netCents = l.amountCents - l.lineDiscountCents - l.documentDiscountCents;
    const taxes: LineTax[] = [];
    if (l.included) {
      for (const rateId of l.source.taxRateIds) {
        const fixed = l.source.fixedTaxes?.[rateId];
        const rate = rates.get(rateId);
        if (fixed === undefined && !rate) continue;
        taxes.push({ rateId, taxableCents: netCents, taxCents: fixed ?? applyBp(netCents, rate!.rateBp) });
      }
    }
    return {
      id: l.id,
      included: l.included,
      amountCents: l.amountCents,
      lineDiscountCents: l.lineDiscountCents,
      documentDiscountCents: l.documentDiscountCents,
      netCents,
      taxes,
    };
  });

  const taxes: DocumentTax[] = [];
  for (const rate of input.taxRates) {
    const lineTaxes = computed.flatMap((l) => l.taxes).filter((t) => t.rateId === rate.id);
    if (lineTaxes.length === 0) continue;
    taxes.push({
      rateId: rate.id,
      name: rate.name,
      rateBp: rate.rateBp,
      taxableCents: sum(lineTaxes.map((t) => t.taxableCents)),
      taxCents: sum(lineTaxes.map((t) => t.taxCents)),
    });
  }

  const subtotalCents = sum(computed.map((l) => l.amountCents));
  const discountTotal = sum(computed.map((l) => l.lineDiscountCents + l.documentDiscountCents));
  const taxCents = sum(taxes.map((t) => t.taxCents));
  return {
    lines: computed,
    subtotalCents,
    discountCents: discountTotal,
    taxes,
    taxCents,
    totalCents: subtotalCents - discountTotal + taxCents,
  };
}

function discountCents(baseCents: number, discount: Discount | undefined): number {
  if (!discount || baseCents <= 0) return 0;
  const raw = discount.type === "percent" ? applyBp(baseCents, discount.bp) : discount.cents;
  return Math.min(Math.max(0, raw), baseCents);
}

/**
 * Splits `total` across `weights` pro rata (floor), putting the remainder on
 * the largest weight first, never giving a slot more than its weight.
 */
function allocate(total: number, weights: number[]): number[] {
  const weightSum = sum(weights);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  const shares = weights.map((w) => Number((BigInt(total) * BigInt(w)) / BigInt(weightSum)));
  let remainder = total - sum(shares);
  const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  while (remainder > 0) {
    let gave = false;
    for (const [w, i] of order) {
      if (remainder === 0) break;
      const room = w - shares[i]!;
      if (room <= 0) continue;
      const give = Math.min(room, remainder);
      shares[i]! += give;
      remainder -= give;
      gave = true;
    }
    if (!gave) break;
  }
  return shares;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function taxGroupKey(ids: string[]) {
  return [...ids].sort().join("+");
}

/**
 * Lines for a deposit or progress invoice billing a portion of `document`: one
 * line per distinct tax set, so tax is calculated once on each portion
 * (F2: 50% of ₦113,442.38 = ₦56,721.19, VAT ₦4,254.09).
 */
export function buildPortionLines(
  document: ComputedDocument,
  portion: Discount,
  description: string,
): DocumentLine[] {
  const groups = new Map<string, { taxRateIds: string[]; net: number }>();
  for (const line of document.lines) {
    if (!line.included || line.netCents <= 0) continue;
    const ids = line.taxes.map((t) => t.rateId);
    const key = taxGroupKey(ids);
    const group = groups.get(key) ?? { taxRateIds: [...ids].sort(), net: 0 };
    group.net += line.netCents;
    groups.set(key, group);
  }
  const list = [...groups.values()];
  const nets = list.map((g) => g.net);
  const amounts =
    portion.type === "percent"
      ? nets.map((net) => applyBp(net, portion.bp))
      : allocate(Math.min(portion.cents, sum(nets)), nets);

  return list.flatMap((group, i) =>
    amounts[i]! > 0
      ? [
          {
            id: `portion-${i + 1}`,
            description,
            qtyMilli: 1000,
            unitPriceCents: amounts[i]!,
            taxRateIds: group.taxRateIds,
          },
        ]
      : [],
  );
}

/**
 * Lines for a final invoice: the full quote lines, then a credit for every line
 * of each prior invoice carrying the exact taxes it charged (F3).
 */
export function buildFinalInvoiceLines(
  quoteLines: DocumentLine[],
  priorInvoices: { label: string; document: ComputedDocument }[],
): DocumentLine[] {
  const credits: DocumentLine[] = [];
  priorInvoices.forEach((prior, p) => {
    prior.document.lines.forEach((line, l) => {
      if (!line.included || line.netCents === 0) return;
      credits.push({
        id: `credit-${p + 1}-${l + 1}`,
        description: `Less ${prior.label}`,
        qtyMilli: 1000,
        unitPriceCents: -line.netCents,
        taxRateIds: line.taxes.map((t) => t.rateId),
        fixedTaxes: Object.fromEntries(line.taxes.map((t) => [t.rateId, -t.taxCents])),
      });
    });
  });
  return [...quoteLines.map((line) => ({ ...line })), ...credits];
}

/** Deposit due on a quote and the balance after it (SPEC 6.8 totals card). */
export function depositDue(totalCents: number, deposit: Discount | undefined) {
  const depositCents = discountCents(totalCents, deposit);
  return { depositCents, balanceCents: totalCents - depositCents };
}
