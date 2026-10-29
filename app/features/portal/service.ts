// Client portal (SPEC 5.6 FR-QT-10…12, 6.8, 11). A visitor is identified only
// by the hashed share token and can make exactly three kinds of write: approve,
// post a message, raise a change request. Viewing is recorded as a portal
// event; a quote past its valid-until date is marked expired when opened.

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { computeContent, depositFrom } from "~/domain/document";
import { settledCents } from "~/domain/invoice";
import { canInvoice, invoiceTransition } from "~/domain/lifecycle";
import { formatCents } from "~/domain/money";
import {
  applySelection,
  isPastValidUntil,
  optionIds,
  signatureSvg,
  validateSignerName,
} from "~/domain/portal";
import { activeOwners, emailInsert, enqueue, type EmailJob } from "~/features/email/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { businessToday } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { type Db, getDb, schema } from "~/server/db";
import {
  changesRequestedOwnerEmail,
  quoteApprovedClientEmail,
  quoteApprovedOwnerEmail,
} from "~/server/email/templates";
import { hashShareToken, looksLikeShareToken, portalPath } from "~/server/tokens";
import type { ApproveInput, RequestChangesInput } from "./schema";

export class PortalError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "stale" | "expired" | "closed" | "revising" | "limit" | "input",
    readonly field?: string,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

export interface VisitorMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Messages a portal link may post per hour (SPEC 11.1). */
export const MESSAGES_PER_HOUR = 10;

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

const nowIso = () => new Date().toISOString();

/** Fails the batch if the conditional UPDATE before it changed no row. */
function requireChanged(db: Db, id: string) {
  return db
    .update(schema.quote)
    .set({ draftVersion: sql`case when changes() = 1 then ${schema.quote.draftVersion} else null end` })
    .where(eq(schema.quote.id, id));
}

function clientActivity(db: Db, businessId: string, quoteId: string, action: string, data?: object) {
  return activityInsert(db, {
    businessId,
    actor: { type: "client" },
    entityType: "quote",
    entityId: quoteId,
    action,
    data: data as Record<string, unknown> | undefined,
  });
}

/**
 * The quote behind a share token, or null for a malformed, unknown or revoked
 * token. Marks a sent quote expired once its valid-until day has passed (FR-QT-11).
 */
export async function loadPortalQuote(env: Env, token: string | undefined) {
  if (!looksLikeShareToken(token)) return null;
  const db = getDb(env);
  const [row] = await db
    .select()
    .from(schema.quote)
    .where(eq(schema.quote.shareTokenHash, await hashShareToken(token)));
  if (!row?.currentRevisionId || !row.clientId) return null;
  const [[revision], [client], site, [acceptance]] = await Promise.all([
    db.select().from(schema.quoteRevision).where(eq(schema.quoteRevision.id, row.currentRevisionId)),
    db.select().from(schema.client).where(eq(schema.client.id, row.clientId)),
    row.siteId ? db.select().from(schema.site).where(eq(schema.site.id, row.siteId)) : Promise.resolve([]),
    row.status === "approved"
      ? db
          .select()
          .from(schema.quoteAcceptance)
          .where(eq(schema.quoteAcceptance.quoteRevisionId, row.currentRevisionId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  if (!revision || !client) return null;

  let status = row.status;
  if ((status === "sent" || status === "viewed") && isPastValidUntil(row.validUntil, businessToday())) {
    await db.batch([
      db
        .update(schema.quote)
        .set({ status: "expired", updatedAt: nowIso() })
        .where(and(eq(schema.quote.id, row.id), eq(schema.quote.status, status))),
      activityInsert(db, {
        businessId: row.businessId,
        actor: { type: "system" },
        entityType: "quote",
        entityId: row.id,
        action: "quote.expired",
        data: { validUntil: row.validUntil },
      }),
    ]);
    status = "expired";
  }
  return {
    quote: { ...row, status },
    revision,
    client,
    site: site[0] ?? null,
    acceptance: acceptance ?? null,
    token,
  };
}

export type PortalQuote = NonNullable<Awaited<ReturnType<typeof loadPortalQuote>>>;

/** Records a view (portal_event) and moves a sent quote to viewed. */
export async function recordQuoteView(env: Env, portal: PortalQuote, meta: VisitorMeta) {
  const db = getDb(env);
  const { quote } = portal;
  const statements: BatchItem<"sqlite">[] = [
    db.insert(schema.portalEvent).values({
      id: newId("pev"),
      entityType: "quote",
      entityId: quote.id,
      event: "viewed",
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    }),
  ];
  if (quote.status === "sent") {
    statements.push(
      db
        .update(schema.quote)
        .set({ status: "viewed", updatedAt: nowIso() })
        .where(and(eq(schema.quote.id, quote.id), eq(schema.quote.status, "sent"))),
      clientActivity(db, quote.businessId, quote.id, "quote.viewed", {
        revision: portal.revision.revisionNo,
      }),
    );
  }
  await db.batch(statements as Batch);
}

function checkOpen(portal: PortalQuote, revisionId: string, allowed: string[]) {
  const { status } = portal.quote;
  if (status === "approved") throw new PortalError("This quote is already approved.", "closed");
  if (status === "draft")
    throw new PortalError("This quote is being updated. You'll get the new version by email.", "revising");
  if (status === "expired")
    throw new PortalError("This quote has expired. Please contact us for an updated quote.", "expired");
  if (!allowed.includes(status)) throw new PortalError("This quote can't be changed now.", "closed");
  if (revisionId !== portal.revision.id)
    throw new PortalError(
      "This quote was updated since you opened it. Please review the latest version.",
      "stale",
    );
}

/**
 * FR-QT-10/12: approve the revision on screen with the client's option choices.
 * The server recomputes the total from the frozen revision; records name,
 * time, IP, user agent and the revision's content hash; creates the project;
 * and tells every owner (email + in-app) and the client (email).
 */
export async function approveQuote(env: Env, token: string, input: ApproveInput, meta: VisitorMeta) {
  const portal = await loadPortalQuote(env, token);
  if (!portal) throw new PortalError("This link isn't valid.", "invalid");
  const { quote, revision, client } = portal;
  // A sent quote opened without a recorded view (for example by a link checker) can still be approved.
  checkOpen(portal, input.revisionId, ["sent", "viewed"]);
  const nameError = validateSignerName(input.signerName);
  if (nameError) throw new PortalError(nameError, "input", "signerName");
  const signerName = input.signerName.trim().replace(/\s+/g, " ");
  let signature: string | null = null;
  if (input.signature) {
    try {
      signature = signatureSvg(JSON.parse(input.signature));
    } catch {
      signature = null;
    }
  }

  const allowed = new Set(optionIds(revision.content));
  const selected = input.options.filter((id) => allowed.has(id));
  const totals = computeContent(
    applySelection(revision.content, selected),
    depositFrom(revision.depositType, revision.depositValue),
  );
  const db = getDb(env);
  const [brand, owners] = await Promise.all([
    loadEmailBrand(db, env, quote.businessId),
    activeOwners(db, quote.businessId),
  ]);
  const facts = {
    number: quote.number!,
    total: formatCents(totals.computed.totalCents),
    deposit: totals.depositCents > 0 ? formatCents(totals.depositCents) : undefined,
  };
  const ownerUrl = new URL(`/quotes/${quote.id}`, env.APP_URL).toString();
  const portalUrl = new URL(portalPath("quote", token), env.APP_URL).toString();

  const jobs: EmailJob[] = [];
  const emailRows: BatchItem<"sqlite">[] = [];
  const queueEmail = (
    template: string,
    key: string,
    to: string,
    rendered: { subject: string; html: string; text: string },
    replyTo?: string,
  ) => {
    const message = { ...rendered, to: [to], replyTo, idempotencyKey: key };
    const email = emailInsert(db, {
      businessId: quote.businessId,
      entityType: "quote",
      entityId: quote.id,
      template,
      message,
    });
    emailRows.push(email.insert);
    jobs.push({ kind: "email", emailId: email.id, businessId: quote.businessId, message });
  };
  const clientEmail = input.signerEmail ?? client.email;
  if (clientEmail) {
    queueEmail(
      "quote_approved_client",
      `quote:${revision.id}:quote_approved_client`,
      clientEmail,
      quoteApprovedClientEmail(brand, { signerName, facts, url: portalUrl }),
      brand.replyTo,
    );
  }
  for (const owner of owners) {
    queueEmail(
      "quote_approved_owner",
      `quote:${revision.id}:quote_approved_owner:${owner.id}`,
      owner.email,
      quoteApprovedOwnerEmail(brand, { clientName: client.displayName, signerName, facts, url: ownerUrl }),
    );
  }

  const projectId = quote.projectId ?? newId("prj");
  const now = nowIso();
  const statements: BatchItem<"sqlite">[] = [];
  if (!quote.projectId) {
    statements.push(
      db.insert(schema.project).values({
        id: projectId,
        businessId: quote.businessId,
        clientId: client.id,
        siteId: quote.siteId,
        name: quote.title || `${client.displayName} (${quote.number})`,
        sourceQuoteId: quote.id,
      }),
    );
  }
  statements.push(
    db
      .update(schema.quote)
      .set({ status: "approved", projectId, updatedAt: now })
      .where(
        and(
          eq(schema.quote.id, quote.id),
          inArray(schema.quote.status, ["sent", "viewed"]),
          eq(schema.quote.currentRevisionId, revision.id),
        ),
      ),
    requireChanged(db, quote.id),
    db.insert(schema.quoteAcceptance).values({
      id: newId("qac"),
      quoteRevisionId: revision.id,
      selectedOptionLineIds: selected,
      signerName,
      signerEmail: input.signerEmail ?? null,
      signatureSvg: signature,
      acceptedTotalCents: totals.computed.totalCents,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      contentHash: revision.contentHash,
      acceptedAt: now,
    }),
    ...owners.map((owner) =>
      db.insert(schema.notification).values({
        id: newId("ntf"),
        userId: owner.id,
        type: "quote.approved",
        entityType: "quote",
        entityId: quote.id,
        title: `${client.displayName} approved ${quote.number} (${facts.total})`,
      }),
    ),
    ...emailRows,
    clientActivity(db, quote.businessId, quote.id, "quote.approved", {
      signer: signerName,
      revision: revision.revisionNo,
      totalCents: totals.computed.totalCents,
      options: selected.length,
    }),
  );
  if (!quote.projectId) {
    statements.push(
      activityInsert(db, {
        businessId: quote.businessId,
        actor: { type: "system" },
        entityType: "project",
        entityId: projectId,
        action: "project.created",
        data: { fromQuote: quote.number },
      }),
    );
  }

  try {
    await db.batch(statements as Batch);
  } catch (error) {
    // Someone approved, revised or expired it in the meantime: explain from the current state.
    const fresh = await loadPortalQuote(env, token);
    if (!fresh) throw new PortalError("This link isn't valid any more.", "invalid");
    checkOpen(fresh, input.revisionId, ["sent", "viewed"]);
    throw error;
  }
  await enqueue(env, jobs);
  return { totalCents: totals.computed.totalCents, depositCents: totals.depositCents, projectId };
}

/**
 * A client's message in a document's conversation (FR-MSG-02) and everything
 * that goes with it: the conversation row, unread count, a notification and an
 * email for every owner, and activity. Rate limited per conversation (SPEC
 * 11.1). The caller adds its own status change to the same batch.
 */
async function clientMessage(
  env: Env,
  db: Db,
  args: {
    entity: "quote" | "invoice";
    entityId: string;
    businessId: string;
    number: string;
    clientName: string;
    authorName: string;
    body: string;
    revisionId: string;
    revisionNo: number;
    meta: VisitorMeta;
  },
) {
  const [existing] = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(eq(schema.conversation.entityType, args.entity), eq(schema.conversation.entityId, args.entityId)),
    );
  const conversationId = existing?.id ?? newId("cnv");
  if (existing) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [recent] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, existing.id),
          eq(schema.message.author, "client"),
          gte(schema.message.createdAt, since),
        ),
      );
    if ((recent?.n ?? 0) >= MESSAGES_PER_HOUR)
      throw new PortalError("You've sent a lot of messages; please try again in an hour.", "limit");
  }

  const [brand, owners] = await Promise.all([
    loadEmailBrand(db, env, args.businessId),
    activeOwners(db, args.businessId),
  ]);
  const ownerUrl = new URL(`/${args.entity}s/${args.entityId}`, env.APP_URL).toString();
  const messageId = newId("msg");
  const now = nowIso();
  const jobs: EmailJob[] = [];
  const statements: BatchItem<"sqlite">[] = [];
  if (!existing) {
    statements.push(
      db.insert(schema.conversation).values({
        id: conversationId,
        businessId: args.businessId,
        entityType: args.entity,
        entityId: args.entityId,
      }),
    );
  }
  statements.push(
    db.insert(schema.message).values({
      id: messageId,
      conversationId,
      author: "client",
      clientName: args.authorName,
      body: args.body,
      revisionId: args.revisionId,
      createdAt: now,
    }),
    db
      .update(schema.conversation)
      .set({ lastMessageAt: now, ownerUnread: sql`${schema.conversation.ownerUnread} + 1`, updatedAt: now })
      .where(eq(schema.conversation.id, conversationId)),
    activityInsert(db, {
      businessId: args.businessId,
      actor: { type: "client" },
      entityType: args.entity,
      entityId: args.entityId,
      action: `${args.entity}.changes_requested`,
      data: { name: args.authorName, revision: args.revisionNo, ip: args.meta.ip },
    }),
  );
  for (const owner of owners) {
    statements.push(
      db.insert(schema.notification).values({
        id: newId("ntf"),
        userId: owner.id,
        type: `${args.entity}.changes_requested`,
        entityType: args.entity,
        entityId: args.entityId,
        title: `${args.clientName} asked for changes to ${args.number}`,
      }),
    );
    const message = {
      ...changesRequestedOwnerEmail(brand, {
        noun: args.entity,
        clientName: args.clientName,
        authorName: args.authorName,
        number: args.number,
        message: args.body,
        url: ownerUrl,
      }),
      to: [owner.email],
      idempotencyKey: `message:${messageId}:changes_requested:${owner.id}`,
    };
    const email = emailInsert(db, {
      businessId: args.businessId,
      entityType: args.entity,
      entityId: args.entityId,
      template: `${args.entity}_changes_requested_owner`,
      message,
    });
    statements.push(email.insert);
    jobs.push({ kind: "email", emailId: email.id, businessId: args.businessId, message });
  }
  return { statements, jobs };
}

/**
 * The client asks for changes in the quote's conversation (FR-QT-10, FR-MSG-02).
 * Phase 7 adds line-level requests and the owner's replies.
 */
export async function requestQuoteChanges(
  env: Env,
  token: string,
  input: RequestChangesInput,
  meta: VisitorMeta,
) {
  const portal = await loadPortalQuote(env, token);
  if (!portal) throw new PortalError("This link isn't valid.", "invalid");
  const { quote, revision, client } = portal;
  checkOpen(portal, input.revisionId, ["sent", "viewed", "changes_requested"]);
  const db = getDb(env);
  const { statements, jobs } = await clientMessage(env, db, {
    entity: "quote",
    entityId: quote.id,
    businessId: quote.businessId,
    number: quote.number!,
    clientName: client.displayName,
    authorName: input.name,
    body: input.message,
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    meta,
  });
  statements.push(
    db
      .update(schema.quote)
      .set({ status: "changes_requested", updatedAt: nowIso() })
      .where(
        and(
          eq(schema.quote.id, quote.id),
          inArray(schema.quote.status, ["sent", "viewed", "changes_requested"]),
          eq(schema.quote.currentRevisionId, revision.id),
        ),
      ),
    requireChanged(db, quote.id),
  );
  try {
    await db.batch(statements as Batch);
  } catch (error) {
    const fresh = await loadPortalQuote(env, token);
    if (!fresh) throw new PortalError("This link isn't valid any more.", "invalid");
    checkOpen(fresh, input.revisionId, ["sent", "viewed", "changes_requested"]);
    throw error;
  }
  await enqueue(env, jobs);
}

// ---------- Invoices (/i/:token, FR-INV-08) ----------

/** The invoice behind a share token with its payments and balance, or null. */
export async function loadPortalInvoice(env: Env, token: string | undefined) {
  if (!looksLikeShareToken(token)) return null;
  const db = getDb(env);
  const [row] = await db
    .select()
    .from(schema.invoice)
    .where(eq(schema.invoice.shareTokenHash, await hashShareToken(token)));
  if (!row?.currentRevisionId || !row.clientId) return null;
  const [[revision], [client], site, payments] = await Promise.all([
    db.select().from(schema.invoiceRevision).where(eq(schema.invoiceRevision.id, row.currentRevisionId)),
    db.select().from(schema.client).where(eq(schema.client.id, row.clientId)),
    row.siteId ? db.select().from(schema.site).where(eq(schema.site.id, row.siteId)) : Promise.resolve([]),
    db
      .select({
        id: schema.payment.id,
        amountCents: schema.payment.amountCents,
        whtCents: schema.payment.whtCents,
        receivedOn: schema.payment.receivedOn,
        method: schema.payment.method,
      })
      .from(schema.payment)
      .where(and(eq(schema.payment.invoiceId, row.id), isNull(schema.payment.deletedAt)))
      .orderBy(schema.payment.receivedOn),
  ]);
  if (!revision || !client) return null;
  const settled = settledCents({ totalCents: revision.totalCents, payments });
  return {
    invoice: row,
    revision,
    client,
    site: site[0] ?? null,
    payments,
    settledCents: settled,
    balanceCents: revision.totalCents - settled,
    token,
  };
}

export type PortalInvoice = NonNullable<Awaited<ReturnType<typeof loadPortalInvoice>>>;

/** Records a view and moves a sent invoice to viewed. */
export async function recordInvoiceView(env: Env, portal: PortalInvoice, meta: VisitorMeta) {
  const db = getDb(env);
  const { invoice } = portal;
  const statements: BatchItem<"sqlite">[] = [
    db.insert(schema.portalEvent).values({
      id: newId("pev"),
      entityType: "invoice",
      entityId: invoice.id,
      event: "viewed",
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    }),
  ];
  if (invoice.status === "sent") {
    statements.push(
      db
        .update(schema.invoice)
        .set({ status: "viewed", updatedAt: nowIso() })
        .where(and(eq(schema.invoice.id, invoice.id), eq(schema.invoice.status, "sent"))),
      activityInsert(db, {
        businessId: invoice.businessId,
        actor: { type: "client" },
        entityType: "invoice",
        entityId: invoice.id,
        action: "invoice.viewed",
        data: { revision: portal.revision.revisionNo },
      }),
    );
  }
  await db.batch(statements as Batch);
}

/** Statuses where the payer can still write (SPEC 5.13). */
const INVOICE_OPEN: string[] = ["sent", "viewed", "changes_requested", "partially_paid", "overdue"];

/**
 * The payer asks for changes on an invoice (FR-INV-08, FR-MSG-02). An unpaid
 * invoice moves to changes_requested (reminders pause, FR-MSG-07); one with
 * payments keeps its status and the owner sees the message.
 */
export async function requestInvoiceChanges(
  env: Env,
  token: string,
  input: RequestChangesInput,
  meta: VisitorMeta,
) {
  const portal = await loadPortalInvoice(env, token);
  if (!portal) throw new PortalError("This link isn't valid.", "invalid");
  const { invoice, revision, client } = portal;
  if (invoice.status === "draft")
    throw new PortalError("This invoice is being updated. You'll get the new version by email.", "revising");
  if (!INVOICE_OPEN.includes(invoice.status)) throw new PortalError("This invoice is closed.", "closed");
  if (input.revisionId !== revision.id)
    throw new PortalError(
      "This invoice was updated since you opened it. Please review the latest version.",
      "stale",
    );
  const db = getDb(env);
  const { statements, jobs } = await clientMessage(env, db, {
    entity: "invoice",
    entityId: invoice.id,
    businessId: invoice.businessId,
    number: invoice.number!,
    clientName: client.displayName,
    authorName: input.name,
    body: input.message,
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    meta,
  });
  if (canInvoice(invoice.status, "request_changes")) {
    statements.push(
      db
        .update(schema.invoice)
        .set({ status: invoiceTransition(invoice.status, "request_changes"), updatedAt: nowIso() })
        .where(
          and(
            eq(schema.invoice.id, invoice.id),
            eq(schema.invoice.status, invoice.status),
            eq(schema.invoice.currentRevisionId, revision.id),
          ),
        ),
    );
  }
  await db.batch(statements as Batch);
  await enqueue(env, jobs);
}
