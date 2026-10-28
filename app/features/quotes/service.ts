// Quotes (SPEC 5.6): drafts, autosave with version checks, listing,
// duplication. Sending, revisions and approval arrive in phase 5. Drafts have
// no number (FR-QT-07); only drafts can be hard-deleted (SPEC 8.1).

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { computeContent, depositFrom } from "~/domain/document";
import { CURRENCY } from "~/domain/locale";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { likeTerm } from "~/lib/like";
import { activityInsert } from "~/server/audit";
import { type DocumentContent, schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import type { SaveDraftInput } from "./schema";

type Ctx = Pick<RequestContext, "db" | "user">;

const nowIso = () => new Date().toISOString();
const newLineId = () => crypto.randomUUID();

function audit(ctx: RequestContext, entityId: string, action: string, data?: Record<string, unknown>) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType: "quote",
    entityId,
    action,
    data,
  });
}

/** Active tax rates plus any archived ones a draft still references, as frozen copies. */
async function taxRatesFor(ctx: Ctx, referenced: string[]) {
  const rows = await ctx.db
    .select()
    .from(schema.taxRate)
    .where(
      and(
        eq(schema.taxRate.businessId, ctx.user.businessId),
        referenced.length > 0
          ? or(isNull(schema.taxRate.archivedAt), inArray(schema.taxRate.id, referenced))
          : isNull(schema.taxRate.archivedAt),
      ),
    )
    .orderBy(schema.taxRate.position);
  return rows.map((r) => ({ id: r.id, name: r.name, rateBp: r.rateBp }));
}

export async function createQuote(
  ctx: RequestContext,
  opts: { clientId?: string | null; projectId?: string | null } = {},
) {
  const [settings] = await ctx.db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.businessId, ctx.user.businessId));
  if (!settings) throw new ServiceError("The business hasn't been set up yet");
  if (opts.clientId) {
    const [client] = await ctx.db
      .select({ id: schema.client.id })
      .from(schema.client)
      .where(and(eq(schema.client.id, opts.clientId), eq(schema.client.businessId, ctx.user.businessId)));
    if (!client) throw new ServiceError("That client no longer exists");
  }
  const content: DocumentContent = {
    sections: [{ id: newLineId(), title: "Room 1", lines: [] }],
    taxRates: await taxRatesFor(ctx, []),
    notes: settings.defaultNotes ?? undefined,
    terms: settings.defaultTerms ?? undefined,
  };
  const id = newId("qte");
  await ctx.db.batch([
    ctx.db.insert(schema.quote).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      clientId: opts.clientId ?? null,
      projectId: opts.projectId ?? null,
      currency: CURRENCY,
      status: "draft",
      draftContent: content,
      draftTotalCents: 0,
      draftVersion: 1,
      depositType: settings.defaultDepositBp > 0 ? "percent" : null,
      depositValue: settings.defaultDepositBp > 0 ? settings.defaultDepositBp : null,
      validUntil: addDays(businessToday(), settings.quoteValidDays),
    }),
    audit(ctx, id, "quote.created"),
  ]);
  return id;
}

export async function getQuote(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) return null;
  const [client] = row.clientId
    ? await ctx.db.select().from(schema.client).where(eq(schema.client.id, row.clientId))
    : [];
  const [site] = row.siteId
    ? await ctx.db.select().from(schema.site).where(eq(schema.site.id, row.siteId))
    : [];
  let content = row.draftContent;
  let revisionNo: number | null = null;
  if (row.status !== "draft" && row.currentRevisionId) {
    const [revision] = await ctx.db
      .select()
      .from(schema.quoteRevision)
      .where(eq(schema.quoteRevision.id, row.currentRevisionId));
    content = revision?.content ?? content;
    revisionNo = revision?.revisionNo ?? null;
  }
  if (!content) throw new ServiceError("This quote has no content");
  const referenced = content.sections.flatMap((s) => s.lines.flatMap((l) => l.taxRateIds));
  const taxRates = row.status === "draft" ? await taxRatesFor(ctx, referenced) : content.taxRates;
  const fullContent = { ...content, taxRates };
  return {
    quote: row,
    client: client ?? null,
    site: site ?? null,
    content: fullContent,
    revisionNo,
    totals: computeContent(fullContent, depositFrom(row.depositType, row.depositValue)),
  };
}

export type QuoteDetail = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

export class DraftConflictError extends Error {
  constructor(readonly serverVersion: number) {
    super("A newer version of this quote was saved somewhere else");
    this.name = "DraftConflictError";
  }
}

/**
 * Autosave (FR-QT-06). Writes only if the stored version is the one the editor
 * last saw, so two tabs can't silently overwrite each other; the server
 * recomputes totals from the saved content (CLAUDE.md: never trust client totals).
 */
export async function saveDraft(ctx: RequestContext, id: string, input: SaveDraftInput) {
  const [row] = await ctx.db
    .select({ status: schema.quote.status, draftVersion: schema.quote.draftVersion })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("This quote no longer exists");
  if (row.status !== "draft") throw new ServiceError("Sent quotes can't be edited; send a revision instead");
  if (row.draftVersion !== input.version) throw new DraftConflictError(row.draftVersion);

  const { header } = input;
  if (header.clientId) {
    const [client] = await ctx.db
      .select({ id: schema.client.id })
      .from(schema.client)
      .where(and(eq(schema.client.id, header.clientId), eq(schema.client.businessId, ctx.user.businessId)));
    if (!client) throw new ServiceError("That client no longer exists", "clientId");
  }
  if (header.siteId) {
    const [site] = await ctx.db
      .select({ clientId: schema.site.clientId })
      .from(schema.site)
      .where(and(eq(schema.site.id, header.siteId), eq(schema.site.businessId, ctx.user.businessId)));
    if (!site || site.clientId !== header.clientId)
      throw new ServiceError("That site belongs to another client", "siteId");
  }

  const referenced = input.content.sections.flatMap((s) => s.lines.flatMap((l) => l.taxRateIds));
  const taxRates = await taxRatesFor(ctx, referenced);
  const known = new Set(taxRates.map((r) => r.id));
  const content: DocumentContent = {
    ...input.content,
    sections: input.content.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l, taxRateIds: l.taxRateIds.filter((t) => known.has(t)) })),
    })),
    taxRates,
  };
  const deposit =
    header.depositType && header.depositValue !== null
      ? { type: header.depositType, value: header.depositValue }
      : null;

  const totals = computeContent(content, depositFrom(deposit?.type, deposit?.value));
  const nextVersion = input.version + 1;
  const updated = await ctx.db
    .update(schema.quote)
    .set({
      title: header.title,
      clientId: header.clientId,
      siteId: header.siteId,
      validUntil: header.validUntil,
      depositType: deposit?.type ?? null,
      depositValue: deposit?.value ?? null,
      draftContent: content,
      draftTotalCents: totals.computed.totalCents,
      draftVersion: nextVersion,
      updatedAt: nowIso(),
    })
    // The version guard makes the check-and-write atomic.
    .where(
      and(
        eq(schema.quote.id, id),
        eq(schema.quote.draftVersion, input.version),
        eq(schema.quote.status, "draft"),
      ),
    )
    .returning({ id: schema.quote.id });
  if (updated.length === 0) {
    const [latest] = await ctx.db
      .select({ v: schema.quote.draftVersion })
      .from(schema.quote)
      .where(eq(schema.quote.id, id));
    throw new DraftConflictError(latest?.v ?? input.version);
  }
  return {
    version: nextVersion,
    savedAt: nowIso(),
    taxRates,
    totals: {
      subtotalCents: totals.computed.subtotalCents,
      discountCents: totals.computed.discountCents,
      taxes: totals.computed.taxes,
      totalCents: totals.computed.totalCents,
      baseTotalCents: totals.baseTotalCents,
      depositCents: totals.depositCents,
      balanceCents: totals.balanceCents,
    },
  };
}

export const QUOTE_FILTERS = ["all", "draft", "sent", "changes_requested", "approved", "closed"] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];

const FILTER_STATUSES: Record<
  Exclude<QuoteFilter, "all">,
  (typeof schema.quote.status.enumValues)[number][]
> = {
  draft: ["draft"],
  sent: ["sent", "viewed"],
  changes_requested: ["changes_requested"],
  approved: ["approved"],
  closed: ["declined", "expired"],
};

/** Rows per page on list screens; "Show more" asks for the next page. */
export const QUOTE_PAGE_SIZE = 50;

/**
 * Quote list, filtered, searched and paged in SQL. Workers Free allows 10 ms of
 * CPU per request, so totals come from columns (the frozen revision, or the
 * draft total stored on save) rather than re-totalling every draft.
 */
export async function listQuotes(
  ctx: Ctx,
  opts: { filter?: QuoteFilter; query?: string; limit?: number } = {},
) {
  const q = schema.quote;
  const mine = eq(q.businessId, ctx.user.businessId);

  const byStatus = await ctx.db
    .select({ status: q.status, n: sql<number>`count(*)` })
    .from(q)
    .where(mine)
    .groupBy(q.status);
  const counts: Record<QuoteFilter, number> = {
    all: 0,
    draft: 0,
    sent: 0,
    changes_requested: 0,
    approved: 0,
    closed: 0,
  };
  for (const { status, n } of byStatus) {
    counts.all += n;
    for (const [filter, statuses] of Object.entries(FILTER_STATUSES)) {
      if (statuses.includes(status)) counts[filter as QuoteFilter] += n;
    }
  }

  const filter = opts.filter ?? "all";
  const query = opts.query?.trim().toLowerCase();
  const pattern = query ? likeTerm(query) : null;
  const limit = Math.min(Math.max(opts.limit ?? QUOTE_PAGE_SIZE, 1), 500);
  const rows = await ctx.db
    .select({
      id: q.id,
      number: q.number,
      title: q.title,
      status: q.status,
      validUntil: q.validUntil,
      updatedAt: q.updatedAt,
      clientId: q.clientId,
      clientName: schema.client.displayName,
      revisionTotalCents: schema.quoteRevision.totalCents,
      draftTotalCents: q.draftTotalCents,
      // Only drafts saved before draft totals were stored need their content.
      legacyContent: sql<
        string | null
      >`case when ${q.draftTotalCents} is null and ${q.currentRevisionId} is null then ${q.draftContent} end`,
    })
    .from(q)
    .leftJoin(schema.client, eq(schema.client.id, q.clientId))
    .leftJoin(schema.quoteRevision, eq(schema.quoteRevision.id, q.currentRevisionId))
    .where(
      and(
        mine,
        filter === "all" ? undefined : inArray(q.status, FILTER_STATUSES[filter]),
        pattern
          ? or(
              sql`lower(coalesce(${q.number}, '')) LIKE ${pattern} ESCAPE '\\'`,
              sql`lower(coalesce(${q.title}, '')) LIKE ${pattern} ESCAPE '\\'`,
              sql`lower(coalesce(${schema.client.displayName}, '')) LIKE ${pattern} ESCAPE '\\'`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(q.updatedAt))
    .limit(limit + 1);

  return {
    counts,
    hasMore: rows.length > limit,
    quotes: rows.slice(0, limit).map(({ revisionTotalCents, draftTotalCents, legacyContent, ...row }) => ({
      ...row,
      totalCents:
        revisionTotalCents ??
        draftTotalCents ??
        (legacyContent
          ? computeContent(JSON.parse(legacyContent) as DocumentContent).computed.totalCents
          : 0),
    })),
  };
}

/** Quotes waiting on the client: how many and their total (Quotes header band). */
export async function awaitingSummary(ctx: Ctx) {
  const q = schema.quote;
  const [row] = await ctx.db
    .select({
      count: sql<number>`count(*)`,
      totalCents: sql<number>`coalesce(sum(${schema.quoteRevision.totalCents}), 0)`,
    })
    .from(q)
    .leftJoin(schema.quoteRevision, eq(schema.quoteRevision.id, q.currentRevisionId))
    .where(and(eq(q.businessId, ctx.user.businessId), inArray(q.status, FILTER_STATUSES.sent)));
  return { count: row?.count ?? 0, totalCents: row?.totalCents ?? 0 };
}

export type QuoteListRow = Awaited<ReturnType<typeof listQuotes>>["quotes"][number];

/** FR-QT-13: a new draft with the same content (fresh line ids, no number). */
export async function duplicateQuote(ctx: RequestContext, id: string) {
  const detail = await getQuote(ctx, id);
  if (!detail) throw new ServiceError("That quote no longer exists");
  const { quote, content } = detail;
  const copy: DocumentContent = {
    ...content,
    sections: content.sections.map((s) => ({
      ...s,
      id: newLineId(),
      lines: s.lines.map((l) => ({ ...l, id: newLineId() })),
    })),
  };
  const newIdValue = newId("qte");
  await ctx.db.batch([
    ctx.db.insert(schema.quote).values({
      id: newIdValue,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      clientId: quote.clientId,
      siteId: quote.siteId,
      projectId: quote.projectId,
      currency: CURRENCY,
      title: quote.title ? `${quote.title} (copy)` : null,
      status: "draft",
      draftContent: copy,
      draftTotalCents: computeContent(copy).computed.totalCents,
      draftVersion: 1,
      depositType: quote.depositType,
      depositValue: quote.depositValue,
      validUntil: quote.validUntil,
    }),
    audit(ctx, newIdValue, "quote.duplicated", { from: quote.number ?? quote.id }),
  ]);
  return newIdValue;
}

/** Only drafts may be deleted (SPEC 8.1). */
export async function deleteDraft(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select({ status: schema.quote.status })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) return;
  if (row.status !== "draft") throw new ServiceError("Sent quotes are kept for your records");
  await ctx.db.batch([
    ctx.db.delete(schema.quote).where(and(eq(schema.quote.id, id), eq(schema.quote.status, "draft"))),
    audit(ctx, id, "quote.draft_deleted"),
  ]);
}

/** Catalogue for the builder's item sheet: active items and room templates. */
export async function builderCatalogue(ctx: Ctx) {
  const items = await ctx.db
    .select()
    .from(schema.item)
    .where(and(eq(schema.item.businessId, ctx.user.businessId), isNull(schema.item.archivedAt)))
    .orderBy(sql`lower(${schema.item.name})`);
  return items;
}
