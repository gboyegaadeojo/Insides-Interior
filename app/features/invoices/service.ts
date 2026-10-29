// Invoices and payments (SPEC 5.7, 5.8, 8.3). Drafts autosave like quotes; a
// send freezes a revision and allocates the number in one guarded D1 batch
// (as quotes do, docs/decisions.md). Deposit, progress and final invoices are
// generated from an approved quote with server-locked lines, so F1–F3 always
// reconcile. Status after a payment is derived from the money in the same
// batch as the payment.

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { canonicalJson, type Json } from "~/domain/canonical";
import { describeDiff, diffContent } from "~/domain/diff";
import { computeContent, depositFrom, type DocumentTotals } from "~/domain/document";
import { balanceCents, checkPayment, deriveInvoiceStatus, settledCents } from "~/domain/invoice";
import {
  canInvoice,
  type InvoiceEvent,
  type InvoiceStatus,
  invoiceTransition,
  TransitionError,
} from "~/domain/lifecycle";
import { CURRENCY } from "~/domain/locale";
import { formatBp, formatCents } from "~/domain/money";
import { applySelection } from "~/domain/portal";
import { reminderBlock } from "~/domain/reminders";
import { buildFinalInvoiceLines, buildPortionLines, type Discount } from "~/domain/tax";
import {
  acceptOpenIn,
  openRequestCount,
  pendingAccepted,
  reopenAccepted,
  resolveAcceptedIn,
} from "~/features/conversations/requests";
import {
  emailInsert,
  enqueue,
  type EmailJob,
  NUMBER_PLACEHOLDER,
  type OutgoingEmail,
} from "~/features/email/service";
import { taxRatesFor } from "~/features/quotes/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday, formatDate } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { likeTerm } from "~/lib/like";
import { EMAIL_TEMPLATE_DEFAULTS } from "~/lib/merge-fields";
import { activityInsert } from "~/server/audit";
import { type DocumentContent, schema } from "~/server/db";
import { invoiceSentEmail, paymentReceiptEmail, type RevisionChanges } from "~/server/email/templates";
import type { RequestContext } from "~/server/session";
import { hashShareToken, newShareSalt, portalPath, sha256Hex, shareToken } from "~/server/tokens";
import type { SendQuoteInput } from "~/features/quotes/schema";
import {
  INVOICE_FILTERS,
  INVOICE_PAGE_SIZE,
  type InvoiceFilter,
  PAYMENT_METHOD_LABEL,
  PAYMENT_PAGE_SIZE,
} from "./constants";
import type { FromQuoteInput, RecordPaymentInput, SaveInvoiceDraftInput } from "./schema";

type Ctx = Pick<RequestContext, "db" | "user">;
type Line = DocumentContent["sections"][number]["lines"][number];
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

const nowIso = () => new Date().toISOString();
const newLineId = () => crypto.randomUUID();

/** Statuses that can take a payment (SPEC 5.13). */
const PAYABLE: InvoiceStatus[] = ["sent", "viewed", "changes_requested", "partially_paid", "overdue"];
/** Sent and not settled: what "Outstanding" means on the list and Home. */
export const OUTSTANDING: InvoiceStatus[] = [
  "sent",
  "viewed",
  "changes_requested",
  "partially_paid",
  "overdue",
];

function audit(ctx: RequestContext, entityId: string, action: string, data?: Record<string, unknown>) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType: "invoice",
    entityId,
    action,
    data,
  });
}

/** Fails the batch (NOT NULL) when the conditional UPDATE before it changed no row. */
function requireChanged(ctx: Ctx, id: string) {
  return ctx.db
    .update(schema.invoice)
    .set({ draftVersion: sql`case when changes() = 1 then ${schema.invoice.draftVersion} else null end` })
    .where(eq(schema.invoice.id, id));
}

function transitionOrFail(from: InvoiceStatus, event: InvoiceEvent) {
  try {
    return invoiceTransition(from, event);
  } catch (error) {
    if (error instanceof TransitionError) throw new ServiceError(error.message);
    throw error;
  }
}

async function loadSettings(ctx: Ctx) {
  const [settings] = await ctx.db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.businessId, ctx.user.businessId));
  if (!settings) throw new ServiceError("The business hasn't been set up yet");
  return settings;
}

/** Bank details printed under "How to pay" (SPEC 6.10, Nigeria: bank transfer). */
export async function paymentInstructions(ctx: Ctx): Promise<string[]> {
  const s = await loadSettings(ctx);
  return [
    s.bankName && `Bank: ${s.bankName}`,
    s.accountName && `Account name: ${s.accountName}`,
    s.accountNumber && `Account number: ${s.accountNumber}`,
    s.paymentNote,
  ].filter((x): x is string => !!x);
}

// ---------- Creating drafts ----------

function emptyContent(taxRates: DocumentContent["taxRates"]): DocumentContent {
  return { sections: [{ id: newLineId(), title: "Room 1", lines: [] }], taxRates };
}

/** A blank standard invoice (FR-INV-01). */
export async function createInvoice(
  ctx: RequestContext,
  opts: { clientId?: string | null; projectId?: string | null } = {},
) {
  const settings = await loadSettings(ctx);
  if (opts.clientId) {
    const [client] = await ctx.db
      .select({ id: schema.client.id })
      .from(schema.client)
      .where(and(eq(schema.client.id, opts.clientId), eq(schema.client.businessId, ctx.user.businessId)));
    if (!client) throw new ServiceError("That client no longer exists");
  }
  const id = newId("inv");
  await ctx.db.batch([
    ctx.db.insert(schema.invoice).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      clientId: opts.clientId ?? null,
      projectId: opts.projectId ?? null,
      kind: "standard",
      currency: CURRENCY,
      status: "draft",
      termsDays: settings.paymentTermsDays,
      draftContent: emptyContent(await taxRatesFor(ctx, [])),
      draftTotalCents: 0,
      draftVersion: 1,
    }),
    audit(ctx, id, "invoice.created", { kind: "standard" }),
  ]);
  return id;
}

/** The approved quote behind an invoice: its frozen revision with the client's choices applied. */
async function approvedQuote(ctx: Ctx, quoteId: string) {
  const [quote] = await ctx.db
    .select()
    .from(schema.quote)
    .where(and(eq(schema.quote.id, quoteId), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!quote) throw new ServiceError("That quote no longer exists");
  if (quote.status !== "approved" || !quote.currentRevisionId)
    throw new ServiceError("Invoices are made from approved quotes");
  const [[revision], [acceptance]] = await Promise.all([
    ctx.db.select().from(schema.quoteRevision).where(eq(schema.quoteRevision.id, quote.currentRevisionId)),
    ctx.db
      .select()
      .from(schema.quoteAcceptance)
      .where(eq(schema.quoteAcceptance.quoteRevisionId, quote.currentRevisionId))
      .orderBy(desc(schema.quoteAcceptance.acceptedAt))
      .limit(1),
  ]);
  if (!revision) throw new ServiceError("That quote has no sent revision");
  const chosen = applySelection(revision.content, acceptance?.selectedOptionLineIds ?? []);
  // What the client approved: unchosen options dropped, chosen ones become ordinary lines.
  const sections = chosen.sections
    .map((s) => ({
      ...s,
      lines: s.lines
        .filter((l) => !l.optional || l.selected)
        .map(({ optional: _o, selected: _s, ...l }) => l),
    }))
    .filter((s) => s.lines.length > 0);
  const { header: _header, ...content } = chosen;
  const approved: DocumentContent = { ...content, sections, notes: undefined, terms: undefined };
  return { quote, revision, approved, totals: computeContent(approved) };
}

/** Sent, non-void deposit and progress invoices of a quote: what a final invoice credits. */
async function priorInvoices(ctx: Ctx, quoteId: string) {
  const rows = await ctx.db
    .select({
      number: schema.invoice.number,
      kind: schema.invoice.kind,
      content: schema.invoiceRevision.content,
    })
    .from(schema.invoice)
    .innerJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, schema.invoice.currentRevisionId))
    .where(
      and(
        eq(schema.invoice.quoteId, quoteId),
        inArray(schema.invoice.kind, ["deposit", "progress"]),
        sql`${schema.invoice.status} not in ('draft', 'void')`,
      ),
    )
    .orderBy(schema.invoice.number);
  return rows;
}

function lockAll(lines: Line[]): Line[] {
  return lines.map((l) => ({ ...l, unit: l.unit || "", locked: true }));
}

/**
 * FR-INV-01, FR-QT-12/13: a draft invoice from an approved quote.
 * - deposit: the quote's deposit terms, one locked line per tax group (F2)
 * - progress: a % or amount of the approved total, likewise
 * - final: the approved lines, less every sent deposit and progress invoice
 *   with the exact taxes they charged (F3), all locked
 * - full: the approved lines as an ordinary, editable invoice
 */
export async function createInvoiceFromQuote(ctx: RequestContext, quoteId: string, input: FromQuoteInput) {
  const settings = await loadSettings(ctx);
  const { quote, revision, approved, totals } = await approvedQuote(ctx, quoteId);
  const ref = `quote ${quote.number}`;
  let content: DocumentContent;
  let kind: "standard" | "deposit" | "progress" | "final";

  if (input.kind === "deposit" || input.kind === "progress") {
    const portion: Discount | undefined =
      input.kind === "deposit"
        ? depositFrom(revision.depositType, revision.depositValue)
        : input.portionType === "percent"
          ? { type: "percent", bp: Math.min(input.portionValue, 10_000) }
          : { type: "amount", cents: input.portionValue };
    if (!portion) throw new ServiceError("This quote has no deposit terms; make a progress invoice instead");
    const label =
      (input.kind === "deposit" ? "Deposit" : "Progress payment") +
      (portion.type === "percent" ? ` (${formatBp(portion.bp)}%)` : "") +
      ` on ${ref}`;
    const lines = buildPortionLines(totals.computed, portion, label).map((l) => ({
      ...l,
      id: newLineId(),
      unit: "",
      locked: true,
    }));
    if (lines.length === 0) throw new ServiceError("There's nothing to bill on this quote");
    content = {
      sections: [
        { id: newLineId(), title: input.kind === "deposit" ? "Deposit" : "Progress payment", lines },
      ],
      taxRates: approved.taxRates,
    };
    kind = input.kind;
  } else if (input.kind === "final") {
    const [existing] = await ctx.db
      .select({ number: schema.invoice.number })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.quoteId, quoteId),
          eq(schema.invoice.kind, "final"),
          sql`${schema.invoice.status} <> 'void'`,
        ),
      );
    if (existing)
      throw new ServiceError(
        `There's already a final invoice${existing.number ? ` (${existing.number})` : ""} for this quote`,
      );
    const prior = await priorInvoices(ctx, quoteId);
    const credits = buildFinalInvoiceLines(
      [],
      prior.map((p) => ({
        label: `${p.kind === "deposit" ? "deposit" : "progress"} invoice ${p.number}`,
        document: computeContent(p.content).computed,
      })),
    ).map((l) => ({ ...l, id: newLineId(), unit: "", locked: true }));
    content = {
      ...approved,
      sections: [
        ...approved.sections.map((s) => ({ ...s, lines: lockAll(s.lines) })),
        ...(credits.length ? [{ id: newLineId(), title: "Already invoiced", lines: credits }] : []),
      ],
    };
    kind = "final";
  } else {
    content = {
      ...approved,
      sections: approved.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => ({ ...l, id: newLineId() })),
      })),
    };
    kind = "standard";
  }

  const id = newId("inv");
  await ctx.db.batch([
    ctx.db.insert(schema.invoice).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      clientId: quote.clientId,
      projectId: quote.projectId,
      siteId: quote.siteId,
      quoteId,
      kind,
      title: quote.title,
      currency: CURRENCY,
      status: "draft",
      termsDays: settings.paymentTermsDays,
      draftContent: content,
      draftTotalCents: computeContent(content).computed.totalCents,
      draftVersion: 1,
    }),
    audit(ctx, id, "invoice.created", { kind, fromQuote: quote.number }),
  ]);
  return id;
}

// ---------- Reading ----------

async function moneyOf(ctx: Ctx, invoiceId: string) {
  const [payments, credits] = await Promise.all([
    ctx.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.invoiceId, invoiceId))
      .orderBy(desc(schema.payment.receivedOn), desc(schema.payment.createdAt)),
    ctx.db
      .select({ total: sql<number>`coalesce(sum(${schema.clientCredit.amountCents}), 0)` })
      .from(schema.clientCredit)
      .where(eq(schema.clientCredit.appliedToInvoiceId, invoiceId)),
  ]);
  return {
    payments,
    creditsAppliedCents: credits[0]?.total ?? 0,
    settlement: (totalCents: number) => ({
      totalCents,
      payments: payments.map((p) => ({
        amountCents: p.amountCents,
        whtCents: p.whtCents,
        deleted: !!p.deletedAt,
      })),
      creditsAppliedCents: credits[0]?.total ?? 0,
    }),
  };
}

export async function getInvoice(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.businessId, ctx.user.businessId)));
  if (!row) return null;
  const [[client], [site], [revision], [quote], [reissueOf], money] = await Promise.all([
    row.clientId ? ctx.db.select().from(schema.client).where(eq(schema.client.id, row.clientId)) : [],
    row.siteId ? ctx.db.select().from(schema.site).where(eq(schema.site.id, row.siteId)) : [],
    row.currentRevisionId
      ? ctx.db
          .select()
          .from(schema.invoiceRevision)
          .where(eq(schema.invoiceRevision.id, row.currentRevisionId))
      : [],
    row.quoteId
      ? ctx.db
          .select({ id: schema.quote.id, number: schema.quote.number })
          .from(schema.quote)
          .where(eq(schema.quote.id, row.quoteId))
      : [],
    row.reissueOfId
      ? ctx.db
          .select({ id: schema.invoice.id, number: schema.invoice.number })
          .from(schema.invoice)
          .where(eq(schema.invoice.id, row.reissueOfId))
      : [],
    moneyOf(ctx, id),
  ]);
  const isDraft = row.status === "draft";
  const base = isDraft ? row.draftContent : (revision?.content ?? row.draftContent);
  if (!base) throw new ServiceError("This invoice has no content");
  const referenced = base.sections.flatMap((s) => s.lines.flatMap((l) => l.taxRateIds));
  const content = isDraft ? { ...base, taxRates: await draftTaxRates(ctx, base, referenced) } : base;
  const totals = computeContent(content);
  const totalCents = isDraft ? totals.computed.totalCents : (revision?.totalCents ?? 0);
  const settlement = money.settlement(totalCents);
  return {
    invoice: row,
    client: client ?? null,
    site: site ?? null,
    content,
    totals,
    revisionNo: isDraft ? null : (revision?.revisionNo ?? null),
    revising: isDraft && revision ? { revisionNo: revision.revisionNo } : null,
    revision: revision
      ? {
          id: revision.id,
          revisionNo: revision.revisionNo,
          sentAt: revision.sentAt,
          totalCents: revision.totalCents,
          taxCents: revision.taxCents,
        }
      : null,
    quote: quote ?? null,
    reissueOf: reissueOf ?? null,
    payments: money.payments,
    settledCents: settledCents(settlement),
    balanceCents: balanceCents(settlement),
  };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/**
 * Tax rates for a draft: the current ones, except that rates used by locked
 * lines stay as frozen from the quote, so generated lines never change.
 */
async function draftTaxRates(ctx: Ctx, content: DocumentContent, referenced: string[]) {
  const current = await taxRatesFor(ctx, referenced);
  const lockedIds = new Set(
    content.sections.flatMap((s) => s.lines.filter((l) => l.locked).flatMap((l) => l.taxRateIds)),
  );
  const frozen = content.taxRates.filter((r) => lockedIds.has(r.id));
  return [...frozen, ...current.filter((r) => !lockedIds.has(r.id))];
}

// ---------- Autosave ----------

export class InvoiceConflictError extends Error {
  constructor(readonly serverVersion: number) {
    super("A newer version of this invoice was saved somewhere else");
    this.name = "InvoiceConflictError";
  }
}

/**
 * Locked lines are the server's: whatever the browser sends for them is
 * replaced by the stored copy, and any it left out are put back, so generated
 * portions and credits (with their fixed taxes) can't be forged or dropped.
 */
export function mergeLockedLines(
  stored: DocumentContent | null,
  incoming: SaveInvoiceDraftInput["content"],
): DocumentContent["sections"] {
  const locked = new Map<string, { line: Line; sectionId: string }>();
  for (const s of stored?.sections ?? []) {
    for (const l of s.lines) if (l.locked) locked.set(l.id, { line: l, sectionId: s.id });
  }
  const used = new Set<string>();
  const sections = incoming.sections.map((s) => ({
    ...s,
    lines: s.lines.flatMap((l): Line[] => {
      if (l.locked || locked.has(l.id)) {
        const kept = locked.get(l.id);
        if (!kept || used.has(l.id)) return [];
        used.add(l.id);
        return [kept.line];
      }
      const { locked: _locked, ...free } = l;
      return [free];
    }),
  }));
  for (const [lineId, { line, sectionId }] of locked) {
    if (used.has(lineId)) continue;
    (sections.find((s) => s.id === sectionId) ?? sections[0]!).lines.push(line);
  }
  return sections;
}

export async function saveInvoiceDraft(ctx: RequestContext, id: string, input: SaveInvoiceDraftInput) {
  const [row] = await ctx.db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("This invoice no longer exists");
  if (row.status !== "draft")
    throw new ServiceError("Sent invoices can't be edited; revise or void it instead");
  if (row.draftVersion !== input.version) throw new InvoiceConflictError(row.draftVersion);

  const { header } = input;
  if (header.clientId) {
    const [client] = await ctx.db
      .select({ id: schema.client.id })
      .from(schema.client)
      .where(and(eq(schema.client.id, header.clientId), eq(schema.client.businessId, ctx.user.businessId)));
    if (!client) throw new ServiceError("That client no longer exists", "clientId");
    // A generated invoice belongs to its quote's client.
    if (row.quoteId && row.clientId && header.clientId !== row.clientId)
      throw new ServiceError("This invoice comes from a quote; its client can't change", "clientId");
  }
  if (header.siteId) {
    const [site] = await ctx.db
      .select({ clientId: schema.site.clientId })
      .from(schema.site)
      .where(and(eq(schema.site.id, header.siteId), eq(schema.site.businessId, ctx.user.businessId)));
    if (!site || site.clientId !== header.clientId)
      throw new ServiceError("That job address belongs to another client", "siteId");
  }

  const merged = mergeLockedLines(row.draftContent, input.content);
  const referenced = merged.flatMap((s) => s.lines.flatMap((l) => l.taxRateIds));
  const draft: DocumentContent = {
    ...input.content,
    sections: merged,
    taxRates: row.draftContent?.taxRates ?? [],
  };
  const taxRates = await draftTaxRates(ctx, draft, referenced);
  const known = new Set(taxRates.map((r) => r.id));
  const content: DocumentContent = {
    ...draft,
    taxRates,
    sections: merged.map((s) => ({
      ...s,
      lines: s.lines.map((l) =>
        l.locked ? l : { ...l, taxRateIds: l.taxRateIds.filter((t) => known.has(t)) },
      ),
    })),
  };
  const totals = computeContent(content);
  const nextVersion = input.version + 1;
  const updated = await ctx.db
    .update(schema.invoice)
    .set({
      title: header.title,
      clientId: header.clientId,
      siteId: header.siteId,
      poReference: header.poReference,
      termsDays: header.termsDays,
      dueDate: header.termsDays === null ? header.dueDate : null,
      draftContent: content,
      draftTotalCents: totals.computed.totalCents,
      draftVersion: nextVersion,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(schema.invoice.id, id),
        eq(schema.invoice.draftVersion, input.version),
        eq(schema.invoice.status, "draft"),
      ),
    )
    .returning({ id: schema.invoice.id });
  if (updated.length === 0) {
    const [latest] = await ctx.db
      .select({ v: schema.invoice.draftVersion })
      .from(schema.invoice)
      .where(eq(schema.invoice.id, id));
    throw new InvoiceConflictError(latest?.v ?? input.version);
  }
  return { version: nextVersion, savedAt: nowIso(), taxRates };
}

/** Only unsent drafts may be deleted (SPEC 8.1). */
export async function deleteInvoiceDraft(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select({ status: schema.invoice.status, number: schema.invoice.number })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.businessId, ctx.user.businessId)));
  if (!row) return;
  if (row.status !== "draft" || row.number) throw new ServiceError("Sent invoices are kept for your records");
  const [paid] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.payment)
    .where(eq(schema.payment.invoiceId, id));
  if ((paid?.n ?? 0) > 0) throw new ServiceError("This reissued invoice carries payments; send it instead");
  await ctx.db.batch([
    ctx.db
      .delete(schema.invoice)
      .where(
        and(eq(schema.invoice.id, id), eq(schema.invoice.status, "draft"), isNull(schema.invoice.number)),
      ),
    audit(ctx, id, "invoice.draft_deleted"),
  ]);
}

// ---------- Lists ----------

export { INVOICE_FILTERS, INVOICE_PAGE_SIZE, type InvoiceFilter } from "./constants";

const FILTER_STATUSES: Record<Exclude<InvoiceFilter, "all">, InvoiceStatus[]> = {
  draft: ["draft"],
  outstanding: OUTSTANDING,
  overdue: ["overdue"],
  paid: ["paid"],
  void: ["void"],
};

/** Σ cash + WHT of live payments on an invoice, as SQL. */
const paidSql = sql<number>`coalesce((select sum(${schema.payment.amountCents} + ${schema.payment.whtCents}) from ${schema.payment} where ${schema.payment.invoiceId} = ${schema.invoice.id} and ${schema.payment.deletedAt} is null), 0)`;

export async function listInvoices(
  ctx: Ctx,
  opts: { filter?: InvoiceFilter; query?: string; limit?: number; clientId?: string } = {},
) {
  const i = schema.invoice;
  const mine = and(
    eq(i.businessId, ctx.user.businessId),
    opts.clientId ? eq(i.clientId, opts.clientId) : undefined,
  );
  const byStatus = await ctx.db
    .select({ status: i.status, n: sql<number>`count(*)` })
    .from(i)
    .where(mine)
    .groupBy(i.status);
  const counts = Object.fromEntries(INVOICE_FILTERS.map((f) => [f, 0])) as Record<InvoiceFilter, number>;
  for (const { status, n } of byStatus) {
    counts.all += n;
    for (const [filter, statuses] of Object.entries(FILTER_STATUSES)) {
      if (statuses.includes(status)) counts[filter as InvoiceFilter] += n;
    }
  }
  const filter = opts.filter ?? "all";
  const pattern = opts.query?.trim() ? likeTerm(opts.query.trim().toLowerCase()) : null;
  const limit = Math.min(Math.max(opts.limit ?? INVOICE_PAGE_SIZE, 1), 500);
  const rows = await ctx.db
    .select({
      id: i.id,
      number: i.number,
      title: i.title,
      kind: i.kind,
      status: i.status,
      dueDate: i.dueDate,
      updatedAt: i.updatedAt,
      clientName: schema.client.displayName,
      revisionTotalCents: schema.invoiceRevision.totalCents,
      draftTotalCents: i.draftTotalCents,
      paidCents: paidSql,
    })
    .from(i)
    .leftJoin(schema.client, eq(schema.client.id, i.clientId))
    .leftJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
    .where(
      and(
        mine,
        filter === "all" ? undefined : inArray(i.status, FILTER_STATUSES[filter]),
        pattern
          ? or(
              sql`lower(coalesce(${i.number}, '')) LIKE ${pattern} ESCAPE '\\'`,
              sql`lower(coalesce(${i.title}, '')) LIKE ${pattern} ESCAPE '\\'`,
              sql`lower(coalesce(${schema.client.displayName}, '')) LIKE ${pattern} ESCAPE '\\'`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(i.updatedAt))
    .limit(limit + 1);
  return {
    counts,
    hasMore: rows.length > limit,
    invoices: rows.slice(0, limit).map(({ revisionTotalCents, draftTotalCents, paidCents, ...row }) => {
      const totalCents = row.status === "draft" ? (draftTotalCents ?? 0) : (revisionTotalCents ?? 0);
      return { ...row, totalCents, paidCents, balanceCents: totalCents - paidCents };
    }),
  };
}

export type InvoiceListRow = Awaited<ReturnType<typeof listInvoices>>["invoices"][number];

/** Outstanding and overdue totals for the Invoices header band and Home. */
export async function outstandingSummary(ctx: Ctx) {
  const i = schema.invoice;
  const [row] = await ctx.db
    .select({
      count: sql<number>`count(*)`,
      outstandingCents: sql<number>`coalesce(sum(${schema.invoiceRevision.totalCents} - ${paidSql}), 0)`,
      overdueCount: sql<number>`coalesce(sum(case when ${i.status} = 'overdue' then 1 else 0 end), 0)`,
    })
    .from(i)
    .innerJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
    .where(and(eq(i.businessId, ctx.user.businessId), inArray(i.status, OUTSTANDING)));
  return {
    count: row?.count ?? 0,
    outstandingCents: row?.outstandingCents ?? 0,
    overdueCount: row?.overdueCount ?? 0,
  };
}

// ---------- Send, revise, void ----------

export async function invoiceShareUrl(
  env: Pick<Env, "APP_URL" | "BETTER_AUTH_SECRET">,
  id: string,
  salt: string,
) {
  const token = await shareToken(env.BETTER_AUTH_SECRET, "invoice", id, salt);
  return new URL(portalPath("invoice", token), env.APP_URL).toString();
}

async function invoiceSentMessage(
  ctx: RequestContext,
  opts: {
    revisionId: string;
    revisionNo: number;
    number: string;
    clientName: string;
    totalCents: number;
    balanceCents: number;
    dueDate: string | null;
    url: string;
    to: string;
    cc: string[];
    bcc: string[];
    note?: string;
    changes?: RevisionChanges;
  },
): Promise<OutgoingEmail> {
  const [brand, settings] = await Promise.all([
    loadEmailBrand(ctx.db, ctx.env, ctx.user.businessId),
    loadSettings(ctx),
  ]);
  const defaults = EMAIL_TEMPLATE_DEFAULTS.invoice_sent!;
  const rendered = invoiceSentEmail(brand, {
    clientName: opts.clientName,
    url: opts.url,
    revision: opts.revisionNo,
    note: opts.note,
    changes: opts.changes,
    override: settings.emailTemplates.invoice_sent,
    defaults: { subject: defaults.subject, body: defaults.body },
    facts: {
      number: opts.number,
      total: formatCents(opts.totalCents),
      due: formatCents(opts.balanceCents),
      dueDate: opts.dueDate ? formatDate(opts.dueDate) : undefined,
    },
  });
  return {
    ...rendered,
    to: [opts.to],
    cc: opts.cc,
    bcc: opts.bcc,
    replyTo: brand.replyTo,
    idempotencyKey: `invoice:${opts.revisionId}:invoice_sent`,
  };
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** invoice_line and invoice_line_tax rows of a revision, for reports (SPEC 8.2). */
function reportingLines(
  ctx: Ctx,
  invoiceId: string,
  revisionId: string,
  content: DocumentContent,
  totals: DocumentTotals,
) {
  const lines: (typeof schema.invoiceLine.$inferInsert)[] = [];
  const taxes: (typeof schema.invoiceLineTax.$inferInsert)[] = [];
  let position = 0;
  for (const section of content.sections) {
    for (const line of section.lines) {
      const computed = totals.byLine.get(line.id);
      if (!computed?.included) continue;
      const lineId = newId("iln");
      lines.push({
        id: lineId,
        invoiceId,
        revisionId,
        description: line.description,
        qtyMilli: line.qtyMilli,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        discountCents: computed.lineDiscountCents + computed.documentDiscountCents,
        lineTotalCents: computed.netCents,
        itemType: line.itemType ?? null,
        position: position++,
      });
      for (const tax of computed.taxes) {
        const rate = content.taxRates.find((r) => r.id === tax.rateId);
        taxes.push({
          id: newId("ilt"),
          invoiceLineId: lineId,
          taxRateId: tax.rateId,
          rateBp: rate?.rateBp ?? 0,
          taxableCents: tax.taxableCents,
          taxCents: tax.taxCents,
        });
      }
    }
  }
  // D1 allows 100 bound parameters per statement.
  return [
    ctx.db.delete(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, invoiceId)),
    ...chunk(lines, 9).map((rows) => ctx.db.insert(schema.invoiceLine).values(rows)),
    ...chunk(taxes, 16).map((rows) => ctx.db.insert(schema.invoiceLineTax).values(rows)),
  ];
}

/**
 * FR-INV-02, 05, 06: send a draft, or a revision of an unpaid invoice under the
 * same number. One guarded batch: number, revision, reporting lines, token,
 * email row, activity. Issue date is today; the due date follows the terms.
 */
export async function sendInvoice(ctx: RequestContext, id: string, input: SendQuoteInput) {
  const detail = await getInvoice(ctx, id);
  if (!detail) throw new ServiceError("This invoice no longer exists");
  const { invoice: row, client } = detail;
  if (row.status !== "draft") throw new ServiceError("This invoice has already been sent");
  if (row.draftVersion !== input.version) throw new InvoiceConflictError(row.draftVersion);
  if (!client) throw new ServiceError("Choose a client before sending", "to");
  if (detail.content.sections.every((s) => s.lines.length === 0))
    throw new ServiceError("Add at least one line before sending");
  const today = businessToday();
  const dueDate = row.termsDays !== null ? addDays(today, row.termsDays) : row.dueDate;
  if (!dueDate) throw new ServiceError("Choose payment terms or a due date");
  if (dueDate < today) throw new ServiceError("The due date has passed; choose a later date");

  const content: DocumentContent = {
    ...detail.content,
    header: {
      title: row.title,
      clientId: row.clientId,
      siteId: row.siteId,
      validUntil: null,
      poReference: row.poReference,
      termsDays: row.termsDays,
      dueDate: row.termsDays === null ? row.dueDate : null,
    },
  };
  const totals = computeContent(content);
  const totalCents = totals.computed.totalCents;
  // A reissued invoice brings the payments of the one it replaces.
  const settled = settledCents((await moneyOf(ctx, id)).settlement(totalCents));
  // Requests still open when a revision goes out keep it in changes requested
  // (FR-MSG-07), unless the owner says this revision deals with them.
  const open = await openRequestCount(ctx.db, "invoice", id);
  const closeOpen = open > 0 && !!input.resolveOpen;
  const status = deriveInvoiceStatus({
    totalCents,
    settledCents: settled,
    viewed: false,
    pastDue: false,
    openRequest: open > 0 && !closeOpen,
  });
  transitionOrFail("draft", "send");

  const revisionNo = (detail.revision?.revisionNo ?? 0) + 1;
  let changes: RevisionChanges | undefined;
  if (detail.revision) {
    const [previous] = await ctx.db
      .select({ content: schema.invoiceRevision.content })
      .from(schema.invoiceRevision)
      .where(eq(schema.invoiceRevision.id, detail.revision.id));
    if (previous) {
      const diff = diffContent(previous.content, content);
      changes = {
        lines: describeDiff(diff, 6),
        totalBefore: formatCents(diff.totalBeforeCents),
        totalAfter: formatCents(diff.totalAfterCents),
      };
    }
  }
  const revisionId = newId("irv");
  const contentHash = await sha256Hex(canonicalJson({ content, currency: CURRENCY } as unknown as Json));
  const salt = newShareSalt();
  const token = await shareToken(ctx.env.BETTER_AUTH_SECRET, "invoice", id, salt);
  const url = new URL(portalPath("invoice", token), ctx.env.APP_URL).toString();
  const message = await invoiceSentMessage(ctx, {
    revisionId,
    revisionNo,
    number: row.number ?? NUMBER_PLACEHOLDER,
    clientName: client.displayName,
    totalCents,
    balanceCents: totalCents - settled,
    dueDate,
    url,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    note: input.note,
    changes,
  });
  const email = emailInsert(ctx.db, {
    businessId: ctx.user.businessId,
    createdBy: ctx.user.id,
    entityType: "invoice",
    entityId: id,
    template: revisionNo > 1 ? "invoice_revised" : "invoice_sent",
    message,
    numberFrom: row.number ? undefined : { entity: "invoice", id },
  });
  const now = nowIso();
  const seq = schema.sequence;
  const mySequence = and(eq(seq.businessId, ctx.user.businessId), eq(seq.kind, "invoice"));
  const nextNumber = sql`(select ${seq.prefix} || ${seq.nextValue} from ${seq} where ${mySequence})`;

  try {
    await ctx.db.batch([
      ctx.db
        .update(schema.invoice)
        .set({
          status,
          number: row.number ?? nextNumber,
          currentRevisionId: revisionId,
          issueDate: today,
          dueDate,
          shareTokenHash: await hashShareToken(token),
          shareTokenSalt: salt,
          draftContent: null,
          draftVersion: sql`${schema.invoice.draftVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.invoice.id, id),
            eq(schema.invoice.status, "draft"),
            eq(schema.invoice.draftVersion, input.version),
          ),
        ),
      requireChanged(ctx, id),
      ...(row.number
        ? []
        : [
            ctx.db
              .update(seq)
              .set({ nextValue: sql`${seq.nextValue} + 1`, updatedAt: now })
              .where(mySequence),
          ]),
      ctx.db.insert(schema.invoiceRevision).values({
        id: revisionId,
        invoiceId: id,
        revisionNo,
        content,
        subtotalCents: totals.computed.subtotalCents,
        discountCents: totals.computed.discountCents,
        taxCents: totals.computed.taxCents,
        totalCents,
        creditsCents: 0,
        contentHash,
        sentAt: now,
        createdBy: ctx.user.id,
      }),
      ...reportingLines(ctx, id, revisionId, content, totals),
      resolveAcceptedIn(ctx.db, "invoice", id, revisionId),
      ...(closeOpen ? [acceptOpenIn(ctx.db, "invoice", id, revisionId, revisionNo)] : []),
      email.insert,
      audit(ctx, id, revisionNo > 1 ? "invoice.revision_sent" : "invoice.sent", {
        revision: revisionNo,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        note: input.note || undefined,
        totalCents,
        requestsClosed: closeOpen ? open : undefined,
      }),
    ] as Batch);
  } catch (error) {
    const [latest] = await ctx.db
      .select({ status: schema.invoice.status, version: schema.invoice.draftVersion })
      .from(schema.invoice)
      .where(eq(schema.invoice.id, id));
    if (latest && latest.status !== "draft") throw new ServiceError("This invoice has already been sent");
    if (latest && latest.version !== input.version) throw new InvoiceConflictError(latest.version);
    throw error;
  }

  const queued = await enqueue(ctx.env, [
    {
      kind: "email",
      emailId: email.id,
      businessId: ctx.user.businessId,
      message,
      pdf: { entity: "invoice", id, revisionId },
      numberFrom: row.number ? undefined : { entity: "invoice", id },
    },
  ]);
  const [sent] = await ctx.db
    .select({ number: schema.invoice.number })
    .from(schema.invoice)
    .where(eq(schema.invoice.id, id));
  return { number: sent!.number!, revisionNo, queued, status };
}

/** FR-INV-06: an invoice with no payments goes back to draft, keeping its number. */
export async function reviseInvoice(ctx: RequestContext, id: string) {
  const detail = await getInvoice(ctx, id);
  if (!detail) throw new ServiceError("This invoice no longer exists");
  if (detail.settledCents > 0)
    throw new ServiceError("This invoice has payments; void and reissue it instead");
  transitionOrFail(detail.invoice.status, "revise");
  await reviseInvoiceWith(ctx, detail, (content) => content, []);
}

type InvoiceContent = Omit<DocumentContent, "header">;

/**
 * The draft revision with `change` applied (accepted change requests,
 * FR-MSG-05), in one batch with `extra`. Only an unpaid invoice is revised in
 * place; one with payments is voided and reissued (`voidInvoice`). An invoice
 * already being revised has its draft updated under the draft-version guard.
 */
export async function reviseInvoiceWith(
  ctx: RequestContext,
  detail: InvoiceDetail,
  change: (content: InvoiceContent) => InvoiceContent,
  extra: BatchItem<"sqlite">[],
) {
  const { invoice: row } = detail;
  if (detail.settledCents > 0)
    throw new ServiceError("This invoice has payments; void and reissue it instead");
  const reopening = row.status !== "draft";
  if (reopening) transitionOrFail(row.status, "revise");
  const { header: _header, ...current } = detail.content;
  const content = change(current);
  await ctx.db.batch([
    ctx.db
      .update(schema.invoice)
      .set({
        status: "draft",
        draftContent: content,
        draftTotalCents: computeContent(content).computed.totalCents,
        draftVersion: sql`${schema.invoice.draftVersion} + 1`,
        updatedAt: nowIso(),
      })
      .where(
        and(
          eq(schema.invoice.id, row.id),
          eq(schema.invoice.status, row.status),
          eq(schema.invoice.draftVersion, row.draftVersion),
        ),
      ),
    requireChanged(ctx, row.id),
    ...(reopening
      ? [
          audit(ctx, row.id, "invoice.revision_started", {
            from: row.status,
            revision: (detail.revisionNo ?? 0) + 1,
          }),
        ]
      : []),
    ...extra,
  ] as Batch);
}

/** Throw away an unsent revision: back to the revision the client has. */
export async function discardInvoiceRevision(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.businessId, ctx.user.businessId)));
  if (!row?.currentRevisionId || row.status !== "draft")
    throw new ServiceError("There's no revision to discard");
  const [revision] = await ctx.db
    .select()
    .from(schema.invoiceRevision)
    .where(eq(schema.invoiceRevision.id, row.currentRevisionId));
  if (!revision) throw new ServiceError("There's no revision to discard");
  const [started] = await ctx.db
    .select({ data: schema.activity.data })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.entityType, "invoice"),
        eq(schema.activity.entityId, id),
        eq(schema.activity.action, "invoice.revision_started"),
      ),
    )
    .orderBy(desc(schema.activity.at))
    .limit(1);
  const before = (started?.data?.from as InvoiceStatus | undefined) ?? "sent";
  // Requests accepted into this revision weren't sent: they are open again.
  const reopened = (await pendingAccepted(ctx.db, "invoice", id)).length;
  const previous: InvoiceStatus =
    reopened > 0 && canInvoice(before, "request_changes") ? "changes_requested" : before;
  const header = revision.content.header;
  await ctx.db.batch([
    reopenAccepted(ctx.db, "invoice", id),
    ctx.db
      .update(schema.invoice)
      .set({
        status: previous,
        draftContent: null,
        draftVersion: sql`${schema.invoice.draftVersion} + 1`,
        ...(header && {
          title: header.title,
          clientId: header.clientId,
          siteId: header.siteId,
          poReference: header.poReference ?? null,
          termsDays: header.termsDays ?? null,
        }),
        updatedAt: nowIso(),
      })
      .where(and(eq(schema.invoice.id, id), eq(schema.invoice.status, "draft"))),
    requireChanged(ctx, id),
    audit(ctx, id, "invoice.revision_discarded", { back_to: previous, reopened: reopened || undefined }),
  ]);
}

/**
 * FR-INV-06: void keeps the number and marks VOID; a reason is required. An
 * invoice with payments is voided and reissued: a new draft with the same
 * content takes over its payments.
 */
export async function voidInvoice(
  ctx: RequestContext,
  id: string,
  input: { reason: string; reissue: boolean },
  /** Accepted change requests: the reissue gets `change` applied, in the same batch as `extra`. */
  opts: { change?: (content: InvoiceContent) => InvoiceContent; extra?: BatchItem<"sqlite">[] } = {},
) {
  const detail = await getInvoice(ctx, id);
  if (!detail) throw new ServiceError("This invoice no longer exists");
  const { invoice: row } = detail;
  if (row.status === "draft") throw new ServiceError("A draft can't be voided; discard it instead");
  transitionOrFail(row.status, "void");
  if (detail.settledCents > 0 && !input.reissue)
    throw new ServiceError("This invoice has payments, so it has to be reissued; tick Reissue");
  const now = nowIso();
  const reissueId = input.reissue ? newId("inv") : null;
  const statements: BatchItem<"sqlite">[] = [
    ctx.db
      .update(schema.invoice)
      .set({ status: "void", voidedAt: now, voidReason: input.reason, updatedAt: now })
      .where(and(eq(schema.invoice.id, id), eq(schema.invoice.status, row.status))),
    requireChanged(ctx, id),
    audit(ctx, id, "invoice.voided", { reason: input.reason, reissuedAs: reissueId ?? undefined }),
  ];
  if (reissueId) {
    const { header: _header, ...current } = detail.content;
    const content = opts.change ? opts.change(current) : current;
    statements.push(
      ctx.db.insert(schema.invoice).values({
        id: reissueId,
        businessId: ctx.user.businessId,
        createdBy: ctx.user.id,
        clientId: row.clientId,
        projectId: row.projectId,
        quoteId: row.quoteId,
        siteId: row.siteId,
        kind: row.kind,
        title: row.title,
        poReference: row.poReference,
        termsDays: row.termsDays,
        dueDate: row.termsDays === null ? row.dueDate : null,
        currency: CURRENCY,
        status: "draft",
        draftContent: content,
        draftTotalCents: computeContent(content).computed.totalCents,
        draftVersion: 1,
        reissueOfId: id,
      }),
      ctx.db
        .update(schema.payment)
        .set({ invoiceId: reissueId, updatedAt: now })
        .where(and(eq(schema.payment.invoiceId, id), isNull(schema.payment.deletedAt))),
      audit(ctx, reissueId, "invoice.created", { kind: row.kind, reissueOf: row.number }),
    );
  }
  statements.push(...(opts.extra ?? []));
  await ctx.db.batch(statements as Batch);
  return reissueId;
}

export async function rotateInvoiceLink(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select({ revision: schema.invoice.currentRevisionId })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.businessId, ctx.user.businessId)));
  if (!row?.revision) throw new ServiceError("This invoice hasn't been sent yet");
  const salt = newShareSalt();
  const token = await shareToken(ctx.env.BETTER_AUTH_SECRET, "invoice", id, salt);
  await ctx.db.batch([
    ctx.db
      .update(schema.invoice)
      .set({ shareTokenSalt: salt, shareTokenHash: await hashShareToken(token), updatedAt: nowIso() })
      .where(eq(schema.invoice.id, id)),
    audit(ctx, id, "invoice.link_rotated"),
  ]);
}

/** Re-queue the latest invoice email if it is stuck or failed. Same idempotency key. */
export async function retryInvoiceEmail(ctx: RequestContext, id: string) {
  const detail = await getInvoice(ctx, id);
  if (!detail?.revision || !detail.invoice.number || !detail.invoice.shareTokenSalt || !detail.client)
    throw new ServiceError("This invoice hasn't been sent yet");
  const [row] = await ctx.db
    .select()
    .from(schema.emailMessage)
    .where(
      and(
        eq(schema.emailMessage.entityType, "invoice"),
        eq(schema.emailMessage.entityId, id),
        eq(schema.emailMessage.idempotencyKey, `invoice:${detail.revision.id}:invoice_sent`),
      ),
    );
  if (!row || (row.status !== "queued" && row.status !== "failed"))
    throw new ServiceError("That email has already gone out");
  const [sentEvent] = await ctx.db
    .select({ data: schema.activity.data })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.entityType, "invoice"),
        eq(schema.activity.entityId, id),
        inArray(schema.activity.action, ["invoice.sent", "invoice.revision_sent"]),
      ),
    )
    .orderBy(desc(schema.activity.at))
    .limit(1);
  const sent = (sentEvent?.data ?? {}) as { cc?: string[]; bcc?: string[]; note?: string };
  const message = await invoiceSentMessage(ctx, {
    revisionId: detail.revision.id,
    revisionNo: detail.revision.revisionNo,
    number: detail.invoice.number,
    clientName: detail.client.displayName,
    totalCents: detail.revision.totalCents,
    balanceCents: detail.balanceCents,
    dueDate: detail.invoice.dueDate,
    url: await invoiceShareUrl(ctx.env, id, detail.invoice.shareTokenSalt),
    to: row.to,
    cc: sent.cc ?? [],
    bcc: sent.bcc ?? [],
    note: sent.note,
  });
  await ctx.db.batch([
    ctx.db
      .update(schema.emailMessage)
      .set({ status: "queued", error: null, updatedAt: nowIso() })
      .where(eq(schema.emailMessage.id, row.id)),
    audit(ctx, id, "invoice.email_retried"),
  ]);
  const queued = await enqueue(ctx.env, [
    {
      kind: "email",
      emailId: row.id,
      businessId: ctx.user.businessId,
      message,
      pdf: { entity: "invoice", id, revisionId: detail.revision.id },
    },
  ]);
  if (!queued) throw new ServiceError("Email is busy right now; try again in a minute");
}

// ---------- Payments ----------

/** Whether the client has opened the portal (a status like `paid` doesn't say). */
async function hasBeenViewed(ctx: Ctx, invoiceId: string, status: InvoiceStatus) {
  if (status === "viewed") return true;
  const [event] = await ctx.db
    .select({ id: schema.portalEvent.id })
    .from(schema.portalEvent)
    .where(and(eq(schema.portalEvent.entityType, "invoice"), eq(schema.portalEvent.entityId, invoiceId)))
    .limit(1);
  return !!event;
}

/**
 * FR-PAY-01/02/03/06: record cash (plus any WHT the client deducted). The
 * payment, any overpayment credit and the derived status are one guarded
 * batch; a receipt goes to the client if the setting is on.
 */
export async function recordPayment(ctx: RequestContext, invoiceId: string, input: RecordPaymentInput) {
  const detail = await getInvoice(ctx, invoiceId);
  if (!detail?.revision) throw new ServiceError("This invoice hasn't been sent yet");
  const { invoice: row, client } = detail;
  if (!PAYABLE.includes(row.status))
    throw new ServiceError(
      row.status === "paid" ? "This invoice is already paid" : "This invoice can't take payments",
    );
  if (input.receivedOn > businessToday())
    throw new ServiceError("The date can't be in the future", "receivedOn");
  const check = checkPayment({
    balanceCents: detail.balanceCents,
    cashCents: input.amountCents,
    whtCents: input.whtCents,
    allowCredit: input.allowCredit,
  });
  if (!check.ok) {
    const messages = {
      not_positive: ["Enter the amount received", "amountCents"],
      nothing_due: ["Nothing is due on this invoice", "amountCents"],
      wht_too_large: ["Withholding tax can't be more than the balance", "whtCents"],
      overpayment: [
        `That's ${formatCents(check.excessCents ?? 0)} more than the balance. Tick "Keep the extra as client credit" to record it.`,
        "allowCredit",
      ],
    } as const;
    const [message, field] = messages[check.reason];
    throw new ServiceError(message, field);
  }

  const totalCents = detail.revision.totalCents;
  const settledAfter = detail.settledCents + check.appliedCents + input.whtCents;
  const status = deriveInvoiceStatus({
    totalCents,
    settledCents: settledAfter,
    viewed: await hasBeenViewed(ctx, invoiceId, row.status),
    pastDue: row.status === "overdue",
    openRequest: row.status === "changes_requested",
  });
  const paymentId = newId("pay");
  const now = nowIso();
  const statements: BatchItem<"sqlite">[] = [
    ctx.db.insert(schema.payment).values({
      id: paymentId,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      invoiceId,
      clientId: row.clientId!,
      amountCents: check.appliedCents,
      method: input.method,
      reference: input.reference,
      receivedOn: input.receivedOn,
      note: input.note,
      whtRateBp: input.whtCents > 0 ? (input.whtRateBp ?? null) : null,
      whtCents: input.whtCents,
      whtReference: input.whtCents > 0 ? input.whtReference : null,
    }),
    ctx.db
      .update(schema.invoice)
      .set({ status, updatedAt: now })
      .where(
        and(
          eq(schema.invoice.id, invoiceId),
          eq(schema.invoice.status, row.status),
          eq(schema.invoice.currentRevisionId, detail.revision.id),
        ),
      ),
    requireChanged(ctx, invoiceId),
    audit(ctx, invoiceId, "payment.recorded", {
      paymentId,
      amountCents: check.appliedCents,
      whtCents: input.whtCents,
      creditCents: check.creditCents,
      method: input.method,
      status,
    }),
  ];
  if (check.creditCents > 0) {
    statements.push(
      ctx.db.insert(schema.clientCredit).values({
        id: newId("crd"),
        businessId: ctx.user.businessId,
        createdBy: ctx.user.id,
        clientId: row.clientId!,
        amountCents: check.creditCents,
        sourcePaymentId: paymentId,
      }),
    );
  }

  const jobs: EmailJob[] = [];
  const settings = await loadSettings(ctx);
  if (settings.autoSendReceipts && client?.email && row.shareTokenSalt) {
    const brand = await loadEmailBrand(ctx.db, ctx.env, ctx.user.businessId);
    const defaults = EMAIL_TEMPLATE_DEFAULTS.payment_receipt!;
    const rendered = paymentReceiptEmail(brand, {
      clientName: client.displayName,
      number: row.number!,
      amount: formatCents(input.amountCents),
      wht: input.whtCents > 0 ? formatCents(input.whtCents) : undefined,
      method: PAYMENT_METHOD_LABEL[input.method],
      receivedOn: formatDate(input.receivedOn),
      balance: formatCents(Math.max(0, totalCents - settledAfter)),
      paidInFull: status === "paid",
      url: await invoiceShareUrl(ctx.env, invoiceId, row.shareTokenSalt),
      override: settings.emailTemplates.payment_receipt,
      defaults: { subject: defaults.subject, body: defaults.body },
    });
    const message = {
      ...rendered,
      to: [client.email],
      replyTo: brand.replyTo,
      idempotencyKey: `payment:${paymentId}:payment_receipt`,
    };
    const email = emailInsert(ctx.db, {
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      entityType: "invoice",
      entityId: invoiceId,
      template: "payment_receipt",
      message,
    });
    statements.push(email.insert);
    jobs.push({ kind: "email", emailId: email.id, businessId: ctx.user.businessId, message });
  }

  await ctx.db.batch(statements as Batch);
  await enqueue(ctx.env, jobs);
  return {
    paymentId,
    status,
    balanceCents: totalCents - settledAfter,
    creditCents: check.creditCents,
    receiptQueued: jobs.length > 0,
  };
}

/** FR-PAY-04 (owner only, checked by the route): delete with a reason; status recomputed. */
export async function deletePayment(ctx: RequestContext, input: { paymentId: string; reason: string }) {
  const [payment] = await ctx.db
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.id, input.paymentId), eq(schema.payment.businessId, ctx.user.businessId)));
  if (!payment || payment.deletedAt) throw new ServiceError("That payment no longer exists");
  const detail = await getInvoice(ctx, payment.invoiceId);
  if (!detail?.revision) throw new ServiceError("That invoice no longer exists");
  const { invoice: row } = detail;
  if (row.status === "void") throw new ServiceError("Payments on a void invoice can't be changed");

  const settledAfter = detail.settledCents - payment.amountCents - payment.whtCents;
  const status =
    row.status === "draft"
      ? "draft"
      : deriveInvoiceStatus({
          totalCents: detail.revision.totalCents,
          settledCents: settledAfter,
          viewed: await hasBeenViewed(ctx, row.id, row.status),
          pastDue: !!row.dueDate && row.dueDate < businessToday(),
          openRequest: row.status === "changes_requested",
        });
  const now = nowIso();
  await ctx.db.batch([
    ctx.db
      .update(schema.payment)
      .set({ deletedAt: now, deleteReason: input.reason, updatedAt: now })
      .where(and(eq(schema.payment.id, payment.id), isNull(schema.payment.deletedAt))),
    // Its unused overpayment credit goes with it.
    ctx.db
      .delete(schema.clientCredit)
      .where(
        and(
          eq(schema.clientCredit.sourcePaymentId, payment.id),
          isNull(schema.clientCredit.appliedToInvoiceId),
        ),
      ),
    ctx.db
      .update(schema.invoice)
      .set({ status, updatedAt: now })
      .where(and(eq(schema.invoice.id, row.id), eq(schema.invoice.status, row.status))),
    requireChanged(ctx, row.id),
    audit(ctx, row.id, "payment.deleted", {
      paymentId: payment.id,
      amountCents: payment.amountCents,
      whtCents: payment.whtCents,
      reason: input.reason,
      status,
    }),
  ]);
  return { status, invoiceId: row.id };
}

/** FR-PAY-05: every payment with its invoice and client; deleted ones stay visible. */
export async function listPayments(ctx: Ctx, opts: { limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? PAYMENT_PAGE_SIZE, 1), 500);
  const p = schema.payment;
  const rows = await ctx.db
    .select({
      id: p.id,
      amountCents: p.amountCents,
      whtCents: p.whtCents,
      method: p.method,
      reference: p.reference,
      receivedOn: p.receivedOn,
      deletedAt: p.deletedAt,
      deleteReason: p.deleteReason,
      invoiceId: p.invoiceId,
      invoiceNumber: schema.invoice.number,
      invoiceStatus: schema.invoice.status,
      clientId: p.clientId,
      clientName: schema.client.displayName,
      creditCents: sql<number>`coalesce((select sum(${schema.clientCredit.amountCents}) from ${schema.clientCredit} where ${schema.clientCredit.sourcePaymentId} = ${p.id}), 0)`,
    })
    .from(p)
    .innerJoin(schema.invoice, eq(schema.invoice.id, p.invoiceId))
    .innerJoin(schema.client, eq(schema.client.id, p.clientId))
    .where(eq(p.businessId, ctx.user.businessId))
    .orderBy(desc(p.receivedOn), desc(p.createdAt))
    .limit(limit + 1);
  const [totals] = await ctx.db
    .select({
      monthCents: sql<number>`coalesce(sum(case when ${p.receivedOn} >= ${businessToday().slice(0, 8)}01 then ${p.amountCents} + ${p.whtCents} else 0 end), 0)`,
    })
    .from(p)
    .where(and(eq(p.businessId, ctx.user.businessId), isNull(p.deletedAt)));
  return {
    payments: rows.slice(0, limit),
    hasMore: rows.length > limit,
    monthCents: totals?.monthCents ?? 0,
  };
}

/** Timeline for the invoice screen: activity and emails with delivery status. */
export async function invoiceHistory(ctx: Ctx, id: string) {
  const [events, emails] = await Promise.all([
    ctx.db
      .select()
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.businessId, ctx.user.businessId),
          eq(schema.activity.entityType, "invoice"),
          eq(schema.activity.entityId, id),
        ),
      )
      .orderBy(desc(schema.activity.at))
      .limit(50),
    ctx.db
      .select({
        id: schema.emailMessage.id,
        template: schema.emailMessage.template,
        to: schema.emailMessage.to,
        status: schema.emailMessage.status,
        error: schema.emailMessage.error,
        createdAt: schema.emailMessage.createdAt,
      })
      .from(schema.emailMessage)
      .where(
        and(
          eq(schema.emailMessage.businessId, ctx.user.businessId),
          eq(schema.emailMessage.entityType, "invoice"),
          eq(schema.emailMessage.entityId, id),
        ),
      )
      .orderBy(desc(schema.emailMessage.createdAt)),
  ]);
  const stuckBefore = new Date(Date.now() - 120_000).toISOString();
  return {
    events,
    emails: emails.map((e) => ({
      ...e,
      stuck: e.status === "failed" || (e.status === "queued" && e.createdAt < stuckBefore),
    })),
  };
}

/** For the Send sheet: the number a first send will most likely get, and the email wording. */
export async function invoiceSendSetup(ctx: Ctx) {
  const [[seq], settings] = await Promise.all([
    ctx.db
      .select({ prefix: schema.sequence.prefix, next: schema.sequence.nextValue })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.businessId, ctx.user.businessId), eq(schema.sequence.kind, "invoice"))),
    loadSettings(ctx),
  ]);
  const defaults = EMAIL_TEMPLATE_DEFAULTS.invoice_sent!;
  return {
    nextNumber: seq ? `${seq.prefix}${seq.next}` : null,
    wording: settings.emailTemplates.invoice_sent ?? { subject: defaults.subject, body: defaults.body },
  };
}

/** Which invoices an approved quote already has, for its "Create invoice" menu. */
export async function invoicesForQuote(ctx: Ctx, quoteId: string) {
  return ctx.db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      kind: schema.invoice.kind,
      status: schema.invoice.status,
    })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.quoteId, quoteId), eq(schema.invoice.businessId, ctx.user.businessId)))
    .orderBy(schema.invoice.createdAt);
}

/** Which of these invoices have live payments (they're voided and reissued, not revised). */
export async function invoicesPaid(ctx: Ctx, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await ctx.db
    .selectDistinct({ id: schema.payment.invoiceId })
    .from(schema.payment)
    .where(
      and(
        inArray(schema.payment.invoiceId, ids),
        eq(schema.payment.businessId, ctx.user.businessId),
        isNull(schema.payment.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Invoices a payment reminder may go to today (SPEC 5.9): outstanding, not
 * paused, something due, and no open change request on the thread (FR-MSG-07).
 * Phase 8's daily job sends from this list; the rule is domain/reminders.ts.
 */
export async function remindableInvoices(ctx: Ctx) {
  const i = schema.invoice;
  const openRequests = sql<number>`(select count(*) from ${schema.changeRequest} join ${schema.conversation} on ${schema.conversation.id} = ${schema.changeRequest.conversationId} where ${schema.conversation.entityType} = 'invoice' and ${schema.conversation.entityId} = ${i.id} and ${schema.changeRequest.status} = 'open')`;
  const rows = await ctx.db
    .select({
      id: i.id,
      number: i.number,
      status: i.status,
      remindersPaused: i.remindersPaused,
      totalCents: schema.invoiceRevision.totalCents,
      paidCents: paidSql,
      openRequests,
    })
    .from(i)
    .innerJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
    .where(and(eq(i.businessId, ctx.user.businessId), inArray(i.status, OUTSTANDING)));
  return rows.filter(
    (r) =>
      reminderBlock({
        status: r.status,
        remindersPaused: r.remindersPaused,
        openRequests: r.openRequests,
        balanceCents: r.totalCents - r.paidCents,
      }) === null,
  );
}

export { canInvoice };
