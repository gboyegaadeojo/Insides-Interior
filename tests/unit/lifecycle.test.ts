import { describe, expect, it } from "vitest";
import {
  INVOICE_EVENTS,
  INVOICE_STATUSES,
  invoiceTransition,
  QUOTE_EVENTS,
  QUOTE_STATUSES,
  quoteTransition,
  TransitionError,
} from "~/domain/lifecycle";

// Every allowed transition from SPEC 5.13, written out independently of the
// machine so a typo in either shows up.
const QUOTE_ALLOWED: Record<string, string> = {
  "draft:send": "sent",
  "sent:view": "viewed",
  "viewed:view": "viewed",
  "viewed:approve": "approved",
  "sent:request_changes": "changes_requested",
  "viewed:request_changes": "changes_requested",
  "changes_requested:request_changes": "changes_requested",
  "changes_requested:send_revision": "sent",
  "viewed:decline": "declined",
  "sent:expire": "expired",
  "viewed:expire": "expired",
  // FR-QT-09 revisions and FR-QT-11 extend (docs/decisions.md, phase 5).
  "sent:revise": "draft",
  "viewed:revise": "draft",
  "changes_requested:revise": "draft",
  "expired:revise": "draft",
  "expired:extend": "sent",
  // FR-MSG-05: the last open request declined or answered (phase 7).
  "changes_requested:resolve": "viewed",
};

const INVOICE_ALLOWED: Record<string, string> = {
  "draft:send": "sent",
  "sent:view": "viewed",
  "viewed:view": "viewed",
  "sent:request_changes": "changes_requested",
  "viewed:request_changes": "changes_requested",
  "changes_requested:request_changes": "changes_requested",
  "changes_requested:send_revision": "sent",
  "changes_requested:void": "void",
  "changes_requested:partial_payment": "changes_requested",
  "changes_requested:full_payment": "paid",
  "viewed:partial_payment": "partially_paid",
  "viewed:full_payment": "paid",
  "sent:partial_payment": "partially_paid",
  "sent:full_payment": "paid",
  "partially_paid:partial_payment": "partially_paid",
  "partially_paid:full_payment": "paid",
  "sent:mark_overdue": "overdue",
  "viewed:mark_overdue": "overdue",
  "partially_paid:mark_overdue": "overdue",
  "overdue:partial_payment": "overdue",
  "overdue:full_payment": "paid",
  "sent:void": "void",
  "overdue:void": "void",
  // Beyond the diagram, required by SPEC 0.2 (void and reissue when paid).
  "viewed:void": "void",
  "partially_paid:void": "void",
  // FR-INV-06: unpaid invoices are revised under the same number.
  "sent:revise": "draft",
  "viewed:revise": "draft",
  "changes_requested:revise": "draft",
  "overdue:revise": "draft",
  // FR-MSG-07: an open request shows whatever has been paid (phase 7).
  "partially_paid:request_changes": "changes_requested",
  "overdue:request_changes": "changes_requested",
  "changes_requested:resolve": "viewed",
};

describe("quote lifecycle (SPEC 5.13)", () => {
  for (const from of QUOTE_STATUSES) {
    for (const event of QUOTE_EVENTS) {
      const key = `${from}:${event}`;
      const expected = QUOTE_ALLOWED[key];
      it(expected ? `${key} → ${expected}` : `${key} is forbidden`, () => {
        if (expected) expect(quoteTransition(from, event)).toBe(expected);
        else expect(() => quoteTransition(from, event)).toThrow(TransitionError);
      });
    }
  }

  it("approved and declined are terminal", () => {
    for (const from of ["approved", "declined"] as const) {
      for (const event of QUOTE_EVENTS) expect(() => quoteTransition(from, event)).toThrow();
    }
  });

  it("explains a forbidden move in plain words", () => {
    expect(() => quoteTransition("draft", "approve")).toThrow("A quote that is draft can't approve");
  });
});

describe("invoice lifecycle (SPEC 5.13)", () => {
  for (const from of INVOICE_STATUSES) {
    for (const event of INVOICE_EVENTS) {
      const key = `${from}:${event}`;
      const expected = INVOICE_ALLOWED[key];
      it(expected ? `${key} → ${expected}` : `${key} is forbidden`, () => {
        if (expected) expect(invoiceTransition(from, event)).toBe(expected);
        else expect(() => invoiceTransition(from, event)).toThrow(TransitionError);
      });
    }
  }

  it("paid and void are terminal", () => {
    for (const from of ["paid", "void"] as const) {
      for (const event of INVOICE_EVENTS) expect(() => invoiceTransition(from, event)).toThrow();
    }
  });

  it("an invoice with payments can't be revised in place", () => {
    expect(() => invoiceTransition("partially_paid", "send_revision")).toThrow();
    expect(() => invoiceTransition("partially_paid", "revise")).toThrow();
  });
});
