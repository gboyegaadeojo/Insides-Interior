// Job steps for lists (owner request, mockup approved 2026-10-30): quotes with
// the step they're on and their next action, for the Quotes list and Home.
// Read-only; the steps themselves are app/domain/job.ts.
//
// D1's free plan allows 5 million row reads a day per account, so the lists
// filter and page in SQL and work out steps only for the rows they show; the
// cost of a screen stays flat however many finished jobs build up.

import { and, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { type JobGroup, type JobInvoice, jobStage } from "~/domain/job";
import { isPastValidUntil } from "~/domain/portal";
import { addDays, businessToday } from "~/lib/dates";
import { likeTerm } from "~/lib/like";
import { type Db, schema } from "~/server/db";
import type { JobFilter } from "./filters";

type Ctx = { db: Db; user: { businessId: string } };

const q = schema.quote;
const i = schema.invoice;

const paidSql = sql<number>`coalesce((select sum(${schema.payment.amountCents} + ${schema.payment.whtCents}) from ${schema.payment} where ${schema.payment.invoiceId} = ${i.id} and ${schema.payment.deletedAt} is null), 0)`;

/**
 * An approved quote still in progress: no final (or full) invoice sent yet, or
 * a sent invoice not yet paid. Matches jobStage: complete is the rest.
 */
const openApproved = sql`(${q.status} = 'approved' and (
  not exists (select 1 from invoice fi where fi.quote_id = "quote"."id" and fi.kind in ('final', 'standard') and fi.status not in ('draft', 'void'))
  or exists (select 1 from invoice ui where ui.quote_id = "quote"."id" and ui.status not in ('paid', 'draft', 'void'))
))`;

/** SQL for each list filter; mirrors JOB_FILTER_GROUPS. */
function filterSql(filter: Exclude<JobFilter, "all">, today: string): SQL {
  // Expired quotes need the owner for a month; after that they only show under All.
  const recent = addDays(today, -30);
  switch (filter) {
    case "needs":
      return sql`(${q.status} in ('draft', 'changes_requested')
        or (${q.status} in ('sent', 'viewed') and ${q.validUntil} < ${today})
        or (${q.status} = 'expired' and ${q.validUntil} >= ${recent})
        or ${openApproved})`;
    case "waiting":
      return sql`(${q.status} in ('sent', 'viewed') and (${q.validUntil} is null or ${q.validUntil} >= ${today}))`;
    case "complete":
      return sql`(${q.status} = 'approved' and not ${openApproved})`;
  }
}

function searchSql(query?: string): SQL | undefined {
  const pattern = query?.trim() ? likeTerm(query.trim().toLowerCase()) : null;
  if (!pattern) return undefined;
  return or(
    sql`lower(coalesce(${q.number}, '')) LIKE ${pattern} ESCAPE '\\'`,
    sql`lower(coalesce(${q.title}, '')) LIKE ${pattern} ESCAPE '\\'`,
    sql`lower(coalesce(${schema.client.displayName}, '')) LIKE ${pattern} ESCAPE '\\'`,
  );
}

/** Quotes matching `where`, newest first, each with its job stage. */
export async function jobsFor(ctx: Ctx, opts: { where?: SQL; query?: string; limit: number }) {
  const quotes = await ctx.db
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
    .where(and(eq(q.businessId, ctx.user.businessId), opts.where, searchSql(opts.query)))
    .orderBy(desc(q.updatedAt))
    .limit(opts.limit + 1);

  // Invoices only for the approved quotes shown, in chunks under D1's 100 bound values.
  const approvedIds = quotes.filter((x) => x.status === "approved").map((x) => x.id);
  const invoices = [];
  for (let at = 0; at < approvedIds.length; at += 90) {
    invoices.push(
      ...(await ctx.db
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
        .leftJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
        .where(
          and(eq(i.businessId, ctx.user.businessId), inArray(i.quoteId, approvedIds.slice(at, at + 90))),
        )),
    );
  }
  const byQuote = new Map<string, (JobInvoice & { totalCents: number; paidCents: number })[]>();
  for (const row of invoices) {
    const list = byQuote.get(row.quoteId!) ?? [];
    const totalCents = row.totalCents ?? 0;
    list.push({ ...row, totalCents, balanceCents: totalCents - row.paidCents });
    byQuote.set(row.quoteId!, list);
  }

  const today = businessToday();
  const jobs = quotes.slice(0, opts.limit).map((quote) => {
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
    const invoicedCents = live.reduce((s, x) => s + x.totalCents, 0);
    const current = own.find((x) => x.id === stage.invoiceId);
    return {
      ...quote,
      stage,
      paidCents: live.reduce((s, x) => s + x.paidCents, 0),
      /** Approved total not yet invoiced (what the final invoice will bill). */
      leftToBillCents: quote.approvedTotalCents ? Math.max(0, quote.approvedTotalCents - invoicedCents) : 0,
      /** Owed on the invoice the current step is about. */
      dueCents: current ? current.balanceCents : null,
    };
  });
  return { jobs, hasMore: quotes.length > opts.limit };
}

export type Job = Awaited<ReturnType<typeof jobsFor>>["jobs"][number];

/** Quotes list: one filter's jobs, newest first, plus the count in each filter (one scan). */
export async function listJobs(ctx: Ctx, opts: { filter?: JobFilter; query?: string; limit: number }) {
  const today = businessToday();
  const filter = opts.filter ?? "all";
  const [[counts], page] = await Promise.all([
    ctx.db
      .select({
        needs: sql<number>`coalesce(sum(case when ${filterSql("needs", today)} then 1 else 0 end), 0)`,
        waiting: sql<number>`coalesce(sum(case when ${filterSql("waiting", today)} then 1 else 0 end), 0)`,
        complete: sql<number>`coalesce(sum(case when ${filterSql("complete", today)} then 1 else 0 end), 0)`,
        all: sql<number>`count(*)`,
      })
      .from(q)
      .leftJoin(schema.client, eq(schema.client.id, q.clientId))
      .where(and(eq(q.businessId, ctx.user.businessId), searchSql(opts.query))),
    jobsFor(ctx, {
      where: filter === "all" ? undefined : filterSql(filter, today),
      query: opts.query,
      limit: opts.limit,
    }),
  ]);
  return {
    jobs: page.jobs,
    hasMore: page.hasMore,
    counts: counts ?? { needs: 0, waiting: 0, complete: 0, all: 0 },
  };
}

/** Home: open jobs grouped by what they need next, longest waiting first within a group. */
export async function jobsByNextStep(ctx: Ctx, perGroup = 5) {
  const today = businessToday();
  const { jobs } = await jobsFor(ctx, {
    where: or(filterSql("needs", today), filterSql("waiting", today)),
    limit: 200,
  });
  const groups: Record<Exclude<JobGroup, "complete" | "closed">, Job[]> = {
    now: [],
    money: [],
    finish: [],
    waiting: [],
  };
  for (const job of jobs) {
    const g = job.stage.group;
    if (g === "complete" || g === "closed") continue;
    groups[g].push(job);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([g, list]) => [
      g,
      { total: list.length, jobs: list.reverse().slice(0, perGroup) },
    ]),
  ) as Record<keyof typeof groups, { total: number; jobs: Job[] }>;
}
