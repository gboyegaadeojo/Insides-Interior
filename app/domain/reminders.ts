// Automatic payment reminders and quote follow-ups (SPEC 5.9, 5.13, FR-MSG-07).
// Pure: the daily job asks these which step (if any) is due today, so the rule
// is the same everywhere and tested on its own. A reminder never goes out
// while the payer has an open change request, whatever the status says.

import { addDays } from "~/lib/dates";
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

/**
 * The cadence step to send today, or null. Steps are days from `base`; each
 * is sent at most once (`sent`). If the job missed a day only the latest step
 * that has come due goes out, and never one older than a step already sent,
 * so a client gets one email per step, not a burst. Steps on or before
 * `notBefore` (the day the document itself was sent) are skipped: the client
 * just got the document.
 */
export function dueStep(p: {
  base: string;
  today: string;
  steps: number[];
  sent: number[];
  notBefore?: string | null;
  max?: number;
}): number | null {
  if (p.max !== undefined && p.sent.length >= p.max) return null;
  const due = p.steps.filter((step) => {
    const day = addDays(p.base, step);
    return day <= p.today && (!p.notBefore || day > p.notBefore);
  });
  if (due.length === 0) return null;
  const latest = Math.max(...due);
  if (p.sent.some((s) => s >= latest)) return null;
  return latest;
}

/** Days from the due date: negative before it, 0 on it, positive when late. */
export function daysPastDue(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

/** "due in 3 days", "due today", "7 days overdue": the reminder headline. */
export function dueWording(days: number): string {
  if (days < 0) return `due in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}
