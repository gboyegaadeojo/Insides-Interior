// Job steps for lists (owner request, mockup approved 2026-10-30): every quote
// with the step it's on and its next action, for the Quotes list and Home.
// Read-only; the steps themselves are app/domain/job.ts.

import { and, desc, eq, or, sql } from "drizzle-orm";
import { type JobGroup, type JobInvoice, jobStage } from "~/domain/job";
import { isPastValidUntil } from "~/domain/portal";
import { businessToday } from "~/lib/dates";
import { likeTerm } from "~/lib/like";
import { type Db, schema } from "~/server/db";
import { JOB_FILTER_GROUPS, type JobFilter } from "./filters";

type Ctx = { db: Db; user: { businessId: string } };

const paidSql = sql<number>`coalesce((select sum(${schema.payment.amountCents} + ${schema.payment.whtCents}) from ${schema.payment} where ${schema.payment.invoiceId} = ${schema.invoice.id} and ${schema.payment.deletedAt} is null), 0)`;

/**
 * Every quote (matching the search) with its job stage. Invoices are read only
 * for approved quotes, through a join, so the query never lists ids (D1 caps
 * bound values at 100).
 */
export async function jobsFor(ctx: Ctx, opts: { query?: string; activeOnly?: boolean } = {}) {
  const q = schema.quote;
  const i = schema.invoice;
  const pattern = opts.query?.trim() ? likeTerm(opts.query.trim().toLowerCase()) : null;
  const [quotes, invoices] = await Promise.all([
    ctx.db
      .select({
        id: q.id,
        number: q.number,
        title: q.title,
        status: q.status,
        validUntil: q.validUntil,
        depositType: q.depositType,
        depositValue: q.depositValue,
        updatedAt: q.updatedAt,
        clientId: q.clientId,
        clientName: schema.client.displayName,
        totalCents: sql<number>`coalesce(${schema.quoteRevision.totalCents}, ${q.draftTotalCents}, 0)`,
        sentAt: schema.quoteRevision.sentAt,
        approvedAt: schema.quoteAcceptance.acceptedAt,
        approvedTotalCents: schema.quoteAcceptance.acceptedTotalCents,
      })
      .from(q)
      .leftJoin(schema.client, eq(schema.client.id, q.clientId))
      .leftJoin(schema.quoteRevision, eq(schema.quoteRevision.id, q.currentRevisionId))
      .leftJoin(schema.quoteAcceptance, eq(schema.quoteAcceptance.quoteRevisionId, q.currentRevisionId))
      .where(
        and(
          eq(q.businessId, ctx.user.businessId),
          opts.activeOnly ? sql`${q.status} <> 'declined'` : undefined,
          pattern
            ? or(
                sql`lower(coalesce(${q.number}, '')) LIKE ${pattern} ESCAPE '\\'`,
                sql`lower(coalesce(${q.title}, '')) LIKE ${pattern} ESCAPE '\\'`,
                sql`lower(coalesce(${schema.client.displayName}, '')) LIKE ${pattern} ESCAPE '\\'`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(q.updatedAt)),
    ctx.db
      .select({
        id: i.id,
        quoteId: i.quoteId,
        kind: i.kind,
        status: i.status,
        issueDate: i.issueDate,
        totalCents: schema.invoiceRevision.totalCents,
        paidCents: paidSql,
      })
      .from(i)
      .innerJoin(q, eq(q.id, i.quoteId))
      .leftJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
      .where(and(eq(i.businessId, ctx.user.businessId), eq(q.status, "approved"))),
  ]);
  const byQuote = new Map<string, (JobInvoice & { totalCents: number; paidCents: number })[]>();
  for (const row of invoices) {
    const list = byQuote.get(row.quoteId!) ?? [];
    const totalCents = row.totalCents ?? 0;
    list.push({ ...row, totalCents, balanceCents: totalCents - row.paidCents });
    byQuote.set(row.quoteId!, list);
  }
  const today = businessToday();
  return quotes.map((quote) => {
    const own = byQuote.get(quote.id) ?? [];
    const stage = jobStage({
      quoteStatus: quote.status,
      pastValidUntil: isPastValidUntil(quote.validUntil, today),
      hasDeposit: !!quote.depositType && !!quote.depositValue,
      sentOn: quote.sentAt ? businessToday(new Date(quote.sentAt)) : null,
      approvedOn: quote.approvedAt ? businessToday(new Date(quote.approvedAt)) : null,
      invoices: own,
    });
    const live = own.filter((x) => x.status !== "void" && x.status !== "draft");
    const paidCents = live.reduce((s, x) => s + x.paidCents, 0);
    const invoicedCents = live.reduce((s, x) => s + x.totalCents, 0);
    const current = own.find((x) => x.id === stage.invoiceId);
    return {
      ...quote,
      stage,
      paidCents,
      /** Approved total not yet invoiced (what the final invoice will bill). */
      leftToBillCents: quote.approvedTotalCents ? Math.max(0, quote.approvedTotalCents - invoicedCents) : 0,
      /** Owed on the invoice the current step is about. */
      dueCents: current ? current.balanceCents : null,
    };
  });
}

export type Job = Awaited<ReturnType<typeof jobsFor>>[number];

/** Quotes list: the jobs in one filter, newest first, plus the count of each filter. */
export async function listJobs(ctx: Ctx, opts: { filter?: JobFilter; query?: string; limit: number }) {
  const all = await jobsFor(ctx, { query: opts.query });
  const counts = { needs: 0, waiting: 0, complete: 0, all: all.length } satisfies Record<JobFilter, number>;
  for (const job of all) {
    for (const f of ["needs", "waiting", "complete"] as const) {
      if (JOB_FILTER_GROUPS[f].includes(job.stage.group)) counts[f] += 1;
    }
  }
  const filter = opts.filter ?? "all";
  const chosen =
    filter === "all" ? all : all.filter((j) => JOB_FILTER_GROUPS[filter].includes(j.stage.group));
  return { jobs: chosen.slice(0, opts.limit), hasMore: chosen.length > opts.limit, counts };
}

/** Home: open jobs grouped by what they need next, oldest wait first within a group. */
export async function jobsByNextStep(ctx: Ctx, perGroup = 5) {
  const all = await jobsFor(ctx, { activeOnly: true });
  const groups: Record<Exclude<JobGroup, "complete" | "closed">, Job[]> = {
    now: [],
    money: [],
    finish: [],
    waiting: [],
  };
  for (const job of all) {
    const g = job.stage.group;
    if (g === "complete" || g === "closed") continue;
    groups[g].push(job);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([g, jobs]) => [
      g,
      { total: jobs.length, jobs: jobs.reverse().slice(0, perGroup) },
    ]),
  ) as Record<keyof typeof groups, { total: number; jobs: Job[] }>;
}
