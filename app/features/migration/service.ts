// Importing the old app's records (SPEC 12). The plan (scripts/migrate) is
// validated with Zod; every total is recomputed by the domain functions; sent
// documents become revision 1 with their original numbers; payments recompute
// each invoice's status. Nothing is emailed and no client link is made (the
// owner makes one by resending). Each record is written in one batch with its
// legacy_import row, so a re-run skips what's already in.

import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { canonicalJson, type Json } from "~/domain/canonical";
import { computeContent } from "~/domain/document";
import { deriveInvoiceStatus } from "~/domain/invoice";
import { CURRENCY } from "~/domain/locale";
import { formatBp } from "~/domain/money";
import { reportingLines } from "~/features/invoices/service";
import { addDays, businessToday } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { type DocumentContent, schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import { sha256Hex } from "~/server/tokens";
import { type Plan, type PlanInvoice, type PlanLine, type PlanQuote, planSchema } from "./schema";

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
type Kind = "customers" | "items" | "quotes" | "invoices" | "payments" | "expenses";

export interface ImportReport {
  counts: Record<Kind, { planned: number; imported: number; already: number; skipped: number }>;
  /** Documents whose recomputed total differs from the old app's stored one. */
  totals: {
    kind: "quote" | "invoice";
    number: string | null;
    legacyCents: number | null;
    newCents: number;
  }[];
  /** SPEC 12.1 step 8: outstanding per client, old vs new, for the owner's sign-off. */
  clients: { name: string; legacyOutstandingCents: number; newOutstandingCents: number }[];
  sequences: { kind: "quote" | "invoice"; before: number; after: number }[];
  warnings: string[];
}

/** Bytes for an expense's receipt from the export, if it was downloaded. */
export type ReceiptSource = (
  expense: Plan["expenses"][number],
) => Promise<{ bytes: Uint8Array; type: string } | null>;

const emptyCounts = () => ({ planned: 0, imported: 0, already: 0, skipped: 0 });

function audit(ctx: RequestContext, entityType: string, entityId: string, data: Record<string, unknown>) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType,
    entityId,
    action: `${entityType}.imported`,
    data,
  });
}

export async function importPlan(
  ctx: RequestContext,
  raw: unknown,
  opts: { receipt?: ReceiptSource; today?: string } = {},
): Promise<ImportReport> {
  const plan = planSchema.parse(raw);
  const today = opts.today ?? businessToday();
  const biz = ctx.user.businessId;
  const report: ImportReport = {
    counts: {
      customers: emptyCounts(),
      items: emptyCounts(),
      quotes: emptyCounts(),
      invoices: emptyCounts(),
      payments: emptyCounts(),
      expenses: emptyCounts(),
    },
    totals: [],
    clients: [],
    sequences: [],
    warnings: [...plan.warnings],
  };
  const warn = (m: string) => report.warnings.push(m);

  const existing = await ctx.db
    .select({
      kind: schema.legacyImport.kind,
      legacyId: schema.legacyImport.legacyId,
      entityId: schema.legacyImport.entityId,
    })
    .from(schema.legacyImport)
    .where(eq(schema.legacyImport.businessId, biz));
  const map = new Map(existing.map((e) => [`${e.kind}:${e.legacyId}`, e.entityId]));
  const idOf = (kind: Kind, legacyId: string | null) =>
    legacyId ? (map.get(`${kind}:${legacyId}`) ?? null) : null;
  const mapRow = (kind: Kind, legacyId: string, entityId: string) => {
    map.set(`${kind}:${legacyId}`, entityId);
    return ctx.db.insert(schema.legacyImport).values({ businessId: biz, kind, legacyId, entityId });
  };

  // Tax: the old single rate per line; 7.5% is the business's VAT (SPEC 12.1 step 5).
  const rates = await ctx.db.select().from(schema.taxRate).where(eq(schema.taxRate.businessId, biz));
  const vat = rates.find((r) => r.rateBp === 750 && !r.archivedAt) ?? rates.find((r) => r.rateBp === 750);
  const rateFor = (bp: number) =>
    vat && bp === vat.rateBp
      ? { id: vat.id, name: vat.name, rateBp: vat.rateBp }
      : { id: `tax_migrated_${bp}`, name: `Tax ${formatBp(bp)}%`, rateBp: bp };

  function contentOf(doc: {
    lines: PlanLine[];
    notes: string | null;
    terms: string | null;
  }): DocumentContent {
    const used = new Map<string, DocumentContent["taxRates"][number]>();
    const lines = doc.lines.map((l) => {
      const rate = l.taxBp > 0 ? rateFor(l.taxBp) : null;
      if (rate) used.set(rate.id, rate);
      return {
        id: crypto.randomUUID(),
        itemType: l.itemType,
        description: l.description,
        qtyMilli: l.qtyMilli,
        unit: "each",
        unitPriceCents: l.unitPriceCents,
        taxRateIds: rate ? [rate.id] : [],
      };
    });
    return {
      sections: [{ id: crypto.randomUUID(), title: "Items", lines }],
      taxRates: [...used.values()],
      notes: doc.notes ?? undefined,
      terms: doc.terms ?? undefined,
    };
  }

  const takenNumbers = async (table: typeof schema.quote | typeof schema.invoice) =>
    new Set(
      (await ctx.db.select({ n: table.number }).from(table).where(eq(table.businessId, biz)))
        .map((r) => r.n)
        .filter((n): n is string => !!n),
    );
  const quoteNumbers = await takenNumbers(schema.quote);
  const invoiceNumbers = await takenNumbers(schema.invoice);
  const freeNumber = (taken: Set<string>, number: string | null, label: string) => {
    if (!number) return null;
    let n = number;
    while (taken.has(n)) n = `${n}-dup`;
    if (n !== number) warn(`${label} ${number} already exists; imported as ${n}`);
    taken.add(n);
    return n;
  };
  const isoAt = (date: string | null) => (date ? `${date}T09:00:00.000Z` : new Date().toISOString());

  // ---------- Clients ----------
  for (const c of plan.clients) {
    report.counts.customers.planned++;
    if (idOf("customers", c.legacyId)) {
      report.counts.customers.already++;
      continue;
    }
    const id = newId("cli");
    const emailOk = !c.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email);
    if (!emailOk) warn(`Client ${c.displayName}: "${c.email}" isn't an email address; kept in notes`);
    const notes =
      [c.notes, !emailOk && `Email from the old app: ${c.email}`].filter(Boolean).join("\n") || null;
    await ctx.db.batch([
      ctx.db.insert(schema.client).values({
        id,
        businessId: biz,
        createdBy: ctx.user.id,
        displayName: c.displayName,
        email: emailOk ? (c.email?.toLowerCase() ?? null) : null,
        phone: c.phone,
        billingAddress: c.address ? { line1: c.address.slice(0, 120) } : null,
        notes,
      }),
      mapRow("customers", c.legacyId, id),
      audit(ctx, "client", id, { from: "old app" }),
    ]);
    report.counts.customers.imported++;
  }

  // ---------- Catalogue ----------
  let taxableItems = 0;
  for (const item of plan.items) {
    report.counts.items.planned++;
    if (idOf("items", item.legacyId)) {
      report.counts.items.already++;
      continue;
    }
    if (item.taxable) taxableItems++;
    const id = newId("itm");
    await ctx.db.batch([
      ctx.db.insert(schema.item).values({
        id,
        businessId: biz,
        createdBy: ctx.user.id,
        type: item.type,
        name: item.name,
        description: item.description,
        unit: "each",
        priceCents: item.priceCents,
        // VAT is off by default in Nigeria; the owner turns it on per item.
        defaultTaxIds: [],
      }),
      mapRow("items", item.legacyId, id),
      audit(ctx, "item", id, { from: "old app" }),
    ]);
    report.counts.items.imported++;
  }
  if (taxableItems)
    warn(
      `${taxableItems} catalogue item(s) were taxable in the old app; they were imported without VAT. Add VAT where it applies.`,
    );

  // ---------- Quotes ----------
  const projectByQuoteNumber = new Map<string, { quoteId: string; projectId: string | null }>();
  for (const q of plan.quotes) {
    report.counts.quotes.planned++;
    if (idOf("quotes", q.legacyId)) {
      report.counts.quotes.already++;
      continue;
    }
    const clientId = idOf("customers", q.clientLegacyId);
    let status: PlanQuote["status"] = q.status;
    if (status !== "draft" && !clientId) {
      warn(`Quote ${q.number ?? q.legacyId} has no client; imported as a draft`);
      status = "draft";
    }
    const content = contentOf(q);
    const totals = computeContent(content);
    report.totals.push({
      kind: "quote",
      number: q.number,
      legacyCents: q.legacyTotalCents,
      newCents: totals.computed.totalCents,
    });
    const id = newId("qte");
    const created = isoAt(q.issueDate);
    const stmts: BatchItem<"sqlite">[] = [];
    // The project of a converted quote goes first: the quote references it.
    const before: BatchItem<"sqlite">[] = [];
    let projectId: string | null = null;
    if (q.converted && clientId) {
      projectId = newId("prj");
      before.push(
        ctx.db.insert(schema.project).values({
          id: projectId,
          businessId: biz,
          createdBy: ctx.user.id,
          clientId,
          name: `${q.number ?? "Imported"} (from the old app)`,
          sourceQuoteId: id,
        }),
      );
    }
    if (status === "draft") {
      stmts.unshift(
        ctx.db.insert(schema.quote).values({
          id,
          businessId: biz,
          createdBy: ctx.user.id,
          createdAt: created,
          clientId,
          status: "draft",
          draftContent: content,
          draftTotalCents: totals.computed.totalCents,
          draftVersion: 1,
          validUntil: q.validUntil,
          currency: CURRENCY,
        }),
      );
    } else {
      const number = freeNumber(quoteNumbers, q.number, "Quote");
      const revisionId = newId("qrv");
      const frozen: DocumentContent = {
        ...content,
        header: { title: null, clientId, siteId: null, validUntil: q.validUntil },
      };
      const contentHash = await sha256Hex(
        canonicalJson({ content: frozen, currency: CURRENCY } as unknown as Json),
      );
      stmts.unshift(
        ctx.db.insert(schema.quote).values({
          id,
          businessId: biz,
          createdBy: ctx.user.id,
          createdAt: created,
          clientId,
          projectId,
          number,
          status,
          currentRevisionId: revisionId,
          draftVersion: 1,
          validUntil: q.validUntil,
          currency: CURRENCY,
        }),
        ctx.db.insert(schema.quoteRevision).values({
          id: revisionId,
          quoteId: id,
          revisionNo: 1,
          content: frozen,
          subtotalCents: totals.computed.subtotalCents,
          discountCents: totals.computed.discountCents,
          taxCents: totals.computed.taxCents,
          totalCents: totals.computed.totalCents,
          contentHash,
          sentAt: created,
          createdAt: created,
          createdBy: ctx.user.id,
        }),
      );
      if (status === "approved") {
        stmts.push(
          ctx.db.insert(schema.quoteAcceptance).values({
            id: newId("qac"),
            quoteRevisionId: revisionId,
            selectedOptionLineIds: [],
            signerName: "Migrated from the old app (no signature)",
            acceptedTotalCents: totals.computed.totalCents,
            contentHash,
            acceptedAt: created,
          }),
        );
      }
      if (q.clientComment) {
        const conversationId = newId("cnv");
        stmts.push(
          ctx.db.insert(schema.conversation).values({
            id: conversationId,
            businessId: biz,
            entityType: "quote",
            entityId: id,
            lastMessageAt: created,
            ownerUnread: 1,
          }),
          ctx.db.insert(schema.message).values({
            id: newId("msg"),
            conversationId,
            author: "client",
            clientName: q.clientName,
            body: q.clientComment,
            revisionId,
            createdAt: created,
          }),
        );
      }
      if (number) projectByQuoteNumber.set(q.number ?? number, { quoteId: id, projectId });
    }
    stmts.push(
      mapRow("quotes", q.legacyId, id),
      audit(ctx, "quote", id, { from: "old app", number: q.number }),
    );
    await ctx.db.batch([...before, ...stmts] as Batch);
    report.counts.quotes.imported++;
  }

  // ---------- Invoices and their payments ----------
  const paymentsOf = new Map<string, Plan["payments"]>();
  for (const p of plan.payments) {
    report.counts.payments.planned++;
    paymentsOf.set(p.invoiceLegacyId, [...(paymentsOf.get(p.invoiceLegacyId) ?? []), p]);
  }
  for (const inv of plan.invoices) {
    report.counts.invoices.planned++;
    const pays = paymentsOf.get(inv.legacyId) ?? [];
    if (idOf("invoices", inv.legacyId)) {
      report.counts.invoices.already++;
      report.counts.payments.already += pays.filter((p) => idOf("payments", p.legacyId)).length;
      continue;
    }
    const clientId = idOf("customers", inv.clientLegacyId);
    let status: PlanInvoice["status"] = inv.status;
    if (status !== "draft" && !clientId) {
      warn(`Invoice ${inv.number ?? inv.legacyId} has no client; imported as a draft without its payments`);
      status = "draft";
    }
    const content = contentOf(inv);
    const totals = computeContent(content);
    const totalCents = totals.computed.totalCents;
    report.totals.push({
      kind: "invoice",
      number: inv.number,
      legacyCents: inv.legacyTotalCents,
      newCents: totalCents,
    });
    const id = newId("inv");
    const created = isoAt(inv.issueDate);
    const link = inv.fromQuoteNumber ? projectByQuoteNumber.get(inv.fromQuoteNumber) : undefined;
    const stmts: BatchItem<"sqlite">[] = [];
    if (status === "draft") {
      stmts.push(
        ctx.db.insert(schema.invoice).values({
          id,
          businessId: biz,
          createdBy: ctx.user.id,
          createdAt: created,
          clientId,
          projectId: link?.projectId ?? null,
          quoteId: link?.quoteId ?? null,
          kind: "standard",
          status: "draft",
          dueDate: inv.dueDate,
          draftContent: content,
          draftTotalCents: totalCents,
          draftVersion: 1,
          currency: CURRENCY,
        }),
      );
      if (pays.length) {
        warn(
          `Invoice ${inv.number ?? inv.legacyId}: ${pays.length} payment(s) not imported because it is a draft`,
        );
        report.counts.payments.skipped += pays.length;
      }
    } else {
      const number = freeNumber(invoiceNumbers, inv.number, "Invoice");
      const settled = pays.reduce((s, p) => s + p.amountCents, 0);
      const derived =
        status === "void"
          ? "void"
          : deriveInvoiceStatus({
              totalCents,
              settledCents: settled,
              viewed: false,
              pastDue: false,
              openRequest: false,
            });
      if (inv.status === "paid" && derived !== "paid")
        warn(
          `Invoice ${number}: paid in the old app, but its payments cover only part of it; it shows as ${derived.replace("_", " ")}`,
        );
      if (settled > totalCents)
        warn(`Invoice ${number}: payments are more than its total; check for a duplicate payment`);
      const revisionId = newId("irv");
      const issueDate = inv.issueDate ?? today;
      const dueDate = inv.dueDate ?? addDays(issueDate, 14);
      const frozen: DocumentContent = {
        ...content,
        header: {
          title: null,
          clientId,
          siteId: null,
          validUntil: null,
          poReference: null,
          termsDays: null,
          dueDate,
        },
      };
      const contentHash = await sha256Hex(
        canonicalJson({ content: frozen, currency: CURRENCY } as unknown as Json),
      );
      stmts.push(
        ctx.db.insert(schema.invoice).values({
          id,
          businessId: biz,
          createdBy: ctx.user.id,
          createdAt: created,
          clientId,
          projectId: link?.projectId ?? null,
          quoteId: link?.quoteId ?? null,
          kind: "standard",
          number,
          status: derived,
          issueDate,
          dueDate,
          currentRevisionId: revisionId,
          draftVersion: 1,
          currency: CURRENCY,
          voidedAt: derived === "void" ? new Date().toISOString() : null,
          voidReason: derived === "void" ? "Void in the old app" : null,
        }),
        ctx.db.insert(schema.invoiceRevision).values({
          id: revisionId,
          invoiceId: id,
          revisionNo: 1,
          content: frozen,
          subtotalCents: totals.computed.subtotalCents,
          discountCents: totals.computed.discountCents,
          taxCents: totals.computed.taxCents,
          totalCents,
          contentHash,
          sentAt: created,
          createdAt: created,
          createdBy: ctx.user.id,
        }),
        ...reportingLines(ctx, id, revisionId, frozen, totals),
      );
      for (const p of pays) {
        const paymentId = newId("pay");
        stmts.push(
          ctx.db.insert(schema.payment).values({
            id: paymentId,
            businessId: biz,
            createdBy: ctx.user.id,
            invoiceId: id,
            clientId: clientId!,
            amountCents: p.amountCents,
            method: p.method,
            receivedOn: p.receivedOn,
            note: p.note,
          }),
          mapRow("payments", p.legacyId, paymentId),
        );
        report.counts.payments.imported++;
      }
    }
    stmts.push(
      mapRow("invoices", inv.legacyId, id),
      audit(ctx, "invoice", id, { from: "old app", number: inv.number }),
    );
    await ctx.db.batch(stmts as Batch);
    report.counts.invoices.imported++;
  }

  // ---------- Expenses (receipts copied to R2, SPEC 12.1 step 9) ----------
  for (const e of plan.expenses) {
    report.counts.expenses.planned++;
    if (idOf("expenses", e.legacyId)) {
      report.counts.expenses.already++;
      continue;
    }
    let receiptKey: string | null = null;
    if (e.receiptUrl) {
      const file = await opts.receipt?.(e);
      if (file) {
        const ext =
          file.type === "application/pdf" ? "pdf" : (file.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        receiptKey = `receipts/${biz}/${newId("exp").slice(4)}.${ext}`;
        await ctx.env.FILES.put(receiptKey, file.bytes, { httpMetadata: { contentType: file.type } });
      } else {
        warn(`Expense ${e.supplier} on ${e.date}: its receipt wasn't in the export`);
      }
    }
    const id = newId("exp");
    await ctx.db.batch([
      ctx.db.insert(schema.expense).values({
        id,
        businessId: biz,
        createdBy: ctx.user.id,
        date: e.date,
        supplier: e.supplier,
        category: e.category,
        amountCents: e.amountCents,
        vatCents: 0,
        note: e.note,
        receiptKey,
      }),
      mapRow("expenses", e.legacyId, id),
      audit(ctx, "expense", id, { from: "old app" }),
    ]);
    report.counts.expenses.imported++;
  }

  // ---------- Sequences start above the highest migrated number (SPEC 12.1 step 6) ----------
  for (const kind of ["quote", "invoice"] as const) {
    const [seq] = await ctx.db
      .select()
      .from(schema.sequence)
      .where(and(eq(schema.sequence.businessId, biz), eq(schema.sequence.kind, kind)));
    if (!seq) continue;
    const pattern = new RegExp(`^${seq.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
    const numbers = [...(kind === "quote" ? quoteNumbers : invoiceNumbers)];
    const highest = Math.max(0, ...numbers.map((n) => Number(pattern.exec(n)?.[1] ?? 0)));
    const after = Math.max(seq.nextValue, highest + 1);
    if (after !== seq.nextValue) {
      await ctx.db
        .update(schema.sequence)
        .set({
          nextValue: sql`max(${schema.sequence.nextValue}, ${after})`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.sequence.id, seq.id));
    }
    report.sequences.push({ kind, before: seq.nextValue, after });
  }

  // ---------- Reconcile outstanding per client (SPEC 12.1 step 8) ----------
  const legacyOutstanding = new Map<string, number>();
  for (const inv of plan.invoices) {
    if (inv.status === "draft" || inv.status === "void" || !inv.clientLegacyId) continue;
    legacyOutstanding.set(
      inv.clientLegacyId,
      (legacyOutstanding.get(inv.clientLegacyId) ?? 0) + (inv.legacyBalanceCents ?? 0),
    );
  }
  for (const c of plan.clients) {
    const id = idOf("customers", c.legacyId);
    if (!id) continue;
    const [balance] = await ctx.db
      .select()
      .from(schema.clientBalance)
      .where(eq(schema.clientBalance.clientId, id));
    report.clients.push({
      name: c.displayName,
      legacyOutstandingCents: legacyOutstanding.get(c.legacyId) ?? 0,
      newOutstandingCents: balance
        ? balance.billedCents - balance.paidCents - balance.creditsAppliedCents
        : 0,
    });
  }
  return report;
}
