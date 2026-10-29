// Email templates (SPEC 9.4). Premium, on-brand HTML plus a plain-text part:
// logo or name, brand-colour rule, display serif headline, one 48px button
// (full width on phone), business address in the footer. Hand-built HTML
// strings rather than React Email: rendering React on Workers Free's 10 ms CPU
// budget isn't worth it for a handful of templates (docs/decisions.md).

import { renderMergeFields, type MergeValues } from "~/lib/merge-fields";
import type { EmailTemplateOverride } from "~/server/db/schema";

export interface Brand {
  name: string;
  brandColor: string;
  logoUrl?: string;
  address?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// The app's warm neutrals (app/styles/tokens.ts), inlined because mail clients
// don't read CSS variables.
const INK = "#24211E";
const BODY = "#3D3731";
const MUTED = "#68615A";
const CANVAS = "#F5F5F4";
const LINE = "#E2DDD4";
const FALLBACK_BRAND = "#0F766E";

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Text colour on the brand colour: white unless the brand is light. */
function onBrand(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? INK : "#FFFFFF";
}

const SANS = "Inter,-apple-system,'Segoe UI',Roboto,sans-serif";

export function layout(
  brand: Brand,
  opts: {
    preheader: string;
    headline: string;
    body: string[];
    /** Key facts shown as a small table: number, total, valid until. */
    facts?: [label: string, value: string][];
    /** A quoted message from the client, shown in a soft panel. */
    quote?: string;
    button: { label: string; url: string };
    footnote?: string;
  },
): { html: string; text: string } {
  const color = /^#[0-9a-f]{6}$/i.test(brand.brandColor) ? brand.brandColor : FALLBACK_BRAND;
  const header = brand.logoUrl
    ? `<img src="${escape(brand.logoUrl)}" alt="${escape(brand.name)}" height="40" style="display:block;height:40px;border:0">`
    : `<span style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:${INK}">${escape(brand.name)}</span>`;
  const facts = opts.facts?.length
    ? `<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}">${opts.facts
        .map(
          ([label, value]) =>
            `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${escape(label)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:16px;font-weight:600;color:${INK}">${escape(value)}</td></tr>`,
        )
        .join("")}</table></td></tr>`
    : "";
  const quoted = opts.quote
    ? `<tr><td style="padding:16px 28px 0"><div style="padding:14px 16px;background:${CANVAS};border-left:3px solid ${color};border-radius:4px;font-family:${SANS};font-size:15px;line-height:1.5;color:${BODY};white-space:pre-line">${escape(opts.quote)}</div></td></tr>`
    : "";
  const html = `<!doctype html>
<html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(opts.headline)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS}">
<span style="display:none;max-height:0;overflow:hidden">${escape(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${LINE};border-radius:16px">
<tr><td style="padding:28px 28px 0">${header}</td></tr>
<tr><td style="padding:16px 28px 0"><div style="height:1px;background:${color}"></div></td></tr>
<tr><td style="padding:24px 28px 0;font-family:Fraunces,Georgia,serif;font-size:28px;line-height:1.2;font-weight:500;color:${INK}">${escape(opts.headline)}</td></tr>
${opts.body.map((p) => `<tr><td style="padding:12px 28px 0;font-family:${SANS};font-size:16px;line-height:1.5;color:${BODY}">${escape(p)}</td></tr>`).join("\n")}
${quoted}
${facts}
<tr><td style="padding:24px 28px 8px">
<a href="${escape(opts.button.url)}" style="display:block;text-align:center;background:${color};color:${onBrand(color)};font-family:${SANS};font-size:16px;font-weight:600;line-height:48px;height:48px;border-radius:10px;text-decoration:none">${escape(opts.button.label)}</a>
</td></tr>
${opts.footnote ? `<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:13px;line-height:1.4;color:${MUTED}">${escape(opts.footnote)}</td></tr>` : ""}
<tr><td style="padding:24px 28px 28px;font-family:${SANS};font-size:12px;line-height:1.4;color:${MUTED}">${escape(brand.name)}${brand.address ? ` · ${escape(brand.address)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    opts.headline,
    "",
    ...opts.body,
    ...(opts.quote ? ["", ...opts.quote.split("\n").map((l) => `> ${l}`)] : []),
    ...(opts.facts?.length ? ["", ...opts.facts.map(([l, v]) => `${l}: ${v}`)] : []),
    "",
    `${opts.button.label}: ${opts.button.url}`,
    ...(opts.footnote ? ["", opts.footnote] : []),
    "",
    brand.name + (brand.address ? `, ${brand.address}` : ""),
  ].join("\n");
  return { html, text };
}

function firstName(name: string | undefined | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

/** Owner-editable wording (FR-SET-07): paragraphs split on blank lines. */
function paragraphs(body: string) {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Sign-in link (SPEC 9.4). */
export function signInEmail(
  brand: Brand,
  url: string,
  opts: { invited?: boolean; name?: string } = {},
): RenderedEmail {
  const headline = opts.invited ? `You're invited to ${brand.name}` : `Sign in to ${brand.name}`;
  const greeting = opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : "Hi,";
  const { html, text } = layout(brand, {
    preheader: "Your sign-in link is inside. It works once and expires in 15 minutes.",
    headline,
    body: [
      greeting,
      opts.invited
        ? `You've been added to the ${brand.name} quotes and invoicing app. Tap the button to sign in.`
        : "Tap the button to sign in. The link works once and expires in 15 minutes.",
    ],
    button: { label: "Sign in", url },
    footnote: "If you didn't ask for this, you can ignore this email; nobody can sign in without the link.",
  });
  return { subject: headline, html, text };
}

export interface QuoteEmailFacts {
  number: string;
  /** Formatted, e.g. "₦121,950.56". */
  total: string;
  validUntil?: string;
  deposit?: string;
}

/**
 * Quote sent, or a revision re-sent (SPEC 9.4 "Quote sent", "Revised quote").
 * The owner's wording from Settings → Email replaces the default subject and
 * opening (FR-SET-07); the facts table and button are always added.
 */
export function quoteSentEmail(
  brand: Brand,
  opts: {
    clientName: string;
    facts: QuoteEmailFacts;
    url: string;
    revision?: number;
    note?: string;
    override?: EmailTemplateOverride;
    defaults: EmailTemplateOverride;
    changes?: RevisionChanges;
  },
): RenderedEmail {
  const values: MergeValues = {
    "client.firstName": firstName(opts.clientName),
    "client.name": opts.clientName,
    "business.name": brand.name,
    "quote.number": opts.facts.number,
    "amount.total": opts.facts.total,
    link: opts.url,
  };
  const wording = opts.override ?? opts.defaults;
  const revised = (opts.revision ?? 1) > 1;
  const subject = revised
    ? `Revised quote ${opts.facts.number} (rev ${opts.revision}) from ${brand.name}`
    : renderMergeFields(wording.subject, values);
  const body = paragraphs(renderMergeFields(wording.body, values));
  if (revised) {
    body.push(...changesBody(opts.changes));
    body.push("This revision replaces the earlier version; the earlier link no longer works.");
  }
  const { html, text } = layout(brand, {
    preheader: `${opts.facts.number} · ${opts.facts.total}${opts.facts.validUntil ? ` · valid until ${opts.facts.validUntil}` : ""}`,
    headline: revised ? `Your revised quote is ready` : `Your quote is ready`,
    body,
    quote: opts.note?.trim() || undefined,
    facts: [
      ["Quote", revised ? `${opts.facts.number} · rev ${opts.revision}` : opts.facts.number],
      ...(revised ? changesFacts(opts.changes) : []),
      ["Total", opts.facts.total],
      ...(opts.facts.deposit ? ([["Deposit on approval", opts.facts.deposit]] as [string, string][]) : []),
      ...(opts.facts.validUntil ? ([["Valid until", opts.facts.validUntil]] as [string, string][]) : []),
    ],
    button: { label: revised ? "See what changed" : "View your quote", url: opts.url },
    footnote: "The PDF is attached for your records. You can choose options and approve online.",
  });
  return { subject, html, text };
}

/** Quote approved, to the client (SPEC 9.4). */
export function quoteApprovedClientEmail(
  brand: Brand,
  opts: { signerName: string; facts: QuoteEmailFacts; url: string },
): RenderedEmail {
  const subject = `Approved: quote ${opts.facts.number} from ${brand.name}`;
  const { html, text } = layout(brand, {
    preheader: `Thank you. ${brand.name} has your approval and will be in touch about next steps.`,
    headline: "Thank you for your approval",
    body: [
      `Hi ${firstName(opts.signerName)},`,
      `We've received your approval of quote ${opts.facts.number}. ${brand.name} will be in touch about next steps${opts.facts.deposit ? " and the deposit invoice" : ""}.`,
    ],
    facts: [
      ["Quote", opts.facts.number],
      ["Approved total", opts.facts.total],
      ...(opts.facts.deposit ? ([["Deposit", opts.facts.deposit]] as [string, string][]) : []),
    ],
    button: { label: "View approved quote", url: opts.url },
  });
  return { subject, html, text };
}

/** Quote approved, to each owner (SPEC 9.4). */
export function quoteApprovedOwnerEmail(
  brand: Brand,
  opts: { clientName: string; signerName: string; facts: QuoteEmailFacts; url: string },
): RenderedEmail {
  const subject = `${opts.clientName} approved quote ${opts.facts.number}`;
  const { html, text } = layout(brand, {
    preheader: `${opts.facts.total} approved by ${opts.signerName}.`,
    headline: `${opts.facts.number} is approved`,
    body: [
      `${opts.signerName} approved the quote for ${opts.clientName}. A project has been created and ${opts.facts.deposit ? "the deposit invoice" : "an invoice for the approved total"} is drafted for you to check and send.`,
    ],
    facts: [
      ["Approved total", opts.facts.total],
      ...(opts.facts.deposit ? ([["Deposit", opts.facts.deposit]] as [string, string][]) : []),
    ],
    button: { label: "Open quote", url: opts.url },
  });
  return { subject, html, text };
}

/**
 * New message or change request, to each owner (SPEC 9.4). A change request
 * names the line and what was asked (`about`, e.g. "Remove this item: Cushions").
 */
export function changesRequestedOwnerEmail(
  brand: Brand,
  opts: {
    noun: "quote" | "invoice";
    clientName: string;
    authorName: string;
    number: string;
    message: string;
    url: string;
    /** Absent for a plain message. */
    about?: string;
  },
): RenderedEmail {
  const request = opts.about !== undefined;
  const subject = request
    ? `${opts.clientName} asked for a change to ${opts.number}`
    : `New message from ${opts.clientName} about ${opts.number}`;
  const { html, text } = layout(brand, {
    preheader: (opts.about ? `${opts.about}. ` : "") + opts.message.slice(0, 120),
    headline: request ? "Change requested" : "New message",
    body: [
      request
        ? `${opts.authorName} asked for a change to ${opts.noun} ${opts.number}: ${opts.about}.`
        : `${opts.authorName} wrote about ${opts.noun} ${opts.number}:`,
    ],
    quote: opts.message || undefined,
    button: { label: "Open conversation", url: opts.url },
    footnote: request
      ? `Accept, decline or reply from the app. Nothing changes on the ${opts.noun} until you send a revision.`
      : "Reply from the app; the client gets your answer by email.",
  });
  return { subject, html, text };
}

/**
 * The owner replied or resolved change requests, to the payer (SPEC 9.4 "Owner
 * reply"). `outcomes` lists each resolution in plain words.
 */
export function ownerReplyEmail(
  brand: Brand,
  opts: {
    noun: "quote" | "invoice";
    clientName: string;
    number: string;
    message?: string;
    outcomes?: string[];
    url: string;
  },
): RenderedEmail {
  const subject = `${brand.name} replied about ${opts.noun} ${opts.number}`;
  const body = [`Hi ${firstName(opts.clientName)},`];
  if (opts.outcomes?.length) {
    body.push(
      `${brand.name} has looked at your request${opts.outcomes.length === 1 ? "" : "s"} about ${opts.noun} ${opts.number}:`,
      ...opts.outcomes,
    );
  } else {
    body.push(`${brand.name} replied about ${opts.noun} ${opts.number}:`);
  }
  const { html, text } = layout(brand, {
    preheader: (opts.message ?? opts.outcomes?.join(" ") ?? "").slice(0, 120),
    headline: opts.outcomes?.length ? "An update on your request" : "You have a reply",
    body,
    quote: opts.message?.trim() || undefined,
    button: { label: "View conversation", url: opts.url },
    footnote: "You can reply on the same page; there's no need to sign in.",
  });
  return { subject, html, text };
}

/** "What changed" for a revised quote or invoice email (FR-MSG-06). */
export interface RevisionChanges {
  lines: string[];
  totalBefore: string;
  totalAfter: string;
}

function changesBody(changes: RevisionChanges | undefined): string[] {
  if (!changes || changes.lines.length === 0) return [];
  return ["What changed:", ...changes.lines.map((l) => `• ${l}`)];
}

function changesFacts(changes: RevisionChanges | undefined): [string, string][] {
  return changes && changes.totalBefore !== changes.totalAfter
    ? [["Previous total", changes.totalBefore]]
    : [];
}

export interface InvoiceEmailFacts {
  number: string;
  /** Formatted amounts and dates. */
  total: string;
  due: string;
  dueDate?: string;
}

/** Invoice sent, or a revision re-sent under the same number (SPEC 9.4, FR-INV-05/06). */
export function invoiceSentEmail(
  brand: Brand,
  opts: {
    clientName: string;
    facts: InvoiceEmailFacts;
    url: string;
    revision?: number;
    note?: string;
    override?: EmailTemplateOverride;
    defaults: EmailTemplateOverride;
    changes?: RevisionChanges;
  },
): RenderedEmail {
  const values: MergeValues = {
    "client.firstName": firstName(opts.clientName),
    "client.name": opts.clientName,
    "business.name": brand.name,
    "invoice.number": opts.facts.number,
    "amount.total": opts.facts.total,
    "amount.due": opts.facts.due,
    "date.due": opts.facts.dueDate,
    link: opts.url,
  };
  const wording = opts.override ?? opts.defaults;
  const revised = (opts.revision ?? 1) > 1;
  const subject = revised
    ? `Revised invoice ${opts.facts.number} (rev ${opts.revision}) from ${brand.name}`
    : renderMergeFields(wording.subject, values);
  const body = paragraphs(renderMergeFields(wording.body, values));
  if (revised) {
    body.push(...changesBody(opts.changes));
    body.push("This revision replaces the earlier version; the earlier link no longer works.");
  }
  const { html, text } = layout(brand, {
    preheader: `${opts.facts.number} · ${opts.facts.due} due${opts.facts.dueDate ? ` ${opts.facts.dueDate}` : ""}`,
    headline: revised ? "Your revised invoice" : "Your invoice is ready",
    body,
    quote: opts.note?.trim() || undefined,
    facts: [
      ["Invoice", revised ? `${opts.facts.number} · rev ${opts.revision}` : opts.facts.number],
      ...(revised ? changesFacts(opts.changes) : []),
      ["Amount due", opts.facts.due],
      ...(opts.facts.dueDate ? ([["Due", opts.facts.dueDate]] as [string, string][]) : []),
    ],
    button: { label: revised ? "See what changed" : "View invoice", url: opts.url },
    footnote: "The PDF is attached. Payment details are on the invoice.",
  });
  return { subject, html, text };
}

/** Payment receipt (SPEC 9.4, FR-PAY-03): amount, method and what's left to pay. */
export function paymentReceiptEmail(
  brand: Brand,
  opts: {
    clientName: string;
    number: string;
    amount: string;
    wht?: string;
    method: string;
    receivedOn: string;
    balance: string;
    paidInFull: boolean;
    url: string;
    override?: EmailTemplateOverride;
    defaults: EmailTemplateOverride;
  },
): RenderedEmail {
  const values: MergeValues = {
    "client.firstName": firstName(opts.clientName),
    "client.name": opts.clientName,
    "business.name": brand.name,
    "invoice.number": opts.number,
    "amount.due": opts.balance,
    link: opts.url,
  };
  const wording = opts.override ?? opts.defaults;
  const { html, text } = layout(brand, {
    preheader: `${opts.amount} received for ${opts.number}. ${opts.paidInFull ? "Paid in full." : `Balance ${opts.balance}.`}`,
    headline: opts.paidInFull ? "Paid in full, thank you" : "Payment received, thank you",
    body: paragraphs(renderMergeFields(wording.body, values)),
    facts: [
      ["Invoice", opts.number],
      ["Received", opts.amount],
      ...(opts.wht ? ([["Withholding tax", opts.wht]] as [string, string][]) : []),
      ["Method", opts.method],
      ["Date", opts.receivedOn],
      ["Balance remaining", opts.balance],
    ],
    button: { label: "View receipt", url: opts.url },
  });
  return { subject: renderMergeFields(wording.subject, values), html, text };
}

/**
 * Payment reminder before, on or after the due date (SPEC 9.4, FR-AUTO-01).
 * The owner's wording (Settings → Email) opens it; the headline says where the
 * invoice stands ("due in 3 days", "7 days overdue").
 */
export function paymentReminderEmail(
  brand: Brand,
  opts: {
    clientName: string;
    number: string;
    due: string;
    dueDate: string;
    /** From domain/reminders dueWording. */
    standing: string;
    overdue: boolean;
    url: string;
    override?: EmailTemplateOverride;
    defaults: EmailTemplateOverride;
  },
): RenderedEmail {
  const values: MergeValues = {
    "client.firstName": firstName(opts.clientName),
    "client.name": opts.clientName,
    "business.name": brand.name,
    "invoice.number": opts.number,
    "amount.due": opts.due,
    "date.due": opts.dueDate,
    link: opts.url,
  };
  const wording = opts.override ?? opts.defaults;
  const { html, text } = layout(brand, {
    preheader: `${opts.due} on ${opts.number}, ${opts.standing}.`,
    headline: `Invoice ${opts.number} is ${opts.standing}`,
    body: paragraphs(renderMergeFields(wording.body, values)),
    facts: [
      ["Invoice", opts.number],
      ["Amount due", opts.due],
      [opts.overdue ? "Was due" : "Due", opts.dueDate],
    ],
    button: { label: "View and pay", url: opts.url },
    footnote: "Already paid? Thank you, please ignore this; it can take a day or two to show.",
  });
  return { subject: renderMergeFields(wording.subject, values), html, text };
}

/** Quote follow-up while the client hasn't answered (SPEC 9.4). */
export function quoteFollowUpEmail(
  brand: Brand,
  opts: {
    clientName: string;
    number: string;
    total: string;
    validUntil?: string;
    url: string;
    override?: EmailTemplateOverride;
    defaults: EmailTemplateOverride;
  },
): RenderedEmail {
  const values: MergeValues = {
    "client.firstName": firstName(opts.clientName),
    "client.name": opts.clientName,
    "business.name": brand.name,
    "quote.number": opts.number,
    "amount.total": opts.total,
    link: opts.url,
  };
  const wording = opts.override ?? opts.defaults;
  const { html, text } = layout(brand, {
    preheader: `Quote ${opts.number} · ${opts.total}${opts.validUntil ? ` · valid until ${opts.validUntil}` : ""}`,
    headline: "A quick follow-up on your quote",
    body: paragraphs(renderMergeFields(wording.body, values)),
    facts: [
      ["Quote", opts.number],
      ["Total", opts.total],
      ...(opts.validUntil ? ([["Valid until", opts.validUntil]] as [string, string][]) : []),
    ],
    button: { label: "Review your quote", url: opts.url },
    footnote: "You can approve online, or ask for a change right from the quote.",
  });
  return { subject: renderMergeFields(wording.subject, values), html, text };
}

export interface DigestFacts {
  overdue: { count: number; total: string };
  awaiting: { count: number; total: string };
  openRequests: number;
  expiring: { count: number; numbers: string[] };
}

/** Weekly digest to each owner, Monday 07:30 Lagos (SPEC 9.4, FR-AUTO-03). */
export function weeklyDigestEmail(
  brand: Brand,
  opts: { ownerName: string; weekOf: string; facts: DigestFacts; url: string },
): RenderedEmail {
  const { facts } = opts;
  const lines: string[] = [];
  if (facts.overdue.count > 0)
    lines.push(
      `${facts.overdue.count} overdue invoice${facts.overdue.count === 1 ? "" : "s"}, ${facts.overdue.total} outstanding.`,
    );
  if (facts.awaiting.count > 0)
    lines.push(
      `${facts.awaiting.count} quote${facts.awaiting.count === 1 ? "" : "s"} awaiting an answer, ${facts.awaiting.total} in total.`,
    );
  if (facts.openRequests > 0)
    lines.push(
      `${facts.openRequests} conversation${facts.openRequests === 1 ? "" : "s"} with open change requests.`,
    );
  if (facts.expiring.count > 0)
    lines.push(
      `${facts.expiring.count} quote${facts.expiring.count === 1 ? "" : "s"} expiring this week: ${facts.expiring.numbers.join(", ")}.`,
    );
  const { html, text } = layout(brand, {
    preheader: lines[0] ?? "Your week at a glance.",
    headline: `Your week, ${opts.weekOf}`,
    body: [
      `Good morning ${firstName(opts.ownerName)},`,
      "Here's what needs you this week:",
      ...lines.map((l) => `• ${l}`),
    ],
    facts: [
      ["Overdue", `${facts.overdue.count} · ${facts.overdue.total}`],
      ["Awaiting answer", `${facts.awaiting.count} · ${facts.awaiting.total}`],
      ["Open change requests", String(facts.openRequests)],
      ["Expiring this week", String(facts.expiring.count)],
    ],
    button: { label: "Open Home", url: opts.url },
  });
  return {
    subject: `Your week at ${brand.name}: ${lines.length} thing${lines.length === 1 ? "" : "s"} need you`,
    html,
    text,
  };
}

/** An email to a client bounced or was marked as spam (SPEC 9.3 step 4, 9.4). */
export function bounceAlertEmail(
  brand: Brand,
  opts: { to: string; subject: string; complained: boolean; clientName?: string; url: string },
): RenderedEmail {
  const what = opts.complained ? "was marked as spam" : "bounced";
  const { html, text } = layout(brand, {
    preheader: `“${opts.subject}” to ${opts.to} ${what}.`,
    headline: opts.complained ? "An email was marked as spam" : "An email bounced",
    body: [
      `The email “${opts.subject}” to ${opts.to}${opts.clientName ? ` (${opts.clientName})` : ""} ${what}.`,
      opts.complained
        ? "The client may not want these emails. Check with them before sending more."
        : "Check the address on the client's profile. Until it changes, the app warns you before sending to it.",
    ],
    button: { label: "Fix email address", url: opts.url },
  });
  return { subject: `Email to ${opts.to} ${what}`, html, text };
}
