// Drizzle schema for D1 (SPEC 8). Column names are snake_case in SQL
// (`casing: "snake_case"`), camelCase in code.
//
// Conventions (SPEC 8.1): prefixed ULID text ids; business tables carry
// business_id, created_at, updated_at (UTC ISO) and created_by; money in
// integer cents; rates in basis points; quantities in thousandths; soft delete
// via archived_at; sent content frozen in *_revision rows.
//
// Better Auth tables (user, session, account, verification, passkey) follow its
// expected shape: timestamps as integer milliseconds, booleans as integers.

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, sqliteView, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const stamps = {
  createdAt: text().notNull().default(now),
  updatedAt: text().notNull().default(now),
};

const owned = {
  businessId: text()
    .notNull()
    .references(() => business.id),
  ...stamps,
  createdBy: text(),
};

const authTime = () => integer({ mode: "timestamp_ms" });

// ---------- Better Auth ----------

export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  /** `owner` or `staff` (SPEC 11.2). */
  role: text({ enum: ["owner", "staff"] })
    .notNull()
    .default("staff"),
  businessId: text().references(() => business.id),
  /** Staff and owners can be deactivated without losing their history. */
  disabledAt: text(),
  /** Owners only: gets the business emails (approvals, messages, bounces, digest). Owner request 2026-10-31. */
  businessEmails: integer({ mode: "boolean" }).notNull().default(true),
  createdAt: authTime().notNull(),
  updatedAt: authTime().notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: authTime().notNull(),
    token: text().notNull().unique(),
    createdAt: authTime().notNull(),
    updatedAt: authTime().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: authTime(),
    refreshTokenExpiresAt: authTime(),
    scope: text(),
    password: text(),
    createdAt: authTime().notNull(),
    updatedAt: authTime().notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: authTime().notNull(),
    createdAt: authTime().notNull(),
    updatedAt: authTime().notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text().primaryKey(),
    name: text(),
    publicKey: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer().notNull(),
    deviceType: text().notNull(),
    backedUp: integer({ mode: "boolean" }).notNull(),
    transports: text(),
    createdAt: authTime(),
    aaguid: text(),
  },
  (t) => [index("passkey_user_idx").on(t.userId)],
);

// ---------- Business and settings ----------

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export const business = sqliteTable("business", {
  id: text().primaryKey(),
  legalName: text().notNull(),
  tradingName: text(),
  address: text({ mode: "json" }).$type<Address>(),
  phone: text(),
  email: text(),
  website: text(),
  logoKey: text(),
  /** Tax Identification Number (FIRS). */
  tin: text(),
  /** CAC registration number. */
  rcNumber: text(),
  // Column defaults predate the move to Nigeria and are kept (changing a default
  // means rebuilding a parent table, which D1 can't do safely). The seed and
  // migration 0005 set NGN / Africa/Lagos; code never relies on these.
  timezone: text().notNull().default("America/Winnipeg"),
  currency: text().notNull().default("CAD"),
  brandColor: text().notNull().default("#0F766E"),
  /** The owner's signature on every quote and invoice, as SVG made on the server from pad strokes. */
  signatureSvg: text(),
  signatoryName: text(),
  /** e.g. "Managing Director". */
  signatoryTitle: text(),
  ...stamps,
});

export const userPreference = sqliteTable("user_preference", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text({ enum: ["light", "dark", "system"] })
    .notNull()
    .default("system"),
  celebrationsEnabled: integer({ mode: "boolean" }).notNull().default(true),
  density: text({ enum: ["comfortable", "compact"] })
    .notNull()
    .default("comfortable"),
  updatedAt: text().notNull().default(now),
});

export interface ReminderCadence {
  /** Days relative to the due date: negative before, 0 on, positive after. */
  offsets: number[];
  maxCount: number;
  /** Local hours (Africa/Lagos) when nothing is sent, e.g. 21 → 8. */
  quietStartHour: number;
  quietEndHour: number;
  quoteFollowUpDays: number[];
}

export interface EmailTemplateOverride {
  subject: string;
  body: string;
}

export const settings = sqliteTable("settings", {
  businessId: text()
    .primaryKey()
    .references(() => business.id),
  paymentTermsDays: integer().notNull().default(14),
  // The business uses 7 days and 85% (migration 0011, seed); these column
  // defaults predate that and are never relied on (no table rebuild on D1).
  quoteValidDays: integer().notNull().default(30),
  defaultDepositBp: integer().notNull().default(5000),
  defaultNotes: text(),
  defaultTerms: text(),
  /** Bank transfer details printed on invoices (Nigeria). */
  bankName: text(),
  accountName: text(),
  /** 10-digit NUBAN. */
  accountNumber: text(),
  paymentNote: text(),
  reminderCadence: text({ mode: "json" })
    .$type<ReminderCadence>()
    .notNull()
    .default(
      sql`'{"offsets":[-3,0,7,14],"maxCount":4,"quietStartHour":21,"quietEndHour":8,"quoteFollowUpDays":[3,7]}'`,
    ),
  emailTemplates: text({ mode: "json" })
    .$type<Record<string, EmailTemplateOverride>>()
    .notNull()
    .default(sql`'{}'`),
  autoSendReceipts: integer({ mode: "boolean" }).notNull().default(true),
  updatedAt: text().notNull().default(now),
});

export const taxRate = sqliteTable(
  "tax_rate",
  {
    id: text().primaryKey(),
    ...owned,
    name: text().notNull(),
    rateBp: integer().notNull(),
    appliesTo: text({ enum: ["services", "products", "both"] })
      .notNull()
      .default("both"),
    isDefault: integer({ mode: "boolean" }).notNull().default(false),
    position: integer().notNull().default(0),
    archivedAt: text(),
  },
  (t) => [index("tax_rate_business_idx").on(t.businessId)],
);

export const sequence = sqliteTable(
  "sequence",
  {
    id: text().primaryKey(),
    ...owned,
    kind: text({ enum: ["quote", "invoice"] }).notNull(),
    prefix: text().notNull(),
    nextValue: integer().notNull(),
  },
  (t) => [uniqueIndex("sequence_business_kind_uq").on(t.businessId, t.kind)],
);

// ---------- Clients and catalogue ----------

export const client = sqliteTable(
  "client",
  {
    id: text().primaryKey(),
    ...owned,
    displayName: text().notNull(),
    company: text(),
    email: text(),
    phone: text(),
    billingAddress: text({ mode: "json" }).$type<Address>(),
    notes: text(),
    tags: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    emailBouncedAt: text(),
    archivedAt: text(),
  },
  (t) => [index("client_business_idx").on(t.businessId, t.displayName)],
);

export const clientContact = sqliteTable(
  "client_contact",
  {
    id: text().primaryKey(),
    ...owned,
    clientId: text()
      .notNull()
      .references(() => client.id),
    name: text().notNull(),
    email: text(),
    phone: text(),
    role: text(),
    isPrimary: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("client_contact_client_idx").on(t.clientId)],
);

export const site = sqliteTable(
  "site",
  {
    id: text().primaryKey(),
    ...owned,
    clientId: text()
      .notNull()
      .references(() => client.id),
    label: text().notNull(),
    address: text({ mode: "json" }).$type<Address>(),
    archivedAt: text(),
  },
  (t) => [index("site_client_idx").on(t.clientId)],
);

export const ITEM_TYPE_VALUES = ["service", "product", "fee", "allowance"] as const;

export const item = sqliteTable(
  "item",
  {
    id: text().primaryKey(),
    ...owned,
    type: text({ enum: ITEM_TYPE_VALUES }).notNull(),
    name: text().notNull(),
    description: text(),
    unit: text().notNull().default("each"),
    costCents: integer(),
    markupBp: integer(),
    priceCents: integer().notNull(),
    defaultTaxIds: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    photoKey: text(),
    supplier: text(),
    sku: text(),
    archivedAt: text(),
  },
  (t) => [index("item_business_idx").on(t.businessId, t.name)],
);

export const roomTemplate = sqliteTable("room_template", {
  id: text().primaryKey(),
  ...owned,
  name: text().notNull(),
  color: text().notNull().default("teal"),
  archivedAt: text(),
});

export const roomTemplateLine = sqliteTable(
  "room_template_line",
  {
    id: text().primaryKey(),
    templateId: text()
      .notNull()
      .references(() => roomTemplate.id, { onDelete: "cascade" }),
    itemId: text()
      .notNull()
      .references(() => item.id),
    qtyMilli: integer().notNull().default(1000),
    position: integer().notNull(),
  },
  (t) => [index("room_template_line_template_idx").on(t.templateId)],
);

// ---------- Projects, quotes and invoices ----------

export const project = sqliteTable(
  "project",
  {
    id: text().primaryKey(),
    ...owned,
    clientId: text()
      .notNull()
      .references(() => client.id),
    siteId: text().references(() => site.id),
    name: text().notNull(),
    status: text({ enum: ["active", "completed", "archived"] })
      .notNull()
      .default("active"),
    sourceQuoteId: text(),
    coverPhotoKey: text(),
  },
  (t) => [index("project_client_idx").on(t.clientId)],
);

/** Frozen document content (SPEC 8.2 quote_revision.content). */
export interface DocumentContent {
  sections: {
    id: string;
    title: string;
    lines: {
      id: string;
      itemId?: string;
      itemType?: (typeof ITEM_TYPE_VALUES)[number];
      description: string;
      /** Tiptap HTML limited to bold and bullets. */
      details?: string;
      qtyMilli: number;
      unit: string;
      unitPriceCents: number;
      taxRateIds: string[];
      discount?: { type: "percent"; bp: number } | { type: "amount"; cents: number };
      optional?: boolean;
      selected?: boolean;
      fixedTaxes?: Record<string, number>;
      /**
       * Generated by the server (deposit, progress and final invoices: billed
       * portions, approved quote lines, credits). The builder shows them read
       * only and the server keeps its own copy on every save.
       */
      locked?: boolean;
    }[];
  }[];
  documentDiscount?: { type: "percent"; bp: number } | { type: "amount"; cents: number };
  /** Tax rates as they were when frozen, so archived rates stay on old documents. */
  taxRates: { id: string; name: string; rateBp: number }[];
  notes?: string;
  terms?: string;
  /** Header as sent; kept on revisions so discarding a revision restores it. */
  header?: {
    title: string | null;
    clientId: string | null;
    siteId: string | null;
    /** Quotes: valid until. Invoices use dueDate. */
    validUntil: string | null;
    poReference?: string | null;
    termsDays?: number | null;
    dueDate?: string | null;
  };
}

const QUOTE_STATUS_VALUES = [
  "draft",
  "sent",
  "viewed",
  "changes_requested",
  "approved",
  "declined",
  "expired",
] as const;
const INVOICE_STATUS_VALUES = [
  "draft",
  "sent",
  "viewed",
  "changes_requested",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const;

export const quote = sqliteTable(
  "quote",
  {
    id: text().primaryKey(),
    ...owned,
    /** Null only while a draft has no client yet; required to send. */
    clientId: text().references(() => client.id),
    projectId: text().references(() => project.id),
    siteId: text().references(() => site.id),
    title: text(),
    number: text(),
    status: text({ enum: QUOTE_STATUS_VALUES }).notNull().default("draft"),
    currentRevisionId: text(),
    /** Draft content lives here until sent; sent content is frozen in quote_revision. */
    draftContent: text({ mode: "json" }).$type<DocumentContent>(),
    /** Server-computed total of draftContent, stored so lists needn't re-total every draft. */
    draftTotalCents: integer(),
    draftVersion: integer().notNull().default(0),
    depositType: text({ enum: ["percent", "amount"] }),
    depositValue: integer(),
    validUntil: text(),
    /** Legacy default; always written explicitly from domain/locale CURRENCY. */
    currency: text().notNull().default("CAD"),
    shareTokenHash: text(),
    /** Random salt for the HMAC share token (server/tokens.ts); new salt = new link. */
    shareTokenSalt: text(),
    followUpPaused: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("quote_business_number_uq").on(t.businessId, t.number),
    index("quote_business_status_idx").on(t.businessId, t.status),
    uniqueIndex("quote_share_token_uq").on(t.shareTokenHash),
  ],
);

export const quoteRevision = sqliteTable(
  "quote_revision",
  {
    id: text().primaryKey(),
    quoteId: text()
      .notNull()
      .references(() => quote.id),
    revisionNo: integer().notNull(),
    content: text({ mode: "json" }).$type<DocumentContent>().notNull(),
    subtotalCents: integer().notNull(),
    discountCents: integer().notNull(),
    taxCents: integer().notNull(),
    totalCents: integer().notNull(),
    depositType: text({ enum: ["percent", "amount"] }),
    depositValue: integer(),
    contentHash: text().notNull(),
    sentAt: text(),
    createdAt: text().notNull().default(now),
    createdBy: text(),
  },
  (t) => [uniqueIndex("quote_revision_no_uq").on(t.quoteId, t.revisionNo)],
);

export const quoteAcceptance = sqliteTable("quote_acceptance", {
  id: text().primaryKey(),
  quoteRevisionId: text()
    .notNull()
    .references(() => quoteRevision.id),
  selectedOptionLineIds: text({ mode: "json" }).$type<string[]>().notNull(),
  signerName: text().notNull(),
  signerEmail: text(),
  signatureSvg: text(),
  acceptedTotalCents: integer().notNull(),
  ip: text(),
  userAgent: text(),
  contentHash: text().notNull(),
  acceptedAt: text().notNull().default(now),
});

export const invoice = sqliteTable(
  "invoice",
  {
    id: text().primaryKey(),
    ...owned,
    /** Null only while a draft has no client yet; required to send. */
    clientId: text().references(() => client.id),
    projectId: text().references(() => project.id),
    quoteId: text().references(() => quote.id),
    siteId: text().references(() => site.id),
    kind: text({ enum: ["standard", "deposit", "progress", "final"] })
      .notNull()
      .default("standard"),
    title: text(),
    /** The client's PO or reference (FR-INV-03). */
    poReference: text(),
    number: text(),
    status: text({ enum: INVOICE_STATUS_VALUES }).notNull().default("draft"),
    /** Set to the send date (business day) when sent. */
    issueDate: text(),
    dueDate: text(),
    /** Payment terms in days; null means the owner picked a due date. */
    termsDays: integer(),
    currentRevisionId: text(),
    draftContent: text({ mode: "json" }).$type<DocumentContent>(),
    /** Server-computed total of draftContent, for lists. */
    draftTotalCents: integer(),
    draftVersion: integer().notNull().default(0),
    /** Legacy default; always written explicitly from domain/locale CURRENCY. */
    currency: text().notNull().default("CAD"),
    shareTokenHash: text(),
    /** Random salt for the HMAC share token (server/tokens.ts); new salt = new link. */
    shareTokenSalt: text(),
    remindersPaused: integer({ mode: "boolean" }).notNull().default(false),
    requiresApproval: integer({ mode: "boolean" }).notNull().default(false),
    voidedAt: text(),
    voidReason: text(),
    /** Set when this invoice reissues a voided one. */
    reissueOfId: text(),
  },
  (t) => [
    uniqueIndex("invoice_business_number_uq").on(t.businessId, t.number),
    index("invoice_business_status_idx").on(t.businessId, t.status),
    index("invoice_client_idx").on(t.clientId),
    // Job steps and final invoices look invoices up by quote (D1 bills rows read).
    index("invoice_quote_idx").on(t.quoteId),
    uniqueIndex("invoice_share_token_uq").on(t.shareTokenHash),
  ],
);

export const invoiceRevision = sqliteTable(
  "invoice_revision",
  {
    id: text().primaryKey(),
    invoiceId: text()
      .notNull()
      .references(() => invoice.id),
    revisionNo: integer().notNull(),
    content: text({ mode: "json" }).$type<DocumentContent>().notNull(),
    subtotalCents: integer().notNull(),
    discountCents: integer().notNull(),
    taxCents: integer().notNull(),
    totalCents: integer().notNull(),
    creditsCents: integer().notNull().default(0),
    contentHash: text().notNull(),
    sentAt: text(),
    createdAt: text().notNull().default(now),
    createdBy: text(),
  },
  (t) => [uniqueIndex("invoice_revision_no_uq").on(t.invoiceId, t.revisionNo)],
);

export const invoiceLine = sqliteTable(
  "invoice_line",
  {
    id: text().primaryKey(),
    invoiceId: text()
      .notNull()
      .references(() => invoice.id),
    revisionId: text()
      .notNull()
      .references(() => invoiceRevision.id),
    description: text().notNull(),
    qtyMilli: integer().notNull(),
    unit: text().notNull(),
    unitPriceCents: integer().notNull(),
    discountCents: integer().notNull().default(0),
    lineTotalCents: integer().notNull(),
    itemType: text({ enum: ITEM_TYPE_VALUES }),
    position: integer().notNull(),
  },
  (t) => [index("invoice_line_invoice_idx").on(t.invoiceId)],
);

export const invoiceLineTax = sqliteTable(
  "invoice_line_tax",
  {
    id: text().primaryKey(),
    invoiceLineId: text()
      .notNull()
      .references(() => invoiceLine.id, { onDelete: "cascade" }),
    taxRateId: text().notNull(),
    rateBp: integer().notNull(),
    taxableCents: integer().notNull(),
    taxCents: integer().notNull(),
  },
  (t) => [index("invoice_line_tax_line_idx").on(t.invoiceLineId)],
);

export const payment = sqliteTable(
  "payment",
  {
    id: text().primaryKey(),
    ...owned,
    invoiceId: text()
      .notNull()
      .references(() => invoice.id),
    clientId: text()
      .notNull()
      .references(() => client.id),
    /** Cash applied to the invoice; any overpayment is a client_credit row. */
    amountCents: integer().notNull(),
    method: text({ enum: ["bank", "pos", "cash", "card", "cheque", "other"] }).notNull(),
    reference: text(),
    receivedOn: text().notNull(),
    note: text(),
    /** Withholding tax deducted by the payer (FR-PAY-06); settles the invoice with the cash. */
    whtRateBp: integer(),
    whtCents: integer().notNull().default(0),
    whtReference: text(),
    deletedAt: text(),
    deleteReason: text(),
  },
  (t) => [
    index("payment_invoice_idx").on(t.invoiceId),
    index("payment_business_date_idx").on(t.businessId, t.receivedOn),
  ],
);

export const clientCredit = sqliteTable(
  "client_credit",
  {
    id: text().primaryKey(),
    ...owned,
    clientId: text()
      .notNull()
      .references(() => client.id),
    amountCents: integer().notNull(),
    sourcePaymentId: text().references(() => payment.id),
    appliedToInvoiceId: text().references(() => invoice.id),
  },
  (t) => [index("client_credit_client_idx").on(t.clientId)],
);

export const expense = sqliteTable(
  "expense",
  {
    id: text().primaryKey(),
    ...owned,
    date: text().notNull(),
    supplier: text().notNull(),
    category: text().notNull(),
    /** What was paid, VAT included; reports use amount − VAT (SPEC 5.11). */
    amountCents: integer().notNull(),
    vatCents: integer().notNull().default(0),
    projectId: text().references(() => project.id),
    billable: integer({ mode: "boolean" }).notNull().default(false),
    receiptKey: text(),
    /** FR-EXP-02: the draft invoice and the content line id it was added as. */
    billedInvoiceId: text(),
    billedInvoiceLineId: text(),
    note: text(),
    deletedAt: text(),
  },
  (t) => [
    index("expense_business_date_idx").on(t.businessId, t.date),
    index("expense_billed_invoice_idx").on(t.billedInvoiceId),
  ],
);

// ---------- Conversations ----------

export const conversation = sqliteTable(
  "conversation",
  {
    id: text().primaryKey(),
    ...owned,
    entityType: text({ enum: ["quote", "invoice"] }).notNull(),
    entityId: text().notNull(),
    lastMessageAt: text(),
    ownerUnread: integer().notNull().default(0),
    clientUnread: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("conversation_entity_uq").on(t.entityType, t.entityId),
    index("conversation_business_last_idx").on(t.businessId, t.lastMessageAt),
  ],
);

export const message = sqliteTable(
  "message",
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => conversation.id),
    /** `owner`, `staff:<user id>` or `client`. */
    author: text().notNull(),
    clientName: text(),
    body: text().notNull(),
    revisionId: text(),
    attachmentKeys: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    hiddenAt: text(),
    createdAt: text().notNull().default(now),
  },
  (t) => [index("message_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const changeRequest = sqliteTable(
  "change_request",
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => conversation.id),
    messageId: text()
      .notNull()
      .references(() => message.id),
    revisionId: text().notNull(),
    /** A line id of that revision, or `document` for the whole document. */
    lineRef: text().notNull(),
    /** The line's description when asked, so the thread reads the same after the line changes. */
    lineLabel: text(),
    kind: text({ enum: ["remove", "quantity", "question", "other"] }).notNull(),
    proposedQtyMilli: integer(),
    /** `answered` closes a question (no SQL CHECK, so no migration; docs/decisions.md). */
    status: text({ enum: ["open", "accepted", "declined", "answered"] })
      .notNull()
      .default("open"),
    resolutionNote: text(),
    resolvedInRevisionId: text(),
    createdAt: text().notNull().default(now),
    resolvedAt: text(),
  },
  (t) => [index("change_request_conversation_idx").on(t.conversationId, t.status)],
);

// ---------- Email, portal, notifications, audit, jobs ----------

export const emailMessage = sqliteTable(
  "email_message",
  {
    id: text().primaryKey(),
    ...owned,
    entityType: text(),
    entityId: text(),
    template: text().notNull(),
    to: text().notNull(),
    cc: text(),
    subject: text().notNull(),
    idempotencyKey: text(),
    resendId: text(),
    transport: text({ enum: ["dev", "resend"] }),
    status: text({ enum: ["queued", "sent", "delivered", "opened", "bounced", "complained", "failed"] })
      .notNull()
      .default("queued"),
    error: text(),
  },
  (t) => [
    index("email_message_entity_idx").on(t.entityType, t.entityId),
    uniqueIndex("email_message_idempotency_uq").on(t.idempotencyKey),
    index("email_message_resend_idx").on(t.resendId),
  ],
);

export const portalEvent = sqliteTable(
  "portal_event",
  {
    id: text().primaryKey(),
    entityType: text({ enum: ["quote", "invoice"] }).notNull(),
    entityId: text().notNull(),
    event: text({ enum: ["viewed", "downloaded", "option_changed"] }).notNull(),
    ip: text(),
    userAgent: text(),
    at: text().notNull().default(now),
  },
  (t) => [index("portal_event_entity_idx").on(t.entityType, t.entityId)],
);

export const notification = sqliteTable(
  "notification",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    entityType: text(),
    entityId: text(),
    title: text().notNull(),
    readAt: text(),
    /** When the push alert (and, for some types, the owner email) went out. */
    deliveredAt: text(),
    createdAt: text().notNull().default(now),
  },
  (t) => [
    index("notification_user_idx").on(t.userId, t.readAt),
    index("notification_delivered_idx").on(t.deliveredAt),
  ],
);

/** A device that accepted push alerts (Web Push, owner request): one row per browser. */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text().notNull(),
    /** Base64url keys from the browser's PushSubscription. */
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    createdAt: text().notNull().default(now),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint_uq").on(t.endpoint),
    index("push_subscription_user_idx").on(t.userId),
  ],
);

export const activity = sqliteTable(
  "activity",
  {
    id: text().primaryKey(),
    businessId: text()
      .notNull()
      .references(() => business.id),
    /** `user:<id>`, `client` or `system`. */
    actor: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    action: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>(),
    at: text().notNull().default(now),
  },
  (t) => [
    index("activity_entity_idx").on(t.entityType, t.entityId),
    index("activity_business_at_idx").on(t.businessId, t.at),
  ],
);

export const jobRun = sqliteTable(
  "job_run",
  {
    id: text().primaryKey(),
    job: text().notNull(),
    runKey: text().notNull(),
    startedAt: text().notNull().default(now),
    finishedAt: text(),
    result: text({ mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex("job_run_key_uq").on(t.job, t.runKey)],
);

/** SPEC 12: which old-app record became which row, so an import never runs twice. */
export const legacyImport = sqliteTable(
  "legacy_import",
  {
    businessId: text()
      .notNull()
      .references(() => business.id),
    /** customers, items, quotes, invoices, payments, expenses. */
    kind: text().notNull(),
    legacyId: text().notNull(),
    entityId: text().notNull(),
    importedAt: text().notNull().default(now),
  },
  (t) => [uniqueIndex("legacy_import_uq").on(t.businessId, t.kind, t.legacyId)],
);

// ---------- Views (migration 0002_views.sql; SPEC 8.3 derived values) ----------

export const clientBalance = sqliteView("client_balance", {
  clientId: text("client_id").notNull(),
  businessId: text("business_id").notNull(),
  billedCents: integer("billed_cents").notNull(),
  paidCents: integer("paid_cents").notNull(),
  creditsAppliedCents: integer("credits_applied_cents").notNull(),
  creditAvailableCents: integer("credit_available_cents").notNull(),
  lastActivityAt: text("last_activity_at"),
}).existing();

export const projectFinancials = sqliteView("project_financials", {
  projectId: text("project_id").notNull(),
  businessId: text("business_id").notNull(),
  contractCents: integer("contract_cents").notNull(),
  invoicedCents: integer("invoiced_cents").notNull(),
  paidCents: integer("paid_cents").notNull(),
  expensesCents: integer("expenses_cents").notNull(),
}).existing();
