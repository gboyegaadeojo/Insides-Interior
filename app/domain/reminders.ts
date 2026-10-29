// Whether an automatic reminder may go out for an invoice (SPEC 5.9, 5.13,
// FR-MSG-07). Phase 8's daily job sends them; the rule lives here so it is the
// same everywhere and tested on its own. A reminder never goes out while the
// payer has an open change request, whatever the status says.

import type { InvoiceStatus } from "./lifecycle";

const REMINDABLE: InvoiceStatus[] = ["sent", "viewed", "partially_paid", "overdue"];

export type ReminderBlock = "status" | "paused" | "open_request" | "nothing_due";

export function reminderBlock(invoice: {
  status: InvoiceStatus;
  remindersPaused: boolean;
  openRequests: number;
  balanceCents: number;
}): ReminderBlock | null {
  if (invoice.openRequests > 0 || invoice.status === "changes_requested") return "open_request";
  if (!REMINDABLE.includes(invoice.status)) return "status";
  if (invoice.remindersPaused) return "paused";
  if (invoice.balanceCents <= 0) return "nothing_due";
  return null;
}
