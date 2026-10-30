// Invoice balance, status and payment rules (SPEC 5.7, 5.8, 8.3). Pure: the
// payment services, the portal and the screens share them.
//
//   settled = Σ (cash + WHT) of payments not deleted + credits applied
//   balance = total − settled
//
// WHT is deducted by the payer and settles the invoice like cash; it never
// changes the invoice total (SPEC 10.2).

import type { InvoiceStatus } from "./lifecycle";
import { applyBp } from "./money";

export interface SettlementInput {
  totalCents: number;
  payments: { amountCents: number; whtCents: number; deleted?: boolean }[];
  creditsAppliedCents?: number;
}

export function settledCents(input: SettlementInput): number {
  const paid = input.payments
    .filter((p) => !p.deleted)
    .reduce((sum, p) => sum + p.amountCents + p.whtCents, 0);
  return paid + (input.creditsAppliedCents ?? 0);
}

export function balanceCents(input: SettlementInput): number {
  return input.totalCents - settledCents(input);
}

/** 0–100 for the progress ring on a partly paid invoice (SPEC 6.3). */
export function percentPaid(totalCents: number, settled: number): number {
  if (totalCents <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((settled * 100) / totalCents)));
}

/**
 * The status of a sent, non-void invoice, derived from its money (SPEC 8.3)
 * whenever a payment is recorded or deleted. An open change request keeps
 * `changes_requested` until the owner resolves it (SPEC 5.13); a past due
 * date keeps `overdue` until the balance is paid.
 */
export function deriveInvoiceStatus(s: {
  totalCents: number;
  settledCents: number;
  viewed: boolean;
  pastDue: boolean;
  openRequest: boolean;
}): InvoiceStatus {
  if (s.settledCents >= s.totalCents) return "paid";
  if (s.openRequest) return "changes_requested";
  if (s.pastDue) return "overdue";
  if (s.settledCents > 0) return "partially_paid";
  return s.viewed ? "viewed" : "sent";
}

export type PaymentCheck =
  | { ok: true; appliedCents: number; creditCents: number }
  | {
      ok: false;
      reason: "not_positive" | "nothing_due" | "wht_too_large" | "overpayment";
      excessCents?: number;
    };

/**
 * FR-PAY-01/02: cash plus WHT may settle at most the balance. More than that is
 * refused unless the owner confirms the excess becomes client credit; then the
 * payment applies only what's due and the rest is credit.
 */
export function checkPayment(p: {
  balanceCents: number;
  cashCents: number;
  whtCents: number;
  allowCredit: boolean;
}): PaymentCheck {
  if (p.cashCents < 0 || p.whtCents < 0 || p.cashCents + p.whtCents <= 0) {
    return { ok: false, reason: "not_positive" };
  }
  if (p.balanceCents <= 0) return { ok: false, reason: "nothing_due" };
  if (p.whtCents > p.balanceCents) return { ok: false, reason: "wht_too_large" };
  const excess = p.cashCents + p.whtCents - p.balanceCents;
  if (excess <= 0) return { ok: true, appliedCents: p.cashCents, creditCents: 0 };
  if (!p.allowCredit) return { ok: false, reason: "overpayment", excessCents: excess };
  return { ok: true, appliedCents: p.cashCents - excess, creditCents: excess };
}

/**
 * FR-PAY-06: suggested WHT for settling `settleCents` of an invoice, worked on
 * the pre-VAT share of that amount: rate × settle × (total − tax) / total.
 */
export function suggestedWhtCents(p: {
  totalCents: number;
  taxCents: number;
  settleCents: number;
  rateBp: number;
}): number {
  if (p.totalCents <= 0 || p.settleCents <= 0) return 0;
  // BigInt: settle × pre-VAT total can pass 2^53 on large invoices.
  const n = BigInt(p.settleCents) * BigInt(p.totalCents - p.taxCents);
  const d = BigInt(p.totalCents);
  const preVat = Number((n * 2n + d) / (d * 2n));
  return applyBp(preVat, p.rateBp);
}

export interface JobBalance {
  /** What the client approved on the quote. */
  approvedTotalCents: number;
  /** Settled across every live invoice of that quote. */
  paidCents: number;
  /** Still owed on the job, invoiced or not. */
  remainingCents: number;
}

/**
 * Where a whole approved quote stands (owner request: an 85% deposit paid in
 * full must not read as the job paid in full). Settled per invoice, as above.
 */
export function jobBalance(approvedTotalCents: number, settledPerInvoice: number[]): JobBalance {
  const paidCents = settledPerInvoice.reduce((sum, s) => sum + s, 0);
  return { approvedTotalCents, paidCents, remainingCents: Math.max(0, approvedTotalCents - paidCents) };
}
