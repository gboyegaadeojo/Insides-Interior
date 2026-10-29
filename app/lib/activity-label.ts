// Human wording for activity rows (timelines on client, project and document pages).

import { BUSINESS_TZ, LOCALE } from "~/domain/locale";
import { formatCents } from "~/domain/money";

const LABELS: Record<string, string> = {
  "client.created": "Client added",
  "client.updated": "Details updated",
  "client.archived": "Client archived",
  "client.restored": "Client restored",
  "client.contact_added": "Contact added",
  "client.contact_updated": "Contact updated",
  "client.contact_removed": "Contact removed",
  "client.site_added": "Site added",
  "client.site_updated": "Site updated",
  "client.site_removed": "Site removed",
  "project.created": "Project created",
  "project.updated": "Project updated",
  "project.completed": "Project completed",
  "project.active": "Project reopened",
  "project.archived": "Project archived",
  "project.cover_updated": "Cover photo changed",
  "quote.created": "Draft started",
  "quote.duplicated": "Duplicated",
  "quote.sent": "Sent",
  "quote.revision_started": "Revision started",
  "quote.revision_discarded": "Revision discarded",
  "quote.revision_sent": "Revision sent",
  "quote.viewed": "Opened by the client",
  "quote.approved": "Approved",
  "quote.changes_requested": "Changes requested",
  "quote.expired": "Expired",
  "quote.extended": "Valid-until date extended",
  "quote.link_rotated": "New client link made",
  "quote.email_retried": "Email retried",
  "invoice.created": "Draft started",
  "invoice.sent": "Sent",
  "invoice.revision_started": "Revision started",
  "invoice.revision_discarded": "Revision discarded",
  "invoice.revision_sent": "Revision sent",
  "invoice.viewed": "Opened by the client",
  "invoice.changes_requested": "Client sent a message",
  "invoice.voided": "Voided",
  "invoice.link_rotated": "New client link made",
  "invoice.email_retried": "Email retried",
  "payment.recorded": "Payment recorded",
  "payment.deleted": "Payment deleted",
};

const DETAIL: Record<string, (data: Record<string, unknown>) => string | undefined> = {
  "quote.sent": (d) => (d.to ? `to ${d.to}` : undefined),
  "quote.revision_sent": (d) => (d.revision ? `rev ${d.revision}${d.to ? ` to ${d.to}` : ""}` : undefined),
  "quote.approved": (d) => (d.signer ? `by ${d.signer}` : undefined),
  "quote.changes_requested": (d) => (d.name ? `by ${d.name}` : undefined),
  "invoice.sent": (d) => (d.to ? `to ${d.to}` : undefined),
  "invoice.revision_sent": (d) => (d.revision ? `rev ${d.revision}${d.to ? ` to ${d.to}` : ""}` : undefined),
  "invoice.changes_requested": (d) => (d.name ? `(${d.name})` : undefined),
  "invoice.voided": (d) => (d.reason ? `: ${d.reason}` : undefined),
  "invoice.created": (d) =>
    d.fromQuote ? `from quote ${d.fromQuote}` : d.reissueOf ? `reissuing ${d.reissueOf}` : undefined,
  "payment.recorded": (d) =>
    typeof d.amountCents === "number"
      ? `: ${formatCents(d.amountCents)}${typeof d.whtCents === "number" && d.whtCents > 0 ? ` + WHT ${formatCents(d.whtCents)}` : ""}`
      : undefined,
  "payment.deleted": (d) => (d.reason ? `: ${d.reason}` : undefined),
};

export function activityLabel(action: string, data?: Record<string, unknown> | null): string {
  const base = LABELS[action] ?? action.replaceAll(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const extra = data ? DETAIL[action]?.(data) : undefined;
  // "Voided: reason" joins without a space; "Sent to x" with one.
  if (extra) return extra.startsWith(":") ? `${base}${extra}` : `${base} ${extra}`;
  const detail = (data?.contact ?? data?.site) as string | undefined;
  return detail ? `${base}: ${detail}` : base;
}

const RELATIVE = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const DATE = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: BUSINESS_TZ,
});

/** "2 hours ago", "yesterday", or a date for anything older than a week. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return RELATIVE.format(Math.round(seconds / 86400), "day");
  return DATE.format(new Date(iso));
}
