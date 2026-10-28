// Catalogue pricing (FR-CAT-02) and project progress (FR-PRJ-02). Integers only.

import { applyBp, roundHalfUpDiv } from "./money";

/** Sell price from cost and markup: cost × (1 + markup). */
export function priceFromMarkup(costCents: number, markupBp: number): number {
  return costCents + applyBp(costCents, markupBp);
}

/** Markup in basis points from cost and price; null when there is no cost. */
export function markupFromPrice(costCents: number, priceCents: number): number | null {
  if (costCents <= 0) return null;
  return roundHalfUpDiv((priceCents - costCents) * 10_000, costCents);
}

/**
 * The three-colour project bar (SPEC 6.8): paid (Sage), invoiced but unpaid
 * (Indigo), remaining (neutral), as whole percentages summing to 100.
 * Remaining to bill = contract − invoiced (FR-PRJ-02).
 */
export function projectProgress(input: { contractCents: number; invoicedCents: number; paidCents: number }) {
  const { contractCents, invoicedCents, paidCents } = input;
  const remainingToBillCents = Math.max(0, contractCents - invoicedCents);
  if (contractCents <= 0)
    return { paidPct: 0, invoicedUnpaidPct: 0, remainingPct: 100, remainingToBillCents };
  const scale = Math.max(contractCents, invoicedCents);
  const paidPct = Math.min(100, roundHalfUpDiv(Math.min(paidCents, scale) * 100, scale));
  const invoicedPct = Math.min(100, roundHalfUpDiv(Math.min(invoicedCents, scale) * 100, scale));
  const invoicedUnpaidPct = Math.max(0, invoicedPct - paidPct);
  return {
    paidPct,
    invoicedUnpaidPct,
    remainingPct: 100 - paidPct - invoicedUnpaidPct,
    remainingToBillCents,
  };
}
