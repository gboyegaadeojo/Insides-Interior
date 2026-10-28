// Email merge fields (FR-SET-07): `{client.firstName}`, `{invoice.number}`,
// `{amount.due}`, `{link}` … Unknown fields are left visible so a typo is
// obvious in the live preview rather than silently blank.

export type MergeValues = Record<string, string | undefined>;

export const MERGE_FIELDS = [
  "client.firstName",
  "client.name",
  "business.name",
  "quote.number",
  "invoice.number",
  "amount.total",
  "amount.due",
  "date.due",
  "link",
] as const;

export function renderMergeFields(template: string, values: MergeValues): string {
  return template.replace(/\{([a-zA-Z]+(?:\.[a-zA-Z]+)?)\}/g, (match, key: string) => values[key] ?? match);
}

/** Fields used in a template that aren't known. */
export function unknownMergeFields(template: string): string[] {
  const known = new Set<string>(MERGE_FIELDS);
  return [...template.matchAll(/\{([a-zA-Z]+(?:\.[a-zA-Z]+)?)\}/g)]
    .map((m) => m[1]!)
    .filter((k) => !known.has(k));
}

export interface EmailTemplateDefault {
  label: string;
  subject: string;
  body: string;
  /** The sample values used for the live preview. */
  sample: MergeValues;
}

const SAMPLE: MergeValues = {
  "client.firstName": "Amelia",
  "client.name": "Amelia Chen",
  "business.name": "Insides Interior",
  "quote.number": "Q-1042",
  "invoice.number": "INV-1042",
  "amount.total": "$534.67",
  "amount.due": "$267.33",
  "date.due": "Nov 12, 2026",
  link: "https://app.example.ca/i/…",
};

// SPEC 9.4 client-facing templates whose wording the owner can change.
export const EMAIL_TEMPLATE_DEFAULTS: Record<string, EmailTemplateDefault> = {
  quote_sent: {
    label: "Quote sent",
    subject: "Your quote {quote.number} from {business.name}",
    body: "Hi {client.firstName},\n\nHere is your quote {quote.number} for {amount.total}. You can review it, choose options and approve it online.",
    sample: SAMPLE,
  },
  quote_follow_up: {
    label: "Quote follow-up",
    subject: "Following up on quote {quote.number}",
    body: "Hi {client.firstName},\n\nJust checking in on quote {quote.number}. Happy to answer any questions or adjust anything.",
    sample: SAMPLE,
  },
  invoice_sent: {
    label: "Invoice sent",
    subject: "Invoice {invoice.number} from {business.name}",
    body: "Hi {client.firstName},\n\nHere is invoice {invoice.number} for {amount.due}, due {date.due}. Payment details are on the invoice.",
    sample: SAMPLE,
  },
  payment_reminder: {
    label: "Payment reminder",
    subject: "Reminder: invoice {invoice.number} is due {date.due}",
    body: "Hi {client.firstName},\n\nA friendly reminder that {amount.due} on invoice {invoice.number} is due {date.due}.",
    sample: SAMPLE,
  },
  payment_receipt: {
    label: "Payment receipt",
    subject: "Thank you: payment received for {invoice.number}",
    body: "Hi {client.firstName},\n\nThank you, we've received your payment for invoice {invoice.number}. Balance remaining: {amount.due}.",
    sample: SAMPLE,
  },
};
