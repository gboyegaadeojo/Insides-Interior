// Client conversations, owner side (SPEC 5.14). One thread per quote and per
// invoice; the payer writes from the portal (features/portal), the team from
// the app. Change requests are resolved here: accepting one or more makes one
// draft revision with the changes applied (domain/change-requests), and an
// invoice with payments is voided and reissued instead (FR-MSG-06). Every
// message and resolution is in the activity log (FR-MSG-10).

import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  applyChangeRequests,
  CHANGE_KIND_LABEL,
  type ChangeKind,
  resolutionsFor,
} from "~/domain/change-requests";
import { deriveInvoiceStatus } from "~/domain/invoice";
import {
  canInvoice,
  canQuote,
  type InvoiceStatus,
  invoiceTransition,
  type QuoteStatus,
  quoteTransition,
} from "~/domain/lifecycle";
import { formatQuantity } from "~/domain/money";
import { emailInsert, enqueue, type EmailJob } from "~/features/email/service";
import { getInvoice, invoiceShareUrl, reviseInvoiceWith, voidInvoice } from "~/features/invoices/service";
import { getQuote, quoteShareUrl, reviseQuoteWith } from "~/features/quotes/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { ServiceError } from "~/features/settings/service";
import { businessToday } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { type DocumentContent, schema } from "~/server/db";
import { ownerReplyEmail } from "~/server/email/templates";
import type { RequestContext } from "~/server/session";
import {
  conversationOf,
  openLineRefs,
  requestsByIds,
  type ThreadEntity,
  type ThreadMessage,
  threadMessages,
} from "./requests";
import type { ResolveInput } from "./schema";

export type { ThreadEntity, ThreadMessage } from "./requests";

type Ctx = Pick<RequestContext, "db" | "user">;
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

const nowIso = () => new Date().toISOString();
const c = schema.conversation;
const cr = schema.changeRequest;
const m = schema.message;

/** The document behind a thread, checked against the signed-in business. */
async function docOf(ctx: Ctx, entity: ThreadEntity, id: string) {
  const t = entity === "quote" ? schema.quote : schema.invoice;
  const [row] = await ctx.db
    .select({
      id: t.id,
      number: t.number,
      status: t.status,
      salt: t.shareTokenSalt,
      clientId: t.clientId,
      clientName: schema.client.displayName,
      clientEmail: schema.client.email,
    })
    .from(t)
    .leftJoin(schema.client, eq(schema.client.id, t.clientId))
    .where(and(eq(t.id, id), eq(t.businessId, ctx.user.businessId)));
  return row ?? null;
}

/** `owner:<id>` or `staff:<id>` (SPEC 8.2 message.author; docs/decisions.md). */
function authorOf(ctx: Ctx) {
  return `${ctx.user.role}:${ctx.user.id}`;
}

function audit(
  ctx: Ctx,
  entity: ThreadEntity,
  entityId: string,
  action: string,
  data?: Record<string, unknown>,
) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType: entity,
    entityId,
    action,
    data,
  });
}

export interface OwnerThread {
  entity: ThreadEntity;
  entityId: string;
  conversationId: string | null;
  messages: ThreadMessage[];
  /** Unread client messages when the owner opened it (they are read now). */
  unreadBefore: number;
  openRequests: number;
  /** Line ids with an open request, for markers on the document. */
  openLines: string[];
}

/**
 * The thread beside a document (FR-MSG-01), hidden messages flagged. Opening
 * it marks the client's messages read (FR-MSG-09).
 */
export async function ownerThread(ctx: Ctx, entity: ThreadEntity, entityId: string): Promise<OwnerThread> {
  const conversation = await conversationOf(ctx.db, entity, entityId);
  if (!conversation || conversation.businessId !== ctx.user.businessId) {
    return {
      entity,
      entityId,
      conversationId: null,
      messages: [],
      unreadBefore: 0,
      openRequests: 0,
      openLines: [],
    };
  }
  const messages = await threadMessages(ctx.db, conversation.id, { includeHidden: true });
  if (conversation.ownerUnread > 0) {
    await ctx.db
      .update(c)
      .set({ ownerUnread: 0 })
      .where(and(eq(c.id, conversation.id), gt(c.ownerUnread, 0)));
  }
  return {
    entity,
    entityId,
    conversationId: conversation.id,
    messages,
    unreadBefore: conversation.ownerUnread,
    openRequests: messages.filter((msg) => msg.request?.status === "open").length,
    openLines: openLineRefs(messages),
  };
}

/** What a screen needs of a thread (ThreadPanel), ready to serialise. */
export function threadPanelData(thread: OwnerThread) {
  return {
    conversationId: thread.conversationId,
    messages: thread.messages.map(({ revisionId: _revisionId, ...msg }) => msg),
    unreadBefore: thread.unreadBefore,
    openRequests: thread.openRequests,
    openLines: thread.openLines,
    /** Accepted into the draft revision, not sent yet: the builder restarts when this changes. */
    acceptedPending: thread.messages.filter(
      (msg) => msg.request?.status === "accepted" && !msg.request.resolvedInRevisionId,
    ).length,
  };
}

/** The thread for an Inbox row (conversation id), with its document. */
export async function threadById(ctx: Ctx, conversationId: string) {
  const [row] = await ctx.db
    .select({ entityType: c.entityType, entityId: c.entityId })
    .from(c)
    .where(and(eq(c.id, conversationId), eq(c.businessId, ctx.user.businessId)));
  if (!row) return null;
  const doc = await docOf(ctx, row.entityType, row.entityId);
  if (!doc) return null;
  return { doc, thread: await ownerThread(ctx, row.entityType, row.entityId) };
}

/** The payer's portal link to the thread, or null if the document has none. */
async function portalUrl(ctx: RequestContext, entity: ThreadEntity, id: string, salt: string | null) {
  if (!salt) return null;
  const url =
    entity === "quote" ? await quoteShareUrl(ctx.env, id, salt) : await invoiceShareUrl(ctx.env, id, salt);
  return `${url}#conversation`;
}

/** The conversation id, creating the row in `statements` if the document has none yet. */
async function ensureConversation(
  ctx: Ctx,
  entity: ThreadEntity,
  entityId: string,
  statements: BatchItem<"sqlite">[],
) {
  const existing = await conversationOf(ctx.db, entity, entityId);
  if (existing) return existing.id;
  const id = newId("cnv");
  statements.push(
    ctx.db
      .insert(c)
      .values({ id, businessId: ctx.user.businessId, createdBy: ctx.user.id, entityType: entity, entityId }),
  );
  return id;
}

function replyEmail(
  ctx: RequestContext,
  doc: NonNullable<Awaited<ReturnType<typeof docOf>>>,
  entity: ThreadEntity,
  key: string,
  url: string,
  content: { message?: string; outcomes?: string[] },
  brand: Awaited<ReturnType<typeof loadEmailBrand>>,
) {
  const message = {
    ...ownerReplyEmail(brand, {
      noun: entity,
      clientName: doc.clientName ?? "there",
      number: doc.number!,
      url,
      ...content,
    }),
    to: [doc.clientEmail!],
    replyTo: brand.replyTo,
    idempotencyKey: key,
  };
  const email = emailInsert(ctx.db, {
    businessId: ctx.user.businessId,
    createdBy: ctx.user.id,
    entityType: entity,
    entityId: doc.id,
    template: `${entity}_owner_reply`,
    message,
  });
  const job: EmailJob = { kind: "email", emailId: email.id, businessId: ctx.user.businessId, message };
  return { insert: email.insert, job };
}

/** FR-MSG-04: the team replies; the payer gets it by email with a link back to the thread. */
export async function postOwnerMessage(
  ctx: RequestContext,
  entity: ThreadEntity,
  entityId: string,
  body: string,
) {
  const doc = await docOf(ctx, entity, entityId);
  if (!doc) throw new ServiceError(`This ${entity} no longer exists`);
  if (!doc.number) throw new ServiceError(`Send the ${entity} before starting a conversation`);
  const statements: BatchItem<"sqlite">[] = [];
  const conversationId = await ensureConversation(ctx, entity, entityId, statements);
  const messageId = newId("msg");
  const now = nowIso();
  statements.push(
    ctx.db.insert(m).values({ id: messageId, conversationId, author: authorOf(ctx), body, createdAt: now }),
    ctx.db
      .update(c)
      .set({ lastMessageAt: now, clientUnread: sql`${c.clientUnread} + 1`, ownerUnread: 0, updatedAt: now })
      .where(eq(c.id, conversationId)),
    audit(ctx, entity, entityId, `${entity}.message_sent`, { length: body.length }),
  );
  const jobs: EmailJob[] = [];
  const url = await portalUrl(ctx, entity, entityId, doc.salt);
  if (url && doc.clientEmail) {
    const brand = await loadEmailBrand(ctx.db, ctx.env, ctx.user.businessId);
    const email = replyEmail(
      ctx,
      doc,
      entity,
      `message:${messageId}:owner_reply`,
      url,
      { message: body },
      brand,
    );
    statements.push(email.insert);
    jobs.push(email.job);
  }
  await ctx.db.batch(statements as Batch);
  const queued = await enqueue(ctx.env, jobs);
  return { emailed: jobs.length > 0 && queued };
}

function aboutRequest(
  r: { kind: ChangeKind; lineLabel: string | null; proposedQtyMilli: number | null },
  noun: string,
) {
  const line = r.lineLabel ?? `the whole ${noun}`;
  const qty = r.kind === "quantity" && r.proposedQtyMilli ? ` to ${formatQuantity(r.proposedQtyMilli)}` : "";
  return `${CHANGE_KIND_LABEL[r.kind]}: ${line}${qty}`;
}

const DONE = { accept: "accepted", decline: "declined", answer: "answered" } as const;

/**
 * FR-MSG-05: resolve one or more open requests. Accept batches them into one
 * draft revision with the changes applied (Other is left for the owner to
 * make); Decline needs a reason; questions are answered. The payer sees the
 * outcome on each card and gets one email. Returns where to go next: the
 * draft revision after an accept.
 */
export async function resolveRequests(
  ctx: RequestContext,
  entity: ThreadEntity,
  entityId: string,
  input: ResolveInput,
): Promise<{ redirectTo: string | null; message: string }> {
  const doc = await docOf(ctx, entity, entityId);
  if (!doc) throw new ServiceError(`This ${entity} no longer exists`);
  const conversation = await conversationOf(ctx.db, entity, entityId);
  if (!conversation) throw new ServiceError("There's nothing to resolve");
  const requests = await requestsByIds(ctx.db, conversation.id, input.requestIds);
  if (requests.length !== new Set(input.requestIds).size || requests.some((r) => r.status !== "open"))
    throw new ServiceError("Some of those requests were already resolved; reload to see the latest");
  for (const r of requests) {
    if (!resolutionsFor(r.kind).includes(input.decision))
      throw new ServiceError(
        r.kind === "question"
          ? "Questions are answered, not accepted or declined"
          : "Only questions are answered",
      );
  }
  if (input.decision === "decline" && input.note.length < 2)
    throw new ServiceError("Give the client a reason", "note");

  const now = nowIso();
  const status = DONE[input.decision];
  const ids = requests.map((r) => r.id);
  const statements: BatchItem<"sqlite">[] = [
    ctx.db
      .update(cr)
      .set({ status, resolutionNote: input.note || null, resolvedAt: now })
      .where(and(inArray(cr.id, ids), eq(cr.status, "open"))),
    // All or nothing: a request resolved in another tab fails the batch (owner_unread is NOT NULL).
    ctx.db
      .update(c)
      .set({
        ownerUnread: sql`case when changes() = ${ids.length} then 0 else null end`,
        clientUnread: sql`${c.clientUnread} + 1`,
        updatedAt: now,
      })
      .where(eq(c.id, conversation.id)),
    ...requests.map((r) =>
      audit(ctx, entity, entityId, `${entity}.change_${status}`, {
        about: aboutRequest(r, entity),
        note: input.note || undefined,
      }),
    ),
  ];

  const outcomes = requests.map((r) => {
    const verb = { accepted: "Accepted", declined: "Declined", answered: "Answered" }[status];
    return `${verb}: ${aboutRequest(r, entity)}${input.note ? ` (${input.note})` : ""}`;
  });
  if (input.decision === "accept")
    outcomes.push(`We'll send you the revised ${entity} by email with what changed.`);
  const jobs: EmailJob[] = [];
  const url = await portalUrl(ctx, entity, entityId, doc.salt);
  if (url && doc.clientEmail) {
    const brand = await loadEmailBrand(ctx.db, ctx.env, ctx.user.businessId);
    const email = replyEmail(ctx, doc, entity, `resolve:${ids[0]}:${status}`, url, { outcomes }, brand);
    statements.push(email.insert);
    jobs.push(email.job);
  }

  const toApply = requests.map((r) => ({
    id: r.id,
    lineRef: r.lineRef,
    kind: r.kind,
    proposedQtyMilli: r.proposedQtyMilli,
  }));
  const count = `${requests.length} request${requests.length === 1 ? "" : "s"}`;
  let redirectTo: string | null = null;
  let message = `${count} ${status}; the client has been told`;

  if (input.decision === "accept" && entity === "quote") {
    const detail = await getQuote(ctx, entityId);
    if (!detail) throw new ServiceError("This quote no longer exists");
    if (detail.quote.status !== "draft" && !canQuote(detail.quote.status, "revise"))
      throw new ServiceError("This quote can't be revised now");
    await reviseQuoteWith(
      ctx,
      detail,
      (content) => applyChangeRequests(content, toApply).content,
      statements,
    );
    redirectTo = `/quotes/${entityId}`;
    message = `${count} accepted. Check the revision, then send it.`;
  } else if (input.decision === "accept") {
    const detail = await getInvoice(ctx, entityId);
    if (!detail) throw new ServiceError("This invoice no longer exists");
    const change = (content: Omit<DocumentContent, "header">) =>
      applyChangeRequests(content, toApply).content;
    if (detail.settledCents > 0 && detail.invoice.status !== "draft") {
      // FR-MSG-06: an invoice with payments isn't revised in place.
      if (!input.reissue)
        throw new ServiceError("This invoice has payments, so it's voided and reissued", "reissue");
      const reissueId = await voidInvoice(
        ctx,
        entityId,
        { reason: input.note || "Corrected after the client's change request", reissue: true },
        { change, extra: statements },
      );
      redirectTo = `/invoices/${reissueId}`;
      message = `${count} accepted. ${doc.number} is void; check the corrected copy, then send it.`;
    } else {
      await reviseInvoiceWith(ctx, detail, change, statements);
      redirectTo = `/invoices/${entityId}`;
      message = `${count} accepted. Check the revision, then send it.`;
    }
  } else {
    // Declined or answered: once nothing is open the document is back to normal.
    const remaining = (await openCount(ctx, conversation.id)) - ids.length;
    if (remaining === 0) statements.push(...(await reopenStatements(ctx, entity, entityId)));
    await ctx.db.batch(statements as Batch);
  }
  await enqueue(ctx.env, jobs);
  return { redirectTo, message };
}

async function openCount(ctx: Ctx, conversationId: string) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(cr)
    .where(and(eq(cr.conversationId, conversationId), eq(cr.status, "open")));
  return row?.n ?? 0;
}

/** Leaving changes_requested after the last open request (lifecycle `resolve`). */
async function reopenStatements(
  ctx: Ctx,
  entity: ThreadEntity,
  entityId: string,
): Promise<BatchItem<"sqlite">[]> {
  if (entity === "quote") {
    const [q] = await ctx.db
      .select({ status: schema.quote.status })
      .from(schema.quote)
      .where(eq(schema.quote.id, entityId));
    if (!q || !canQuote(q.status, "resolve")) return [];
    return [
      ctx.db
        .update(schema.quote)
        .set({ status: quoteTransition(q.status as QuoteStatus, "resolve"), updatedAt: nowIso() })
        .where(and(eq(schema.quote.id, entityId), eq(schema.quote.status, q.status))),
    ];
  }
  const detail = await getInvoice(ctx, entityId);
  if (!detail || !canInvoice(detail.invoice.status, "resolve")) return [];
  invoiceTransition(detail.invoice.status as InvoiceStatus, "resolve");
  const next = deriveInvoiceStatus({
    totalCents: detail.revision?.totalCents ?? 0,
    settledCents: detail.settledCents,
    viewed: true,
    pastDue: !!detail.invoice.dueDate && detail.invoice.dueDate < businessToday(),
    openRequest: false,
  });
  return [
    ctx.db
      .update(schema.invoice)
      .set({ status: next, updatedAt: nowIso() })
      .where(and(eq(schema.invoice.id, entityId), eq(schema.invoice.status, detail.invoice.status))),
  ];
}

/** FR-MSG-10: the owner hides (never deletes) a client message; it stays in the audit trail. */
export async function setMessageHidden(ctx: RequestContext, messageId: string, hidden: boolean) {
  if (ctx.user.role !== "owner") throw new ServiceError("Only an owner can hide messages");
  const [row] = await ctx.db
    .select({ author: m.author, entityType: c.entityType, entityId: c.entityId })
    .from(m)
    .innerJoin(c, eq(c.id, m.conversationId))
    .where(and(eq(m.id, messageId), eq(c.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("That message no longer exists");
  if (row.author !== "client") throw new ServiceError("Only client messages can be hidden");
  await ctx.db.batch([
    ctx.db
      .update(m)
      .set({ hiddenAt: hidden ? nowIso() : null })
      .where(eq(m.id, messageId)),
    audit(
      ctx,
      row.entityType,
      row.entityId,
      hidden ? `${row.entityType}.message_hidden` : `${row.entityType}.message_shown`,
      {
        messageId,
      },
    ),
  ]);
}

// ---------- Inbox (FR-MSG-09) ----------

export { INBOX_FILTERS, type InboxFilter } from "./constants";
import type { InboxFilter } from "./constants";

const openRequestsSql = sql<number>`(select count(*) from ${cr} where ${cr.conversationId} = ${c.id} and ${cr.status} = 'open')`;

/** Needs the owner: unread client messages or an open change request. */
const needsOwner = or(gt(c.ownerUnread, 0), sql`${openRequestsSql} > 0`);

/** Threads, newest first: document, client, last message, unread and open-request counts. */
export async function listThreads(
  ctx: Ctx,
  opts: { filter?: InboxFilter; clientId?: string | null; limit?: number } = {},
) {
  const q = schema.quote;
  const i = schema.invoice;
  const clientId = sql<string | null>`coalesce(${q.clientId}, ${i.clientId})`;
  const lastOf = <T>(column: unknown) =>
    sql<T>`(select ${column} from ${m} where ${m.conversationId} = ${c.id} and ${m.hiddenAt} is null order by ${m.createdAt} desc limit 1)`;
  const rows = await ctx.db
    .select({
      id: c.id,
      entityType: c.entityType,
      entityId: c.entityId,
      lastMessageAt: c.lastMessageAt,
      ownerUnread: c.ownerUnread,
      openRequests: openRequestsSql,
      lastBody: lastOf<string | null>(m.body),
      lastAuthor: lastOf<string | null>(m.author),
      lastClientName: lastOf<string | null>(m.clientName),
      number: sql<string | null>`coalesce(${q.number}, ${i.number})`,
      status: sql<string>`coalesce(${q.status}, ${i.status})`,
      clientId,
      clientName: schema.client.displayName,
    })
    .from(c)
    .leftJoin(q, and(eq(c.entityType, "quote"), eq(q.id, c.entityId)))
    .leftJoin(i, and(eq(c.entityType, "invoice"), eq(i.id, c.entityId)))
    .leftJoin(schema.client, eq(schema.client.id, clientId))
    .where(
      and(
        eq(c.businessId, ctx.user.businessId),
        isNotNull(c.lastMessageAt),
        opts.filter === "open" ? needsOwner : undefined,
        opts.clientId ? sql`${clientId} = ${opts.clientId}` : undefined,
      ),
    )
    .orderBy(desc(c.lastMessageAt))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 200));
  return rows.map((r) => ({
    ...r,
    fromClient: r.lastAuthor === "client",
  }));
}

export type ThreadListRow = Awaited<ReturnType<typeof listThreads>>[number];

/** Clients with at least one thread, for the Inbox filter. */
export async function threadClients(ctx: Ctx) {
  const q = schema.quote;
  const i = schema.invoice;
  const clientId = sql<string>`coalesce(${q.clientId}, ${i.clientId})`;
  return ctx.db
    .selectDistinct({ id: schema.client.id, name: schema.client.displayName })
    .from(c)
    .leftJoin(q, and(eq(c.entityType, "quote"), eq(q.id, c.entityId)))
    .leftJoin(i, and(eq(c.entityType, "invoice"), eq(i.id, c.entityId)))
    .innerJoin(schema.client, eq(schema.client.id, clientId))
    .where(eq(c.businessId, ctx.user.businessId))
    .orderBy(schema.client.displayName);
}

/** The navigation badge: threads that need the owner (FR-MSG-09). One cheap count. */
export async function inboxBadge(ctx: Ctx) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(c)
    .where(and(eq(c.businessId, ctx.user.businessId), needsOwner));
  return row?.n ?? 0;
}
