// Global search for the command palette (SPEC 5.12 FR-SYS-01): clients,
// quotes and invoices by number, name or amount. Read only, a few rows each,
// all in SQL (Workers Free CPU).

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { parseMoneyToCents } from "~/domain/money";
import { likeTerm } from "~/lib/like";
import { schema } from "~/server/db";
import type { RequestContext } from "~/server/session";

type Ctx = Pick<RequestContext, "db" | "user">;

const PER_KIND = 5;

export interface SearchHit {
  kind: "client" | "quote" | "invoice";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
  totalCents?: number | null;
}

/** Amount typed as money ("₦121,950.56", "121950.56"); bare short numbers are numbers, not amounts. */
function amountOf(query: string) {
  if (!/[.,₦]/.test(query) && query.replace(/\D/g, "").length < 5) return null;
  const cents = parseMoneyToCents(query);
  return cents !== null && cents > 0 ? cents : null;
}

export async function searchRecords(ctx: Ctx, raw: string): Promise<SearchHit[]> {
  const query = raw.trim().toLowerCase().slice(0, 100);
  if (query.length < 2) return [];
  const pattern = likeTerm(query);
  const like = (column: unknown) => sql`lower(coalesce(${column}, '')) LIKE ${pattern} ESCAPE '\\'`;
  const amount = amountOf(query);
  const biz = ctx.user.businessId;
  const q = schema.quote;
  const i = schema.invoice;
  const c = schema.client;

  const [clients, quotes, invoices] = await Promise.all([
    ctx.db
      .select({ id: c.id, name: c.displayName, company: c.company, email: c.email, phone: c.phone })
      .from(c)
      .where(
        and(
          eq(c.businessId, biz),
          isNull(c.archivedAt),
          or(like(c.displayName), like(c.company), like(c.email), like(c.phone)),
        ),
      )
      .orderBy(sql`lower(${c.displayName})`)
      .limit(PER_KIND),
    ctx.db
      .select({
        id: q.id,
        number: q.number,
        title: q.title,
        status: q.status,
        clientName: c.displayName,
        total: sql<number | null>`coalesce(${schema.quoteRevision.totalCents}, ${q.draftTotalCents})`,
      })
      .from(q)
      .leftJoin(c, eq(c.id, q.clientId))
      .leftJoin(schema.quoteRevision, eq(schema.quoteRevision.id, q.currentRevisionId))
      .where(
        and(
          eq(q.businessId, biz),
          or(
            like(q.number),
            like(q.title),
            like(c.displayName),
            amount !== null
              ? sql`coalesce(${schema.quoteRevision.totalCents}, ${q.draftTotalCents}) = ${amount}`
              : undefined,
          ),
        ),
      )
      .orderBy(desc(q.updatedAt))
      .limit(PER_KIND),
    ctx.db
      .select({
        id: i.id,
        number: i.number,
        title: i.title,
        status: i.status,
        clientName: c.displayName,
        total: sql<number | null>`coalesce(${schema.invoiceRevision.totalCents}, ${i.draftTotalCents})`,
      })
      .from(i)
      .leftJoin(c, eq(c.id, i.clientId))
      .leftJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
      .where(
        and(
          eq(i.businessId, biz),
          or(
            like(i.number),
            like(i.title),
            like(c.displayName),
            like(i.poReference),
            amount !== null
              ? sql`coalesce(${schema.invoiceRevision.totalCents}, ${i.draftTotalCents}) = ${amount}`
              : undefined,
          ),
        ),
      )
      .orderBy(desc(i.updatedAt))
      .limit(PER_KIND),
  ]);

  return [
    ...clients.map((r): SearchHit => ({
      kind: "client",
      id: r.id,
      title: r.name,
      subtitle: r.company ?? r.email ?? r.phone ?? "Client",
      href: `/clients/${r.id}`,
    })),
    ...quotes.map((r): SearchHit => ({
      kind: "quote",
      id: r.id,
      title: r.number ?? "Draft quote",
      subtitle: [r.clientName, r.title].filter(Boolean).join(" · ") || "No client yet",
      href: `/quotes/${r.id}`,
      status: r.status,
      totalCents: r.total,
    })),
    ...invoices.map((r): SearchHit => ({
      kind: "invoice",
      id: r.id,
      title: r.number ?? "Draft invoice",
      subtitle: [r.clientName, r.title].filter(Boolean).join(" · ") || "No client yet",
      href: `/invoices/${r.id}`,
      status: r.status,
      totalCents: r.total,
    })),
  ];
}
