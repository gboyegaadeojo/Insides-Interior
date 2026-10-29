// Quote and invoice state machines (SPEC 5.13). Only the server performs
// transitions, always through `transition`, so a forbidden move is impossible.

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "changes_requested",
  "approved",
  "declined",
  "expired",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_EVENTS = [
  "send",
  "view",
  "approve",
  "request_changes",
  "send_revision",
  "decline",
  "expire",
  // Owner reopens a sent quote as a draft for revision N+1 (FR-QT-09); it
  // keeps its number and goes out again with `send`.
  "revise",
  // Owner extends the valid-until date of an expired quote (FR-QT-11).
  "extend",
] as const;
export type QuoteEvent = (typeof QUOTE_EVENTS)[number];

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "changes_requested",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_EVENTS = [
  "send",
  "view",
  "request_changes",
  "send_revision",
  "void",
  "partial_payment",
  "full_payment",
  "mark_overdue",
] as const;
export type InvoiceEvent = (typeof INVOICE_EVENTS)[number];

type Machine<S extends string, E extends string> = Partial<Record<S, Partial<Record<E, S>>>>;

export const QUOTE_MACHINE: Machine<QuoteStatus, QuoteEvent> = {
  draft: { send: "sent" },
  sent: { view: "viewed", request_changes: "changes_requested", expire: "expired", revise: "draft" },
  viewed: {
    // A client re-opening the link keeps the quote viewed.
    view: "viewed",
    approve: "approved",
    request_changes: "changes_requested",
    decline: "declined",
    expire: "expired",
    revise: "draft",
  },
  changes_requested: { send_revision: "sent", request_changes: "changes_requested", revise: "draft" },
  expired: { extend: "sent", revise: "draft" },
};

export const INVOICE_MACHINE: Machine<InvoiceStatus, InvoiceEvent> = {
  draft: { send: "sent" },
  sent: {
    view: "viewed",
    request_changes: "changes_requested",
    partial_payment: "partially_paid",
    full_payment: "paid",
    mark_overdue: "overdue",
    void: "void",
  },
  viewed: {
    view: "viewed",
    request_changes: "changes_requested",
    partial_payment: "partially_paid",
    full_payment: "paid",
    mark_overdue: "overdue",
    // Not drawn in the 5.13 diagram, but an unpaid invoice the client has
    // opened must still be voidable (docs/decisions.md).
    void: "void",
  },
  changes_requested: {
    request_changes: "changes_requested",
    // Revised under the same number only while unpaid (SPEC 0.2 "Revised").
    send_revision: "sent",
    void: "void",
    // Payments during an open request still update the balance (SPEC 5.13);
    // the request stays open until the owner resolves it.
    partial_payment: "changes_requested",
    full_payment: "paid",
  },
  partially_paid: {
    partial_payment: "partially_paid",
    full_payment: "paid",
    mark_overdue: "overdue",
    // "Invoices with payments are voided and reissued" (SPEC 0.2, CLAUDE.md).
    void: "void",
  },
  overdue: {
    partial_payment: "overdue",
    full_payment: "paid",
    void: "void",
  },
};

export class TransitionError extends Error {
  constructor(
    readonly kind: "quote" | "invoice",
    readonly from: string,
    readonly event: string,
  ) {
    super(`A ${kind} that is ${from.replaceAll("_", " ")} can't ${event.replaceAll("_", " ")}`);
    this.name = "TransitionError";
  }
}

export function quoteTransition(from: QuoteStatus, event: QuoteEvent): QuoteStatus {
  const to = QUOTE_MACHINE[from]?.[event];
  if (!to) throw new TransitionError("quote", from, event);
  return to;
}

export function invoiceTransition(from: InvoiceStatus, event: InvoiceEvent): InvoiceStatus {
  const to = INVOICE_MACHINE[from]?.[event];
  if (!to) throw new TransitionError("invoice", from, event);
  return to;
}

export function canQuote(from: QuoteStatus, event: QuoteEvent): boolean {
  return QUOTE_MACHINE[from]?.[event] !== undefined;
}

export function canInvoice(from: InvoiceStatus, event: InvoiceEvent): boolean {
  return INVOICE_MACHINE[from]?.[event] !== undefined;
}

/** Sent documents are immutable; edits create a new revision (CLAUDE.md). */
export function isEditableDraft(status: QuoteStatus | InvoiceStatus): boolean {
  return status === "draft";
}
