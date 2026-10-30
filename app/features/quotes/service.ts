// Quotes (SPEC 5.6): drafts, autosave with version checks, listing,
// duplication, sending, revisions and links. Client approval lives in
// features/portal. Drafts have no number until sent (FR-QT-07); only unsent
// drafts can be hard-deleted (SPEC 8.1).

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { canonicalJson, type Json } from "~/domain/canonical";
import { describeDiff, diffContent } from "~/domain/diff";
import { computeContent, depositFrom, type DocumentTotals } from "~/domain/document";
import {
  canQuote,
  type QuoteEvent,
  type QuoteStatus,
  quoteTransition,
  TransitionError,
} from "~/domain/lifecycle";
import { CURRENCY } from "~/domain/locale";
import { formatCents } from "~/domain/money";
import { isPastValidUntil, validitySentence } from "~/domain/portal";
import {
  acceptOpenIn,
  openRequestCount,
  pendingAccepted,
  reopenAccepted,
  resolveAcceptedIn,
} from "~/features/conversations/requests";
import { emailInsert, enqueue, NUMBER_PLACEHOLDER, type OutgoingEmail } from "~/features/email/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday, formatDate } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { likeTerm } from "~/lib/like";
import { EMAIL_TEMPLATE_DEFAULTS } from "~/lib/merge-fields";
import { activityInsert } from "~/server/audit";
import { type DocumentContent, schema } from "~/server/db";
import { quoteSentEmail, type RevisionChanges } from "~/server/email/templates";
import type { RequestContext } from "~/server/session";
import { hashShareToken, newShareSalt, portalPath, sha256Hex, shareToken } from "~/server/tokens";
import type { SaveDraftInput, SendQuoteInput } from "./schema";

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
export async function taxRatesFor(ctx: Ctx, referenced: string[]) {
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
  // The sent revision. While a sent quote is being revised (status draft with a
  // revision) the editor shows the draft and the client still sees this.
  const [revision] = row.currentRevisionId
    ? await ctx.db
        .select()
        .from(schema.quoteRevision)
        .where(eq(schema.quoteRevision.id, row.currentRevisionId))
    : [];
  if (row.status !== "draft" && revision) content = revision.content;
  if (!content) throw new ServiceError("This quote has no content");
  const referenced = content.sections.flatMap((s) => s.lines.flatMap((l) => l.taxRateIds));
  const taxRates = row.status === "draft" ? await taxRatesFor(ctx, referenced) : content.taxRates;
  const fullContent = { ...content, taxRates };
  return {
    quote: row,
    client: client ?? null,
    site: site ?? null,
    content: fullContent,
    revisionNo: row.status === "draft" ? null : (revision?.revisionNo ?? null),
    /** Set while a sent quote is being revised: the revision the client still sees. */
    revising: row.status === "draft" && revision ? { revisionNo: revision.revisionNo } : null,
    revision: revision
      ? {
          id: revision.id,
          revisionNo: revision.revisionNo,
          sentAt: revision.sentAt,
          totalCents: revision.totalCents,
        }
      : null,
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
      // Quotes have no server-generated lines: a `locked` flag is ignored.
      lines: s.lines.map(({ locked: _locked, ...l }) => ({
        ...l,
        taxRateIds: l.taxRateIds.filter((t) => known.has(t)),
      })),
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

export { QUOTE_FILTERS, QUOTE_PAGE_SIZE, type QuoteFilter } from "./filters";
import { QUOTE_PAGE_SIZE, type QuoteFilter } from "./filters";

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
  const { quote } = detail;
  const { header: _header, ...content } = detail.content;
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
    .select({ status: schema.quote.status, number: schema.quote.number })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) return;
  if (row.status !== "draft" || row.number) throw new ServiceError("Sent quotes are kept for your records");
  await ctx.db.batch([
    ctx.db
      .delete(schema.quote)
      .where(and(eq(schema.quote.id, id), eq(schema.quote.status, "draft"), isNull(schema.quote.number))),
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

// ---------- Send, revise, extend (phase 5: FR-QT-07…11) ----------

/** The guard after a conditional UPDATE: fails the whole batch (NOT NULL) if it changed no row. */
function requireChanged(ctx: Ctx, id: string) {
  return ctx.db
    .update(schema.quote)
    .set({ draftVersion: sql`case when changes() = 1 then ${schema.quote.draftVersion} else null end` })
    .where(eq(schema.quote.id, id));
}

function quoteTransitionOrFail(from: QuoteStatus, event: QuoteEvent) {
  try {
    return quoteTransition(from, event);
  } catch (error) {
    if (error instanceof TransitionError) throw new ServiceError(error.message);
    throw error;
  }
}

/** The client's portal link, rebuilt from the stored salt (server/tokens.ts). */
export async function quoteShareUrl(
  env: Pick<Env, "APP_URL" | "BETTER_AUTH_SECRET">,
  id: string,
  salt: string,
) {
  const token = await shareToken(env.BETTER_AUTH_SECRET, "quote", id, salt);
  return new URL(portalPath("quote", token), env.APP_URL).toString();
}

/** The quote-sent email for a revision (owner wording from Settings → Email, FR-SET-07). */
async function quoteSentMessage(
  ctx: RequestContext,
  opts: {
    revisionId: string;
    revisionNo: number;
    number: string;
    clientName: string;
    totals: DocumentTotals;
    validUntil: string | null;
    url: string;
    to: string;
    cc: string[];
    bcc: string[];
    note?: string;
    changes?: RevisionChanges;
  },
): Promise<OutgoingEmail> {
  const [brand, [settings]] = await Promise.all([
    loadEmailBrand(ctx.db, ctx.env, ctx.user.businessId),
    ctx.db
      .select({ emailTemplates: schema.settings.emailTemplates })
      .from(schema.settings)
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
  ]);
  const defaults = EMAIL_TEMPLATE_DEFAULTS.quote_sent!;
  const rendered = quoteSentEmail(brand, {
    clientName: opts.clientName,
    url: opts.url,
    revision: opts.revisionNo,
    note: opts.note,
    changes: opts.changes,
    override: settings?.emailTemplates.quote_sent,
    defaults: { subject: defaults.subject, body: defaults.body },
    facts: {
      number: opts.number,
      total: formatCents(opts.totals.computed.totalCents),
      deposit: opts.totals.depositCents > 0 ? formatCents(opts.totals.depositCents) : undefined,
      validUntil: opts.validUntil ? formatDate(opts.validUntil) : undefined,
      // Owner request: the client sees how long the quote stands, in red.
      validity: opts.validUntil
        ? (validitySentence(businessToday(), opts.validUntil, formatDate) ?? undefined)
        : undefined,
    },
  });
  return {
    ...rendered,
    to: [opts.to],
    cc: opts.cc,
    bcc: opts.bcc,
    replyTo: brand.replyTo,
    idempotencyKey: `quote:${opts.revisionId}:quote_sent`,
  };
}

/**
 * Send a draft, or the next revision of a sent quote (FR-QT-07, 08, 09). One D1
 * batch freezes the revision, allocates the number (first send only), rotates
 * the share token and writes the email row; the guard makes it all-or-nothing
 * if an autosave or a second send got there first. The email goes out from the
 * queue with the PDF attached.
 */
export async function sendQuote(ctx: RequestContext, id: string, input: SendQuoteInput) {
  const [row] = await ctx.db
    .select()
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("This quote no longer exists");
  if (row.status !== "draft") throw new ServiceError("This quote has already been sent");
  if (row.draftVersion !== input.version) throw new DraftConflictError(row.draftVersion);
  if (!row.clientId) throw new ServiceError("Choose a client before sending", "to");
  const [client] = await ctx.db
    .select()
    .from(schema.client)
    .where(and(eq(schema.client.id, row.clientId), eq(schema.client.businessId, ctx.user.businessId)));
  if (!client) throw new ServiceError("That client no longer exists", "to");
  const draft = row.draftContent;
  if (!draft || draft.sections.every((s) => s.lines.length === 0))
    throw new ServiceError("Add at least one line before sending");
  // A quote is valid N days (7) from the day it's sent (owner request). On a
  // first send, a date still at what createQuote set counts from today; a date
  // the owner picked is kept.
  let validUntil = row.validUntil;
  if (!row.number && validUntil) {
    const [settings] = await ctx.db
      .select({ days: schema.settings.quoteValidDays })
      .from(schema.settings)
      .where(eq(schema.settings.businessId, ctx.user.businessId));
    const days = settings?.days ?? 7;
    if (validUntil === addDays(businessToday(new Date(row.createdAt)), days))
      validUntil = addDays(businessToday(), days);
  }
  if (!validUntil) throw new ServiceError("Set a valid-until date before sending");
  if (isPastValidUntil(validUntil, businessToday()))
    throw new ServiceError("The valid-until date has passed; choose a later date");

  const referenced = draft.sections.flatMap((s) => s.lines.flatMap((l) => l.taxRateIds));
  const content: DocumentContent = {
    ...draft,
    taxRates: await taxRatesFor(ctx, referenced),
    header: { title: row.title, clientId: row.clientId, siteId: row.siteId, validUntil: validUntil },
  };
  const totals = computeContent(content, depositFrom(row.depositType, row.depositValue));

  let revisionNo = 1;
  let changes: RevisionChanges | undefined;
  if (row.currentRevisionId) {
    const [previous] = await ctx.db
      .select()
      .from(schema.quoteRevision)
      .where(eq(schema.quoteRevision.id, row.currentRevisionId));
    revisionNo = (previous?.revisionNo ?? 0) + 1;
    if (previous) {
      // FR-MSG-06: the revised email says what changed and the total before and after.
      const diff = diffContent(previous.content, content, {
        before: depositFrom(previous.depositType, previous.depositValue),
        after: depositFrom(row.depositType, row.depositValue),
      });
      changes = {
        lines: describeDiff(diff, 6),
        totalBefore: formatCents(diff.totalBeforeCents),
        totalAfter: formatCents(diff.totalAfterCents),
      };
    }
  }
  // Requests still open when a revision goes out keep the quote in changes
  // requested (FR-MSG-07), unless the owner says this revision deals with them.
  const open = await openRequestCount(ctx.db, "quote", id);
  const closeOpen = open > 0 && !!input.resolveOpen;
  const status =
    open > 0 && !closeOpen
      ? quoteTransitionOrFail("sent", "request_changes")
      : quoteTransitionOrFail("draft", "send");
  const revisionId = newId("qrv");
  const contentHash = await sha256Hex(
    canonicalJson({
      content,
      depositType: row.depositType,
      depositValue: row.depositValue,
      currency: CURRENCY,
    } as unknown as Json),
  );
  // A new link for every revision: the old one stops working (FR-QT-09, SPEC 8.4).
  const salt = newShareSalt();
  const token = await shareToken(ctx.env.BETTER_AUTH_SECRET, "quote", id, salt);
  const url = new URL(portalPath("quote", token), ctx.env.APP_URL).toString();
  const message = await quoteSentMessage(ctx, {
    revisionId,
    revisionNo,
    number: row.number ?? NUMBER_PLACEHOLDER,
    clientName: client.displayName,
    totals,
    validUntil: validUntil,
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
    entityType: "quote",
    entityId: id,
    template: revisionNo > 1 ? "quote_revised" : "quote_sent",
    message,
    numberFrom: row.number ? undefined : { entity: "quote", id },
  });
  const now = nowIso();
  const seq = schema.sequence;
  const mySequence = and(eq(seq.businessId, ctx.user.businessId), eq(seq.kind, "quote"));
  const nextNumber = sql`(select ${seq.prefix} || ${seq.nextValue} from ${seq} where ${mySequence})`;

  try {
    await ctx.db.batch([
      ctx.db
        .update(schema.quote)
        .set({
          status,
          number: row.number ?? nextNumber,
          currentRevisionId: revisionId,
          shareTokenHash: await hashShareToken(token),
          shareTokenSalt: salt,
          validUntil,
          draftContent: null,
          draftVersion: sql`${schema.quote.draftVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.quote.id, id),
            eq(schema.quote.status, "draft"),
            eq(schema.quote.draftVersion, input.version),
          ),
        ),
      requireChanged(ctx, id),
      // First send: the number just used was next_value; move it on.
      ...(row.number
        ? []
        : [
            ctx.db
              .update(seq)
              .set({ nextValue: sql`${seq.nextValue} + 1`, updatedAt: now })
              .where(mySequence),
          ]),
      ctx.db.insert(schema.quoteRevision).values({
        id: revisionId,
        quoteId: id,
        revisionNo,
        content,
        subtotalCents: totals.computed.subtotalCents,
        discountCents: totals.computed.discountCents,
        taxCents: totals.computed.taxes.reduce((sum, t) => sum + t.taxCents, 0),
        totalCents: totals.computed.totalCents,
        depositType: row.depositType,
        depositValue: row.depositValue,
        contentHash,
        sentAt: now,
        createdBy: ctx.user.id,
      }),
      resolveAcceptedIn(ctx.db, "quote", id, revisionId),
      ...(closeOpen ? [acceptOpenIn(ctx.db, "quote", id, revisionId, revisionNo)] : []),
      email.insert,
      audit(ctx, id, revisionNo > 1 ? "quote.revision_sent" : "quote.sent", {
        revision: revisionNo,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        note: input.note || undefined,
        totalCents: totals.computed.totalCents,
        requestsClosed: closeOpen ? open : undefined,
      }),
    ]);
  } catch (error) {
    const [latest] = await ctx.db
      .select({ status: schema.quote.status, version: schema.quote.draftVersion })
      .from(schema.quote)
      .where(eq(schema.quote.id, id));
    if (latest && latest.status !== "draft") throw new ServiceError("This quote has already been sent");
    if (latest && latest.version !== input.version) throw new DraftConflictError(latest.version);
    throw error;
  }

  const queued = await enqueue(ctx.env, [
    {
      kind: "email",
      emailId: email.id,
      businessId: ctx.user.businessId,
      message,
      pdf: { entity: "quote", id, revisionId },
      numberFrom: row.number ? undefined : { entity: "quote", id },
    },
  ]);
  const [sent] = await ctx.db
    .select({ number: schema.quote.number })
    .from(schema.quote)
    .where(eq(schema.quote.id, id));
  return { number: sent!.number!, revisionNo, queued };
}

/**
 * Re-queue the latest quote email if it is stuck (queue refused it) or failed
 * (Resend kept refusing it). Same idempotency key, so it can't double-send.
 */
export async function retryQuoteEmail(ctx: RequestContext, id: string) {
  const detail = await getQuote(ctx, id);
  if (!detail?.revision || !detail.quote.number || !detail.quote.shareTokenSalt || !detail.client)
    throw new ServiceError("This quote hasn't been sent yet");
  const [row] = await ctx.db
    .select()
    .from(schema.emailMessage)
    .where(
      and(
        eq(schema.emailMessage.entityType, "quote"),
        eq(schema.emailMessage.entityId, id),
        eq(schema.emailMessage.idempotencyKey, `quote:${detail.revision.id}:quote_sent`),
      ),
    );
  if (!row || (row.status !== "queued" && row.status !== "failed"))
    throw new ServiceError("That email has already gone out");
  const [sentEvent] = await ctx.db
    .select({ data: schema.activity.data })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.entityType, "quote"),
        eq(schema.activity.entityId, id),
        inArray(schema.activity.action, ["quote.sent", "quote.revision_sent"]),
      ),
    )
    .orderBy(desc(schema.activity.at))
    .limit(1);
  const sent = (sentEvent?.data ?? {}) as { cc?: string[]; bcc?: string[]; note?: string };
  const message = await quoteSentMessage(ctx, {
    revisionId: detail.revision.id,
    revisionNo: detail.revision.revisionNo,
    number: detail.quote.number,
    clientName: detail.client.displayName,
    totals: detail.totals,
    validUntil: detail.quote.validUntil,
    url: await quoteShareUrl(ctx.env, id, detail.quote.shareTokenSalt),
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
    audit(ctx, id, "quote.email_retried"),
  ]);
  const queued = await enqueue(ctx.env, [
    {
      kind: "email",
      emailId: row.id,
      businessId: ctx.user.businessId,
      message,
      pdf: { entity: "quote", id, revisionId: detail.revision.id },
    },
  ]);
  if (!queued) throw new ServiceError("Email is busy right now; try again in a minute");
}

/**
 * FR-QT-09: reopen a sent quote as a draft for the next revision. It keeps its
 * number; the client keeps seeing the sent revision (approval paused) until
 * the revision is sent or discarded.
 */
export async function reviseQuote(ctx: RequestContext, id: string) {
  const detail = await getQuote(ctx, id);
  if (!detail) throw new ServiceError("This quote no longer exists");
  quoteTransitionOrFail(detail.quote.status, "revise");
  await reviseQuoteWith(ctx, detail, (content) => content, []);
}

type QuoteContent = Omit<DocumentContent, "header">;

/**
 * The draft revision with `change` applied (FR-MSG-05: accepted change
 * requests), in one batch with `extra`. A sent quote is reopened as the next
 * revision; a quote already being revised has its draft updated, guarded by the
 * draft version so an open builder tab sees a conflict instead of overwriting.
 */
export async function reviseQuoteWith(
  ctx: RequestContext,
  detail: QuoteDetail,
  change: (content: QuoteContent) => QuoteContent,
  extra: BatchItem<"sqlite">[],
) {
  const { quote } = detail;
  const { header: _header, ...current } = detail.content;
  const content = change(current);
  const draftTotalCents = computeContent(content, depositFrom(quote.depositType, quote.depositValue)).computed
    .totalCents;
  const reopening = quote.status !== "draft";
  if (reopening) quoteTransitionOrFail(quote.status, "revise");
  await ctx.db.batch([
    ctx.db
      .update(schema.quote)
      .set({
        status: "draft",
        draftContent: content,
        draftTotalCents,
        draftVersion: sql`${schema.quote.draftVersion} + 1`,
        updatedAt: nowIso(),
      })
      .where(
        and(
          eq(schema.quote.id, quote.id),
          eq(schema.quote.status, quote.status),
          eq(schema.quote.draftVersion, quote.draftVersion),
        ),
      ),
    requireChanged(ctx, quote.id),
    ...(reopening
      ? [
          audit(ctx, quote.id, "quote.revision_started", {
            from: quote.status,
            revision: (detail.revisionNo ?? 0) + 1,
          }),
        ]
      : []),
    ...extra,
  ]);
}

/** Throw away an unsent revision: the quote goes back to the revision the client has. */
export async function discardRevision(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row?.currentRevisionId || row.status !== "draft")
    throw new ServiceError("There's no revision to discard");
  const [revision] = await ctx.db
    .select()
    .from(schema.quoteRevision)
    .where(eq(schema.quoteRevision.id, row.currentRevisionId));
  if (!revision) throw new ServiceError("There's no revision to discard");
  const [started] = await ctx.db
    .select({ data: schema.activity.data })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.entityType, "quote"),
        eq(schema.activity.entityId, id),
        eq(schema.activity.action, "quote.revision_started"),
      ),
    )
    .orderBy(desc(schema.activity.at))
    .limit(1);
  const before = (started?.data?.from as QuoteStatus | undefined) ?? "sent";
  // Requests accepted into this revision weren't sent: they are open again.
  const reopened = (await pendingAccepted(ctx.db, "quote", id)).length;
  const previous: QuoteStatus =
    reopened > 0 && canQuote(before, "request_changes") ? "changes_requested" : before;
  const header = revision.content.header;
  await ctx.db.batch([
    reopenAccepted(ctx.db, "quote", id),
    ctx.db
      .update(schema.quote)
      .set({
        status: previous,
        draftContent: null,
        draftVersion: sql`${schema.quote.draftVersion} + 1`,
        depositType: revision.depositType,
        depositValue: revision.depositValue,
        ...(header && {
          title: header.title,
          clientId: header.clientId,
          siteId: header.siteId,
          validUntil: header.validUntil,
        }),
        updatedAt: nowIso(),
      })
      .where(and(eq(schema.quote.id, id), eq(schema.quote.status, "draft"))),
    requireChanged(ctx, id),
    audit(ctx, id, "quote.revision_discarded", { back_to: previous, reopened: reopened || undefined }),
  ]);
}

/** FR-QT-11: one tap gives an expired (or about to expire) quote the default validity again. */
export async function extendQuote(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select({ status: schema.quote.status })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("This quote no longer exists");
  const [settings] = await ctx.db
    .select({ days: schema.settings.quoteValidDays })
    .from(schema.settings)
    .where(eq(schema.settings.businessId, ctx.user.businessId));
  const open: QuoteStatus[] = ["sent", "viewed", "changes_requested"];
  const status = open.includes(row.status) ? row.status : quoteTransitionOrFail(row.status, "extend");
  const validUntil = addDays(businessToday(), settings?.days ?? 7);
  await ctx.db.batch([
    ctx.db
      .update(schema.quote)
      .set({ status, validUntil, updatedAt: nowIso() })
      .where(and(eq(schema.quote.id, id), eq(schema.quote.status, row.status))),
    requireChanged(ctx, id),
    audit(ctx, id, "quote.extended", { validUntil }),
  ]);
  return validUntil;
}

/** SPEC 8.4: a new link; the old one stops working at once. */
export async function rotateQuoteLink(ctx: RequestContext, id: string) {
  const [row] = await ctx.db
    .select({ revision: schema.quote.currentRevisionId })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row?.revision) throw new ServiceError("This quote hasn't been sent yet");
  const salt = newShareSalt();
  const token = await shareToken(ctx.env.BETTER_AUTH_SECRET, "quote", id, salt);
  await ctx.db.batch([
    ctx.db
      .update(schema.quote)
      .set({ shareTokenSalt: salt, shareTokenHash: await hashShareToken(token), updatedAt: nowIso() })
      .where(eq(schema.quote.id, id)),
    audit(ctx, id, "quote.link_rotated"),
  ]);
}

/** Pause or resume automatic follow-ups for one quote (SPEC 5.9, `follow_up_paused`). */
export async function setFollowUpPaused(ctx: RequestContext, id: string, paused: boolean) {
  const [row] = await ctx.db
    .select({ paused: schema.quote.followUpPaused })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("This quote no longer exists");
  if (row.paused === paused) return;
  await ctx.db.batch([
    ctx.db
      .update(schema.quote)
      .set({ followUpPaused: paused, updatedAt: nowIso() })
      .where(eq(schema.quote.id, id)),
    audit(ctx, id, paused ? "quote.follow_ups_paused" : "quote.follow_ups_resumed"),
  ]);
}

/** For the Send sheet: the number a first send will most likely get, and the email wording. */
export async function sendSetup(ctx: Ctx) {
  const [[seq], [settings]] = await Promise.all([
    ctx.db
      .select({ prefix: schema.sequence.prefix, next: schema.sequence.nextValue })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.businessId, ctx.user.businessId), eq(schema.sequence.kind, "quote"))),
    ctx.db
      .select({
        emailTemplates: schema.settings.emailTemplates,
        defaultDepositBp: schema.settings.defaultDepositBp,
      })
      .from(schema.settings)
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
  ]);
  const defaults = EMAIL_TEMPLATE_DEFAULTS.quote_sent!;
  return {
    /** The business's deposit when the owner switches a quote to "% of total" (85%). */
    defaultDepositBp: settings?.defaultDepositBp ?? 8500,
    nextNumber: seq ? `${seq.prefix}${seq.next}` : null,
    wording: settings?.emailTemplates.quote_sent ?? { subject: defaults.subject, body: defaults.body },
  };
}

/** Timeline for the quote screen: activity, emails with delivery status, the approval. */
export async function quoteHistory(ctx: Ctx, id: string) {
  const [events, emails, acceptance] = await Promise.all([
    ctx.db
      .select()
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.businessId, ctx.user.businessId),
          eq(schema.activity.entityType, "quote"),
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
        subject: schema.emailMessage.subject,
        status: schema.emailMessage.status,
        error: schema.emailMessage.error,
        createdAt: schema.emailMessage.createdAt,
        updatedAt: schema.emailMessage.updatedAt,
      })
      .from(schema.emailMessage)
      .where(
        and(
          eq(schema.emailMessage.businessId, ctx.user.businessId),
          eq(schema.emailMessage.entityType, "quote"),
          eq(schema.emailMessage.entityId, id),
        ),
      )
      .orderBy(desc(schema.emailMessage.createdAt)),
    ctx.db
      .select({
        signerName: schema.quoteAcceptance.signerName,
        signerEmail: schema.quoteAcceptance.signerEmail,
        acceptedAt: schema.quoteAcceptance.acceptedAt,
        acceptedTotalCents: schema.quoteAcceptance.acceptedTotalCents,
        selectedOptionLineIds: schema.quoteAcceptance.selectedOptionLineIds,
        signatureSvg: schema.quoteAcceptance.signatureSvg,
        revisionNo: schema.quoteRevision.revisionNo,
      })
      .from(schema.quoteAcceptance)
      .innerJoin(schema.quoteRevision, eq(schema.quoteRevision.id, schema.quoteAcceptance.quoteRevisionId))
      .where(eq(schema.quoteRevision.quoteId, id))
      .orderBy(desc(schema.quoteAcceptance.acceptedAt))
      .limit(1),
  ]);
  // Failed, or still queued after two minutes: the screen offers a retry.
  const stuckBefore = new Date(Date.now() - 120_000).toISOString();
  return {
    events,
    emails: emails.map((e) => ({
      ...e,
      stuck: e.status === "failed" || (e.status === "queued" && e.createdAt < stuckBefore),
    })),
    acceptance: acceptance[0] ?? null,
  };
}
