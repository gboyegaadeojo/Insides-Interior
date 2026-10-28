// Clients (SPEC 5.3). The only code that writes clients, contacts and sites.
// Balances come from the client_balance view, never the client row (FR-CLI-03).

import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { likeTerm } from "~/lib/like";
import { ServiceError } from "~/features/settings/service";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { type Address, schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import type { clientSchema, contactSchema, quickClientSchema, siteSchema } from "./schema";

type Ctx = Pick<RequestContext, "db" | "user">;

const nowIso = () => new Date().toISOString();

function audit(ctx: RequestContext, entityId: string, action: string, data?: Record<string, unknown>) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType: "client",
    entityId,
    action,
    data,
  });
}

function toAddress(input: {
  line1: string | null;
  line2?: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
}): Address {
  return {
    line1: input.line1 ?? undefined,
    line2: input.line2 ?? undefined,
    city: input.city ?? undefined,
    province: input.province ?? undefined,
    postalCode: input.postalCode ?? undefined,
  };
}

export function formatAddress(address: Address | null | undefined): string {
  if (!address) return "";
  return [
    address.line1,
    address.line2,
    [address.city, address.province].filter(Boolean).join(", "),
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * FR-CLI-04: search name, company, email, phone and addresses (billing and
 * sites). Archived clients are hidden unless asked for (FR-CLI-05).
 */
export async function listClients(
  ctx: Ctx,
  opts: { query?: string; archived?: boolean; limit?: number } = {},
) {
  const c = schema.client;
  const conditions = [
    eq(c.businessId, ctx.user.businessId),
    opts.archived ? isNotNull(c.archivedAt) : isNull(c.archivedAt),
  ];
  const query = opts.query?.trim();
  if (query) {
    const term = likeTerm(query.toLowerCase());
    const digits = query.replace(/\D/g, "");
    conditions.push(
      or(
        sql`lower(${c.displayName}) LIKE ${term} ESCAPE '\\'`,
        sql`lower(coalesce(${c.company}, '')) LIKE ${term} ESCAPE '\\'`,
        sql`lower(coalesce(${c.email}, '')) LIKE ${term} ESCAPE '\\'`,
        sql`lower(coalesce(${c.billingAddress}, '')) LIKE ${term} ESCAPE '\\'`,
        ...(digits.length >= 3
          ? [
              sql`replace(replace(replace(replace(coalesce(${c.phone}, ''), '-', ''), ' ', ''), '(', ''), ')', '') LIKE ${`%${digits}%`}`,
            ]
          : []),
        sql`EXISTS (SELECT 1 FROM site s WHERE s.client_id = ${c.id} AND lower(coalesce(s.address, '') || ' ' || s.label) LIKE ${term} ESCAPE '\\')`,
      )!,
    );
  }
  return ctx.db
    .select({
      id: c.id,
      displayName: c.displayName,
      company: c.company,
      email: c.email,
      phone: c.phone,
      billingAddress: c.billingAddress,
      tags: c.tags,
      archivedAt: c.archivedAt,
      emailBouncedAt: c.emailBouncedAt,
      outstandingCents: sql<number>`${schema.clientBalance.billedCents} - ${schema.clientBalance.paidCents} - ${schema.clientBalance.creditsAppliedCents}`,
      lastActivityAt: schema.clientBalance.lastActivityAt,
    })
    .from(c)
    .innerJoin(schema.clientBalance, eq(schema.clientBalance.clientId, c.id))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${c.displayName})`))
    .limit(opts.limit ?? CLIENT_PAGE_SIZE);
}

export type ClientListRow = Awaited<ReturnType<typeof listClients>>[number];

/** Rows per page on the client list; "Show more" asks for the next page. */
export const CLIENT_PAGE_SIZE = 50;

/** Active clients and what they owe in total, for the Clients header band. */
export async function clientSummary(ctx: Ctx) {
  const b = schema.clientBalance;
  const [row] = await ctx.db
    .select({
      count: sql<number>`count(*)`,
      outstandingCents: sql<number>`coalesce(sum(max(0, ${b.billedCents} - ${b.paidCents} - ${b.creditsAppliedCents})), 0)`,
    })
    .from(schema.client)
    .innerJoin(b, eq(b.clientId, schema.client.id))
    .where(and(eq(schema.client.businessId, ctx.user.businessId), isNull(schema.client.archivedAt)));
  return { count: row?.count ?? 0, outstandingCents: row?.outstandingCents ?? 0 };
}

export async function getClient(ctx: Ctx, id: string) {
  const c = schema.client;
  const [client] = await ctx.db
    .select()
    .from(c)
    .where(and(eq(c.id, id), eq(c.businessId, ctx.user.businessId)));
  if (!client) return null;
  const [balance] = await ctx.db
    .select()
    .from(schema.clientBalance)
    .where(eq(schema.clientBalance.clientId, id));
  const contacts = await ctx.db
    .select()
    .from(schema.clientContact)
    .where(eq(schema.clientContact.clientId, id))
    .orderBy(desc(schema.clientContact.isPrimary), asc(schema.clientContact.createdAt));
  const sites = await ctx.db
    .select()
    .from(schema.site)
    .where(and(eq(schema.site.clientId, id), isNull(schema.site.archivedAt)))
    .orderBy(asc(schema.site.createdAt));
  const projects = await ctx.db
    .select({ id: schema.project.id, name: schema.project.name, status: schema.project.status })
    .from(schema.project)
    .where(eq(schema.project.clientId, id))
    .orderBy(desc(schema.project.createdAt));
  const quotes = await ctx.db
    .select({
      id: schema.quote.id,
      number: schema.quote.number,
      title: schema.quote.title,
      status: schema.quote.status,
      updatedAt: schema.quote.updatedAt,
    })
    .from(schema.quote)
    .where(eq(schema.quote.clientId, id))
    .orderBy(desc(schema.quote.updatedAt));
  const invoices = await ctx.db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      status: schema.invoice.status,
      kind: schema.invoice.kind,
      updatedAt: schema.invoice.updatedAt,
    })
    .from(schema.invoice)
    .where(eq(schema.invoice.clientId, id))
    .orderBy(desc(schema.invoice.updatedAt));
  const entityIds = [
    id,
    ...quotes.map((q) => q.id),
    ...invoices.map((i) => i.id),
    ...projects.map((p) => p.id),
  ];
  const timeline = await ctx.db
    .select()
    .from(schema.activity)
    .where(
      and(eq(schema.activity.businessId, ctx.user.businessId), inArray(schema.activity.entityId, entityIds)),
    )
    .orderBy(desc(schema.activity.at))
    .limit(50);
  const billed = balance?.billedCents ?? 0;
  const paid = balance?.paidCents ?? 0;
  const credits = balance?.creditsAppliedCents ?? 0;
  return {
    client,
    contacts,
    sites,
    projects,
    quotes,
    invoices,
    timeline,
    balance: {
      billedCents: billed,
      paidCents: paid,
      outstandingCents: billed - paid - credits,
      creditAvailableCents: balance?.creditAvailableCents ?? 0,
    },
  };
}

export type ClientDetail = NonNullable<Awaited<ReturnType<typeof getClient>>>;

export async function createClient(ctx: RequestContext, input: z.output<typeof clientSchema>) {
  const id = newId("cli");
  const { line1, line2, city, province, postalCode, ...rest } = input;
  await ctx.db.batch([
    ctx.db.insert(schema.client).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      ...rest,
      billingAddress: toAddress({ line1, line2, city, province, postalCode }),
    }),
    audit(ctx, id, "client.created", { name: input.displayName }),
  ]);
  return id;
}

/** FR-CLI-01: name, email and phone, from any builder. */
export async function quickCreateClient(ctx: RequestContext, input: z.output<typeof quickClientSchema>) {
  const id = newId("cli");
  await ctx.db.batch([
    ctx.db
      .insert(schema.client)
      .values({ id, businessId: ctx.user.businessId, createdBy: ctx.user.id, ...input }),
    audit(ctx, id, "client.created", { name: input.displayName, inline: true }),
  ]);
  return id;
}

async function requireClient(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.client)
    .where(and(eq(schema.client.id, id), eq(schema.client.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("That client no longer exists");
  return row;
}

export async function updateClient(ctx: RequestContext, id: string, input: z.output<typeof clientSchema>) {
  await requireClient(ctx, id);
  const { line1, line2, city, province, postalCode, ...rest } = input;
  await ctx.db.batch([
    ctx.db
      .update(schema.client)
      .set({
        ...rest,
        billingAddress: toAddress({ line1, line2, city, province, postalCode }),
        updatedAt: nowIso(),
      })
      .where(eq(schema.client.id, id)),
    audit(ctx, id, "client.updated"),
  ]);
}

/** FR-CLI-05: archive, never delete. Archived clients leave pickers but stay in reports. */
export async function setClientArchived(ctx: RequestContext, id: string, archived: boolean) {
  await requireClient(ctx, id);
  await ctx.db.batch([
    ctx.db
      .update(schema.client)
      .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
      .where(eq(schema.client.id, id)),
    audit(ctx, id, archived ? "client.archived" : "client.restored"),
  ]);
}

export async function saveContact(
  ctx: RequestContext,
  clientId: string,
  input: z.output<typeof contactSchema>,
) {
  await requireClient(ctx, clientId);
  const id = input.id ?? newId("con");
  const values = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    role: input.role,
    isPrimary: input.isPrimary,
  };
  const statements = [];
  // Only one primary contact per client.
  if (input.isPrimary) {
    statements.push(
      ctx.db
        .update(schema.clientContact)
        .set({ isPrimary: false })
        .where(eq(schema.clientContact.clientId, clientId)),
    );
  }
  if (input.id) {
    statements.push(
      ctx.db
        .update(schema.clientContact)
        .set({ ...values, updatedAt: nowIso() })
        .where(and(eq(schema.clientContact.id, input.id), eq(schema.clientContact.clientId, clientId))),
    );
  } else {
    statements.push(
      ctx.db
        .insert(schema.clientContact)
        .values({ id, clientId, businessId: ctx.user.businessId, createdBy: ctx.user.id, ...values }),
    );
  }
  statements.push(
    audit(ctx, clientId, input.id ? "client.contact_updated" : "client.contact_added", {
      contact: input.name,
    }),
  );
  await ctx.db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return id;
}

export async function removeContact(ctx: RequestContext, clientId: string, contactId: string) {
  await requireClient(ctx, clientId);
  await ctx.db.batch([
    ctx.db
      .delete(schema.clientContact)
      .where(and(eq(schema.clientContact.id, contactId), eq(schema.clientContact.clientId, clientId))),
    audit(ctx, clientId, "client.contact_removed"),
  ]);
}

export async function saveSite(ctx: RequestContext, clientId: string, input: z.output<typeof siteSchema>) {
  await requireClient(ctx, clientId);
  const { id: siteId, label, ...address } = input;
  const id = siteId ?? newId("sit");
  await ctx.db.batch([
    siteId
      ? ctx.db
          .update(schema.site)
          .set({ label, address: toAddress(address), updatedAt: nowIso() })
          .where(and(eq(schema.site.id, siteId), eq(schema.site.clientId, clientId)))
      : ctx.db.insert(schema.site).values({
          id,
          clientId,
          businessId: ctx.user.businessId,
          createdBy: ctx.user.id,
          label,
          address: toAddress(address),
        }),
    audit(ctx, clientId, siteId ? "client.site_updated" : "client.site_added", { site: label }),
  ]);
  return id;
}

/** Sites are archived so quotes that used them keep their address. */
export async function archiveSite(ctx: RequestContext, clientId: string, siteId: string) {
  await requireClient(ctx, clientId);
  await ctx.db.batch([
    ctx.db
      .update(schema.site)
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where(and(eq(schema.site.id, siteId), eq(schema.site.clientId, clientId))),
    audit(ctx, clientId, "client.site_removed"),
  ]);
}

/** Options for the client Combobox (active clients only, FR-CLI-05). */
export async function clientOptions(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      id: schema.client.id,
      displayName: schema.client.displayName,
      company: schema.client.company,
      email: schema.client.email,
    })
    .from(schema.client)
    .where(and(eq(schema.client.businessId, ctx.user.businessId), isNull(schema.client.archivedAt)))
    .orderBy(asc(sql`lower(${schema.client.displayName})`));
  return rows;
}

export async function clientSites(ctx: Ctx, clientId: string) {
  return ctx.db
    .select({ id: schema.site.id, label: schema.site.label, address: schema.site.address })
    .from(schema.site)
    .where(
      and(
        eq(schema.site.clientId, clientId),
        eq(schema.site.businessId, ctx.user.businessId),
        isNull(schema.site.archivedAt),
      ),
    )
    .orderBy(asc(schema.site.createdAt));
}
