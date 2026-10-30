// Home and reports (SPEC 5.11). Reads only. Every figure comes from source
// rows (current invoice revisions, their reporting lines, payments, expenses)
// with the definitions in app/domain/reports.ts, so Home, the report screens
// and the CSV export agree; tests/integration/reports.test.ts reconciles them.

import { and, asc, between, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { pdfFileName } from "~/domain/numbering";
import { ageBalances, cashShare, expenseNetCents, monthKeys } from "~/domain/reports";
import { OUTSTANDING } from "~/features/invoices/service";
import { awaitingSummary } from "~/features/quotes/service";
import { listThreads } from "~/features/conversations/service";
import { type Job, jobsByNextStep } from "~/features/jobs/service";
import { formatCents } from "~/domain/money";
import { businessToday, formatDate } from "~/lib/dates";
import { schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import { csvMoney, toCsv } from "~/lib/csv";
import { categoryOf } from "~/features/expenses/constants";
import { INVOICE_KIND_LABEL, PAYMENT_METHOD_LABEL } from "~/features/invoices/constants";
import type { Basis, ExportKind } from "./constants";

type Ctx = Pick<RequestContext, "db" | "user">;
export interface Period {
  from: string;
  to: string;
}

const i = schema.invoice;
const r = schema.invoiceRevision;
const p = schema.payment;

/** Σ cash + WHT of live payments on an invoice (as the invoice list counts it). */
const paidSql = sql<number>`coalesce((select sum(${p.amountCents} + ${p.whtCents}) from ${p} where ${p.invoiceId} = ${i.id} and ${p.deletedAt} is null), 0)`;
const issued = sql`${i.status} not in ('draft', 'void')`;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let n = 0; n < list.length; n += size) out.push(list.slice(n, n + size));
  return out;
}

// ---------- Home (FR-RPT-01, FR-RPT-06) ----------

export async function homeKpis(ctx: Ctx) {
  const monthStart = `${businessToday().slice(0, 8)}01`;
  const [[open], [paid], awaiting] = await Promise.all([
    ctx.db
      .select({
        outstandingCents: sql<number>`coalesce(sum(${r.totalCents} - ${paidSql}), 0)`,
        outstandingCount: sql<number>`count(*)`,
        overdueCents: sql<number>`coalesce(sum(case when ${i.status} = 'overdue' then ${r.totalCents} - ${paidSql} else 0 end), 0)`,
        overdueCount: sql<number>`coalesce(sum(case when ${i.status} = 'overdue' then 1 else 0 end), 0)`,
      })
      .from(i)
      .innerJoin(r, eq(r.id, i.currentRevisionId))
      .where(and(eq(i.businessId, ctx.user.businessId), inArray(i.status, OUTSTANDING))),
    ctx.db
      .select({
        cents: sql<number>`coalesce(sum(${p.amountCents} + ${p.whtCents}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(p)
      .innerJoin(i, eq(i.id, p.invoiceId))
      .where(
        and(
          eq(p.businessId, ctx.user.businessId),
          isNull(p.deletedAt),
          ne(i.status, "void"),
          gte(p.receivedOn, monthStart),
        ),
      ),
    awaitingSummary(ctx),
  ]);
  return {
    monthStart,
    outstandingCents: open?.outstandingCents ?? 0,
    outstandingCount: open?.outstandingCount ?? 0,
    overdueCents: open?.overdueCents ?? 0,
    overdueCount: open?.overdueCount ?? 0,
    paidMonthCents: paid?.cents ?? 0,
    paidMonthCount: paid?.count ?? 0,
    awaitingCents: awaiting.totalCents,
    awaitingCount: awaiting.count,
  };
}

export type NeedsItem = {
  key: string;
  kind: "request" | "message" | "overdue" | "draft" | "job";
  status: string;
  /** "Quote Q-1004", "Invoice INV-1007". */
  title: string;
  clientName: string | null;
  /** One line under the name: the step, a balance or a message preview. */
  line: string;
  to: string;
  /** Button label; null when nothing is needed (waiting on the client). */
  action: string | null;
  /** A job's step: the screen renders its own button (some steps post a form). */
  job?: { quoteId: string; stage: Job["stage"] };
};

export type NeedsGroup = {
  key: "now" | "money" | "finish" | "waiting";
  title: string;
  /** All in the group; items holds the first few. */
  total: number;
  items: NeedsItem[];
};

const GROUP_TITLES: Record<NeedsGroup["key"], string> = {
  now: "Do these now",
  money: "Money to collect",
  finish: "When the work is finished",
  waiting: "Waiting on clients",
};

/**
 * Home "What to do next" (owner request, mockup approved 2026-10-30): every
 * open job by its next step, plus client messages, overdue invoices not from
 * a quote and unsent invoice drafts. Each item has one action.
 */
export async function needsYou(ctx: Ctx, perGroup = 5): Promise<NeedsGroup[]> {
  const [jobs, threads, overdue, invoiceDrafts] = await Promise.all([
    jobsByNextStep(ctx, perGroup),
    listThreads(ctx, { filter: "open", limit: perGroup }),
    ctx.db
      .select({
        id: i.id,
        number: i.number,
        dueDate: i.dueDate,
        clientName: schema.client.displayName,
        balanceCents: sql<number>`${r.totalCents} - ${paidSql}`,
      })
      .from(i)
      .innerJoin(r, eq(r.id, i.currentRevisionId))
      .leftJoin(schema.client, eq(schema.client.id, i.clientId))
      // Invoices from a quote show as that job's "Record payment" step.
      .where(and(eq(i.businessId, ctx.user.businessId), eq(i.status, "overdue"), isNull(i.quoteId)))
      .orderBy(asc(i.dueDate))
      .limit(perGroup),
    ctx.db
      .select({ id: i.id, title: i.title, clientName: schema.client.displayName, updatedAt: i.updatedAt })
      .from(i)
      .leftJoin(schema.client, eq(schema.client.id, i.clientId))
      .where(and(eq(i.businessId, ctx.user.businessId), eq(i.status, "draft"), isNull(i.quoteId)))
      .orderBy(desc(i.updatedAt))
      .limit(3),
  ]);

  const jobItem = (job: Job): NeedsItem => {
    const step = `Step ${job.stage.step} of 7`;
    const detail =
      job.stage.group === "money" && job.dueCents
        ? `${formatCents(job.dueCents)} to collect`
        : job.stage.group === "finish" && job.leftToBillCents
          ? `${formatCents(job.leftToBillCents)} left to bill`
          : job.stage.group === "waiting" && job.validUntil
            ? `valid until ${formatDate(job.validUntil)}`
            : job.stage.headline;
    return {
      key: job.id,
      kind: "job",
      status: job.status,
      title: job.number ? `Quote ${job.number}` : job.title || "Draft quote",
      clientName: job.clientName,
      line: `${step} · ${detail}`,
      to: `/quotes/${job.id}`,
      action: job.stage.actionLabel,
      job: { quoteId: job.id, stage: job.stage },
    };
  };

  const now: NeedsItem[] = [
    // FR-MSG-09: change requests and unread messages lead.
    ...threads.map((t) => ({
      key: t.id,
      kind: t.openRequests > 0 ? ("request" as const) : ("message" as const),
      status: t.openRequests > 0 ? "changes_requested" : t.status,
      title: `${t.entityType === "quote" ? "Quote" : "Invoice"} ${t.number ?? ""}`.trim(),
      clientName: t.clientName,
      line:
        t.openRequests > 0
          ? `${t.openRequests} change request${t.openRequests === 1 ? "" : "s"}`
          : (t.lastBody ?? "New message"),
      to: `/inbox/${t.id}`,
      action: t.openRequests > 0 ? "Review" : "Reply",
    })),
    // A change request already leads above; don't list its quote twice.
    ...jobs.now.jobs
      .filter(
        (j) => !(j.stage.action?.kind === "review_changes" && threads.some((t) => t.number === j.number)),
      )
      .map(jobItem),
    ...invoiceDrafts.map((d) => ({
      key: d.id,
      kind: "draft" as const,
      status: "draft",
      title: d.title || "Untitled invoice",
      clientName: d.clientName,
      line: "Draft invoice, not sent",
      to: `/invoices/${d.id}`,
      action: "Continue",
    })),
  ];
  const money: NeedsItem[] = [
    ...jobs.money.jobs.map(jobItem),
    ...overdue.map((x) => ({
      key: x.id,
      kind: "overdue" as const,
      status: "overdue",
      title: `Invoice ${x.number}`,
      clientName: x.clientName,
      line: `${formatCents(x.balanceCents)} overdue${x.dueDate ? ` since ${formatDate(x.dueDate)}` : ""}`,
      to: `/invoices/${x.id}`,
      action: "Send reminder",
    })),
  ];
  const groups: NeedsGroup[] = [
    {
      key: "now",
      title: GROUP_TITLES.now,
      total: now.length - jobs.now.jobs.length + jobs.now.total,
      items: now.slice(0, perGroup + 3),
    },
    {
      key: "money",
      title: GROUP_TITLES.money,
      total: money.length - jobs.money.jobs.length + jobs.money.total,
      items: money.slice(0, perGroup),
    },
    {
      key: "finish",
      title: GROUP_TITLES.finish,
      total: jobs.finish.total,
      items: jobs.finish.jobs.map(jobItem),
    },
    {
      key: "waiting",
      title: GROUP_TITLES.waiting,
      total: jobs.waiting.total,
      items: jobs.waiting.jobs.map(jobItem),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Recent activity for Home, with the client behind each record for its avatar. */
export async function recentActivity(ctx: Ctx, limit = 8) {
  const a = schema.activity;
  const q = schema.quote;
  const clientId = sql<
    string | null
  >`coalesce(${q.clientId}, ${i.clientId}, case when ${a.entityType} = 'client' then ${a.entityId} end, ${schema.project.clientId}, ${p.clientId})`;
  const rows = await ctx.db
    .select({
      id: a.id,
      action: a.action,
      data: a.data,
      at: a.at,
      actor: a.actor,
      entityType: a.entityType,
      entityId: a.entityId,
      number: sql<string | null>`coalesce(${q.number}, ${i.number})`,
      projectName: schema.project.name,
      clientName: sql<
        string | null
      >`(select ${schema.client.displayName} from ${schema.client} where ${schema.client.id} = ${clientId})`,
    })
    .from(a)
    .leftJoin(q, and(eq(a.entityType, "quote"), eq(q.id, a.entityId)))
    .leftJoin(i, and(eq(a.entityType, "invoice"), eq(i.id, a.entityId)))
    .leftJoin(schema.project, and(eq(a.entityType, "project"), eq(schema.project.id, a.entityId)))
    .leftJoin(p, and(eq(a.entityType, "payment"), eq(p.id, a.entityId)))
    .where(eq(a.businessId, ctx.user.businessId))
    .orderBy(desc(a.at))
    .limit(limit);
  return rows;
}

/** Revenue (accrual, pre-tax) vs expenses (net of VAT) per month (DS-COL-09: Teal vs Rose clay). */
export async function revenueVsExpenses(ctx: Ctx, period: Period) {
  const e = schema.expense;
  const [revenue, expenses] = await Promise.all([
    ctx.db
      .select({
        month: sql<string>`substr(${i.issueDate}, 1, 7)`,
        cents: sql<number>`sum(${r.totalCents} - ${r.taxCents})`,
      })
      .from(i)
      .innerJoin(r, eq(r.id, i.currentRevisionId))
      .where(and(eq(i.businessId, ctx.user.businessId), issued, between(i.issueDate, period.from, period.to)))
      .groupBy(sql`substr(${i.issueDate}, 1, 7)`),
    ctx.db
      .select({
        month: sql<string>`substr(${e.date}, 1, 7)`,
        cents: sql<number>`sum(${e.amountCents} - ${e.vatCents})`,
      })
      .from(e)
      .where(
        and(
          eq(e.businessId, ctx.user.businessId),
          isNull(e.deletedAt),
          between(e.date, period.from, period.to),
        ),
      )
      .groupBy(sql`substr(${e.date}, 1, 7)`),
  ]);
  const rev = new Map(revenue.map((x) => [x.month, x.cents]));
  const exp = new Map(expenses.map((x) => [x.month, x.cents]));
  return monthKeys(period.from, period.to).map((month) => ({
    month,
    revenueCents: rev.get(month) ?? 0,
    expensesCents: exp.get(month) ?? 0,
  }));
}

// ---------- Aged receivables (FR-RPT-02) ----------

export async function agedReceivables(ctx: Ctx, today = businessToday()) {
  const rows = await ctx.db
    .select({
      id: i.id,
      number: i.number,
      dueDate: i.dueDate,
      issueDate: i.issueDate,
      status: i.status,
      clientId: sql<string>`coalesce(${i.clientId}, '')`,
      clientName: schema.client.displayName,
      totalCents: r.totalCents,
      balanceCents: sql<number>`${r.totalCents} - ${paidSql}`,
    })
    .from(i)
    .innerJoin(r, eq(r.id, i.currentRevisionId))
    .leftJoin(schema.client, eq(schema.client.id, i.clientId))
    .where(and(eq(i.businessId, ctx.user.businessId), inArray(i.status, OUTSTANDING)))
    .orderBy(asc(i.dueDate));
  const { byClient, total } = ageBalances(rows, today);
  const names = new Map(rows.map((x) => [x.clientId, x.clientName ?? "No client"]));
  const clients = [...byClient.entries()]
    .map(([clientId, aging]) => ({ clientId, clientName: names.get(clientId) ?? "No client", ...aging }))
    .sort((a, b) => b.totalCents - a.totalCents);
  return { today, clients, total, invoices: rows.filter((x) => x.balanceCents !== 0) };
}

// ---------- Cash allocation ----------

interface InvoiceParts {
  totalCents: number;
  /** Pre-tax revenue. */
  netCents: number;
  /** By tax rate id: taxable and tax. */
  taxes: Map<string, { taxableCents: number; taxCents: number; rateBp: number }>;
  /** Net by item type ("other" for lines without one). */
  byType: Map<string, number>;
  clientId: string | null;
}

/** Totals, taxes and item-type split of the current revision of each invoice. */
async function invoiceParts(ctx: Ctx, ids: string[]) {
  const parts = new Map<string, InvoiceParts>();
  for (const group of chunk([...new Set(ids)], 90)) {
    const [heads, taxes, types] = await Promise.all([
      ctx.db
        .select({ id: i.id, clientId: i.clientId, totalCents: r.totalCents, taxCents: r.taxCents })
        .from(i)
        .innerJoin(r, eq(r.id, i.currentRevisionId))
        .where(inArray(i.id, group)),
      ctx.db
        .select({
          invoiceId: schema.invoiceLine.invoiceId,
          taxRateId: schema.invoiceLineTax.taxRateId,
          rateBp: schema.invoiceLineTax.rateBp,
          taxableCents: sql<number>`sum(${schema.invoiceLineTax.taxableCents})`,
          taxCents: sql<number>`sum(${schema.invoiceLineTax.taxCents})`,
        })
        .from(schema.invoiceLineTax)
        .innerJoin(schema.invoiceLine, eq(schema.invoiceLine.id, schema.invoiceLineTax.invoiceLineId))
        .where(inArray(schema.invoiceLine.invoiceId, group))
        .groupBy(schema.invoiceLine.invoiceId, schema.invoiceLineTax.taxRateId, schema.invoiceLineTax.rateBp),
      ctx.db
        .select({
          invoiceId: schema.invoiceLine.invoiceId,
          type: sql<string>`coalesce(${schema.invoiceLine.itemType}, 'other')`,
          cents: sql<number>`sum(${schema.invoiceLine.lineTotalCents})`,
        })
        .from(schema.invoiceLine)
        .where(inArray(schema.invoiceLine.invoiceId, group))
        .groupBy(schema.invoiceLine.invoiceId, sql`coalesce(${schema.invoiceLine.itemType}, 'other')`),
    ]);
    for (const h of heads) {
      parts.set(h.id, {
        totalCents: h.totalCents,
        netCents: h.totalCents - h.taxCents,
        taxes: new Map(),
        byType: new Map(),
        clientId: h.clientId,
      });
    }
    for (const t of taxes) {
      parts.get(t.invoiceId)?.taxes.set(t.taxRateId, {
        taxableCents: t.taxableCents,
        taxCents: t.taxCents,
        rateBp: t.rateBp,
      });
    }
    for (const t of types) parts.get(t.invoiceId)?.byType.set(t.type, t.cents);
  }
  return parts;
}

/** Live payments received in the period, each with what was settled on its invoice before it. */
async function paymentsIn(ctx: Ctx, period: Period) {
  const before = sql<number>`coalesce((select sum(p2.amount_cents + p2.wht_cents) from payment p2 where p2.invoice_id = ${p.invoiceId} and p2.deleted_at is null and (p2.received_on < ${p.receivedOn} or (p2.received_on = ${p.receivedOn} and p2.id < ${p.id}))), 0)`;
  return ctx.db
    .select({
      id: p.id,
      invoiceId: p.invoiceId,
      receivedOn: p.receivedOn,
      settledCents: sql<number>`${p.amountCents} + ${p.whtCents}`,
      settledBeforeCents: before,
    })
    .from(p)
    .innerJoin(i, eq(i.id, p.invoiceId))
    .where(
      and(
        eq(p.businessId, ctx.user.businessId),
        isNull(p.deletedAt),
        ne(i.status, "void"),
        between(p.receivedOn, period.from, period.to),
      ),
    )
    .orderBy(asc(p.receivedOn), asc(p.id));
}

type Share = (partCents: number) => number;

/**
 * Walks the period on the chosen basis, calling `visit` once per invoice
 * (accrual: issued in the period, share = everything) or per payment (cash:
 * share = the payment's part of the invoice, cashShare).
 */
async function walk(
  ctx: Ctx,
  period: Period,
  basis: Basis,
  visit: (parts: InvoiceParts, share: Share, month: string) => void,
) {
  if (basis === "accrual") {
    const rows = await ctx.db
      .select({ id: i.id, issueDate: i.issueDate })
      .from(i)
      .where(
        and(eq(i.businessId, ctx.user.businessId), issued, between(i.issueDate, period.from, period.to)),
      );
    const parts = await invoiceParts(
      ctx,
      rows.map((x) => x.id),
    );
    for (const row of rows) {
      const part = parts.get(row.id);
      if (part) visit(part, (c) => c, (row.issueDate ?? "").slice(0, 7));
    }
    return;
  }
  const payments = await paymentsIn(ctx, period);
  const parts = await invoiceParts(
    ctx,
    payments.map((x) => x.invoiceId),
  );
  for (const pay of payments) {
    const part = parts.get(pay.invoiceId);
    if (!part) continue;
    visit(
      part,
      (partCents) =>
        cashShare({
          partCents,
          invoiceTotalCents: part.totalCents,
          settledBeforeCents: pay.settledBeforeCents,
          paymentCents: pay.settledCents,
        }),
      pay.receivedOn.slice(0, 7),
    );
  }
}

// ---------- VAT (FR-RPT-03) ----------

export async function salesTaxReport(ctx: Ctx, period: Period, basis: Basis) {
  const byRate = new Map<string, { taxableCents: number; taxCents: number; rateBp: number }>();
  let salesCents = 0;
  await walk(ctx, period, basis, (parts, share) => {
    salesCents += share(parts.netCents);
    for (const [rateId, t] of parts.taxes) {
      const row = byRate.get(rateId) ?? { taxableCents: 0, taxCents: 0, rateBp: t.rateBp };
      row.taxableCents += share(t.taxableCents);
      row.taxCents += share(t.taxCents);
      byRate.set(rateId, row);
    }
  });
  const rateIds = [...byRate.keys()];
  const names = rateIds.length
    ? await ctx.db
        .select({ id: schema.taxRate.id, name: schema.taxRate.name })
        .from(schema.taxRate)
        .where(inArray(schema.taxRate.id, rateIds.slice(0, 90)))
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const e = schema.expense;
  const [paid] = await ctx.db
    .select({
      vatCents: sql<number>`coalesce(sum(${e.vatCents}), 0)`,
      count: sql<number>`coalesce(sum(case when ${e.vatCents} > 0 then 1 else 0 end), 0)`,
    })
    .from(e)
    .where(
      and(
        eq(e.businessId, ctx.user.businessId),
        isNull(e.deletedAt),
        between(e.date, period.from, period.to),
      ),
    );
  const taxes = [...byRate.entries()]
    .map(([id, t]) => ({ id, name: nameOf.get(id) ?? "Tax", ...t }))
    .sort((a, b) => b.taxCents - a.taxCents);
  const collectedCents = taxes.reduce((s, t) => s + t.taxCents, 0);
  const taxableCents = taxes.reduce((s, t) => s + t.taxableCents, 0);
  return {
    basis,
    period,
    salesCents,
    taxableCents,
    collectedCents,
    taxes,
    paidOnExpensesCents: paid?.vatCents ?? 0,
    expensesWithVat: paid?.count ?? 0,
    netCents: collectedCents - (paid?.vatCents ?? 0),
  };
}

// ---------- Revenue (FR-RPT-04) ----------

export async function revenueReport(ctx: Ctx, period: Period, basis: Basis) {
  const byMonth = new Map<string, number>();
  const byClient = new Map<string, number>();
  const byType = new Map<string, number>();
  let totalCents = 0;
  await walk(ctx, period, basis, (parts, share, month) => {
    const net = share(parts.netCents);
    totalCents += net;
    byMonth.set(month, (byMonth.get(month) ?? 0) + net);
    const client = parts.clientId ?? "";
    byClient.set(client, (byClient.get(client) ?? 0) + net);
    // Types add up to the net exactly: each type's share, the remainder to the largest.
    let allocated = 0;
    let largest: string | null = null;
    for (const [type, cents] of parts.byType) {
      const s = share(cents);
      allocated += s;
      byType.set(type, (byType.get(type) ?? 0) + s);
      if (largest === null || Math.abs(cents) > Math.abs(parts.byType.get(largest) ?? 0)) largest = type;
    }
    const rest = net - allocated;
    if (rest !== 0) byType.set(largest ?? "other", (byType.get(largest ?? "other") ?? 0) + rest);
  });
  const clientIds = [...byClient.keys()].filter(Boolean);
  const names = new Map<string, string>();
  for (const group of chunk(clientIds, 90)) {
    const rows = await ctx.db
      .select({ id: schema.client.id, name: schema.client.displayName })
      .from(schema.client)
      .where(inArray(schema.client.id, group));
    for (const row of rows) names.set(row.id, row.name);
  }
  return {
    basis,
    period,
    totalCents,
    months: monthKeys(period.from, period.to).map((month) => ({ month, cents: byMonth.get(month) ?? 0 })),
    clients: [...byClient.entries()]
      .map(([id, cents]) => ({ id, name: names.get(id) ?? "No client", cents }))
      .sort((a, b) => b.cents - a.cents),
    types: [...byType.entries()].map(([type, cents]) => ({ type, cents })).sort((a, b) => b.cents - a.cents),
  };
}

// ---------- Exports (FR-RPT-05) ----------

export async function exportCsv(ctx: Ctx, kind: ExportKind, period: Period) {
  if (kind === "invoices") {
    const rows = await ctx.db
      .select({
        number: i.number,
        kind: i.kind,
        status: i.status,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        poReference: i.poReference,
        clientName: schema.client.displayName,
        revisionNo: r.revisionNo,
        subtotalCents: r.subtotalCents,
        discountCents: r.discountCents,
        taxCents: r.taxCents,
        totalCents: r.totalCents,
        paidCents: paidSql,
      })
      .from(i)
      .innerJoin(r, eq(r.id, i.currentRevisionId))
      .leftJoin(schema.client, eq(schema.client.id, i.clientId))
      .where(
        and(
          eq(i.businessId, ctx.user.businessId),
          ne(i.status, "draft"),
          between(i.issueDate, period.from, period.to),
        ),
      )
      .orderBy(asc(i.issueDate), asc(i.number));
    return toCsv(
      [
        "Invoice number",
        "Revision",
        "Type",
        "Status",
        "Issue date",
        "Due date",
        "Client",
        "PO or reference",
        "Subtotal (NGN)",
        "Discount (NGN)",
        "Net before VAT (NGN)",
        "VAT (NGN)",
        "Total (NGN)",
        "Paid incl. WHT (NGN)",
        "Balance (NGN)",
      ],
      rows.map((x) => {
        const isVoid = x.status === "void";
        return [
          x.number,
          x.revisionNo,
          INVOICE_KIND_LABEL[x.kind],
          isVoid ? "Void" : x.status.replaceAll("_", " "),
          x.issueDate,
          x.dueDate,
          x.clientName,
          x.poReference,
          csvMoney(x.subtotalCents),
          csvMoney(x.discountCents),
          csvMoney(x.totalCents - x.taxCents),
          csvMoney(x.taxCents),
          csvMoney(x.totalCents),
          csvMoney(x.paidCents),
          csvMoney(isVoid ? 0 : x.totalCents - x.paidCents),
        ];
      }),
    );
  }
  if (kind === "payments") {
    const rows = await ctx.db
      .select({
        receivedOn: p.receivedOn,
        amountCents: p.amountCents,
        whtCents: p.whtCents,
        whtRateBp: p.whtRateBp,
        whtReference: p.whtReference,
        method: p.method,
        reference: p.reference,
        note: p.note,
        invoiceNumber: i.number,
        invoiceStatus: i.status,
        clientName: schema.client.displayName,
        creditCents: sql<number>`coalesce((select sum(${schema.clientCredit.amountCents}) from ${schema.clientCredit} where ${schema.clientCredit.sourcePaymentId} = ${p.id}), 0)`,
      })
      .from(p)
      .innerJoin(i, eq(i.id, p.invoiceId))
      .innerJoin(schema.client, eq(schema.client.id, p.clientId))
      .where(
        and(
          eq(p.businessId, ctx.user.businessId),
          isNull(p.deletedAt),
          between(p.receivedOn, period.from, period.to),
        ),
      )
      .orderBy(asc(p.receivedOn), asc(p.id));
    return toCsv(
      [
        "Date received",
        "Client",
        "Invoice number",
        "Method",
        "Reference",
        "Cash received (NGN)",
        "WHT deducted (NGN)",
        "WHT rate %",
        "WHT credit note",
        "Settled on invoice (NGN)",
        "Overpayment to credit (NGN)",
        "Invoice void",
        "Note",
      ],
      rows.map((x) => [
        x.receivedOn,
        x.clientName,
        x.invoiceNumber,
        PAYMENT_METHOD_LABEL[x.method],
        x.reference,
        csvMoney(x.amountCents),
        csvMoney(x.whtCents),
        x.whtRateBp === null ? null : x.whtRateBp / 100,
        x.whtReference,
        csvMoney(x.amountCents + x.whtCents),
        csvMoney(x.creditCents),
        x.invoiceStatus === "void" ? "Yes" : "No",
        x.note,
      ]),
    );
  }
  const e = schema.expense;
  const rows = await ctx.db
    .select({
      date: e.date,
      supplier: e.supplier,
      category: e.category,
      amountCents: e.amountCents,
      vatCents: e.vatCents,
      billable: e.billable,
      note: e.note,
      receiptKey: e.receiptKey,
      projectName: schema.project.name,
      billedInvoiceNumber: schema.invoice.number,
      billedInvoiceStatus: schema.invoice.status,
    })
    .from(e)
    .leftJoin(schema.project, eq(schema.project.id, e.projectId))
    .leftJoin(schema.invoice, eq(schema.invoice.id, e.billedInvoiceId))
    .where(
      and(
        eq(e.businessId, ctx.user.businessId),
        isNull(e.deletedAt),
        between(e.date, period.from, period.to),
      ),
    )
    .orderBy(asc(e.date), asc(e.id));
  return toCsv(
    [
      "Date",
      "Supplier",
      "Category",
      "Project",
      "Amount paid (NGN)",
      "VAT paid (NGN)",
      "Net of VAT (NGN)",
      "Billable",
      "Billed on invoice",
      "Receipt",
      "Note",
    ],
    rows.map((x) => [
      x.date,
      x.supplier,
      categoryOf(x.category).label,
      x.projectName,
      csvMoney(x.amountCents),
      csvMoney(x.vatCents),
      csvMoney(expenseNetCents(x)),
      x.billable ? "Yes" : "No",
      x.billedInvoiceStatus && x.billedInvoiceStatus !== "void" ? (x.billedInvoiceNumber ?? "Draft") : null,
      x.receiptKey ? "Yes" : "No",
      x.note,
    ]),
  );
}

/** Sent invoices issued in the period, for the PDF part of the export ZIP. */
export async function exportPdfList(ctx: Ctx, period: Period) {
  const rows = await ctx.db
    .select({ id: i.id, number: i.number, revisionNo: r.revisionNo })
    .from(i)
    .innerJoin(r, eq(r.id, i.currentRevisionId))
    .where(
      and(
        eq(i.businessId, ctx.user.businessId),
        ne(i.status, "draft"),
        between(i.issueDate, period.from, period.to),
      ),
    )
    .orderBy(asc(i.number))
    .limit(500);
  return rows
    .filter((x) => x.number)
    .map((x) => ({ id: x.id, number: x.number!, filename: pdfFileName(x.number!, x.revisionNo) }));
}
