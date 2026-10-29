// Client portal (SPEC 5.6 FR-QT-10…12, 6.8, 11). A visitor is identified only
// by the hashed share token and can make exactly three kinds of write: approve,
// post a message, raise a change request. Viewing is recorded as a portal
// event; a quote past its valid-until date is marked expired when opened.

import { and, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { CHANGE_KIND_LABEL, type ChangeKind, kindsFor, WHOLE_DOCUMENT } from "~/domain/change-requests";
import { describeDiff, diffContent } from "~/domain/diff";
import { computeContent, depositFrom } from "~/domain/document";
import { settledCents } from "~/domain/invoice";
import { type InvoiceStatus, invoiceTransition, type QuoteStatus, quoteTransition } from "~/domain/lifecycle";
import { formatCents, formatQuantity } from "~/domain/money";
import {
  applySelection,
  isPastValidUntil,
  optionIds,
  signatureSvg,
  validateSignerName,
} from "~/domain/portal";
import { conversationOf, type ThreadEntity, threadMessages } from "~/features/conversations/requests";
import { activeOwners, emailInsert, enqueue, type EmailJob } from "~/features/email/service";
import { createInvoiceOnApproval } from "~/features/invoices/service";
import { ownerNotices } from "~/features/notifications/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { businessToday } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { type Db, type DocumentContent, getDb, schema } from "~/server/db";
import {
  changesRequestedOwnerEmail,
  quoteApprovedClientEmail,
  quoteApprovedOwnerEmail,
} from "~/server/email/templates";
import { hashShareToken, looksLikeShareToken, portalPath } from "~/server/tokens";
import type { ApproveInput, ChangeRequestInput, MessageInput } from "./schema";

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

function requireInvoiceChanged(db: Db, id: string) {
  return db
    .update(schema.invoice)
    .set({ draftVersion: sql`case when changes() = 1 then ${schema.invoice.draftVersion} else null end` })
    .where(eq(schema.invoice.id, id));
}

/** The client has seen the thread: replies are no longer unread for them. */
function clientRead(db: Db, entity: ThreadEntity, entityId: string) {
  return db
    .update(schema.conversation)
    .set({ clientUnread: 0 })
    .where(
      and(
        eq(schema.conversation.entityType, entity),
        eq(schema.conversation.entityId, entityId),
        gt(schema.conversation.clientUnread, 0),
      ),
    );
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
    clientRead(db, "quote", quote.id),
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
      // FR-SYS-02: the owner hears about the first look at each revision.
      ...(await ownerNotices(db, quote.businessId, {
        type: "quote.viewed",
        entityType: "quote",
        entityId: quote.id,
        title: `${portal.client.displayName} opened quote ${quote.number}`,
      })),
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

  // Owner request: draft the deposit invoice (or one for the total) right away.
  // The approval stands even if this fails; the owner can still make it by hand.
  let invoiceId: string | null = null;
  try {
    const drafted = await createInvoiceOnApproval(db, quote.businessId, quote.id);
    if (drafted) {
      invoiceId = drafted.id;
      const notices = await ownerNotices(db, quote.businessId, {
        type: "invoice.drafted",
        entityType: "invoice",
        entityId: drafted.id,
        title: `${drafted.kind === "deposit" ? "Deposit invoice" : "Invoice"} for ${client.displayName} is drafted; check it and send`,
      });
      if (notices.length > 0) await db.batch(notices as unknown as Batch);
    }
  } catch (error) {
    console.error(
      "auto invoice on approval failed",
      quote.id,
      error instanceof Error ? error.message : error,
    );
  }
  return { totalCents: totals.computed.totalCents, depositCents: totals.depositCents, projectId, invoiceId };
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
    clientRead(db, "invoice", invoice.id),
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
      ...(await ownerNotices(db, invoice.businessId, {
        type: "invoice.viewed",
        entityType: "invoice",
        entityId: invoice.id,
        title: `${portal.client.displayName} opened invoice ${invoice.number}`,
      })),
    );
  }
  await db.batch(statements as Batch);
}

// ---------- Conversation (FR-MSG-02, 03; SPEC 11.1) ----------

/** The document behind a token, in the shape the conversation writes need. */
async function portalDoc(env: Env, entity: ThreadEntity, token: string) {
  if (entity === "quote") {
    const p = await loadPortalQuote(env, token);
    if (!p) return null;
    return {
      entity,
      id: p.quote.id,
      businessId: p.quote.businessId,
      number: p.quote.number!,
      status: p.quote.status as string,
      revision: p.revision,
      client: p.client,
    };
  }
  const p = await loadPortalInvoice(env, token);
  if (!p) return null;
  return {
    entity,
    id: p.invoice.id,
    businessId: p.invoice.businessId,
    number: p.invoice.number!,
    status: p.invoice.status as string,
    revision: p.revision,
    client: p.client,
  };
}

type PortalDoc = NonNullable<Awaited<ReturnType<typeof portalDoc>>>;

/** Statuses where the payer can ask for a change (SPEC 5.13). */
const REQUESTABLE: Record<ThreadEntity, string[]> = {
  quote: ["sent", "viewed", "changes_requested"],
  invoice: ["sent", "viewed", "changes_requested", "partially_paid", "overdue"],
};

/**
 * A portal write is only ever about the document its token opens, as shown:
 * a revision id from any other document (or an older revision) is refused.
 */
function checkWritable(doc: PortalDoc, revisionId: string, opts: { request: boolean }) {
  const noun = doc.entity;
  if (doc.status === "void") throw new PortalError(`This ${noun} has been cancelled.`, "closed");
  if (doc.status === "declined") throw new PortalError(`This ${noun} is closed.`, "closed");
  if (opts.request) {
    if (doc.status === "draft")
      throw new PortalError(
        `This ${noun} is being updated. You'll get the new version by email.`,
        "revising",
      );
    if (doc.status === "expired")
      throw new PortalError(`This ${noun} has expired. Send us a message for an updated one.`, "expired");
    if (!REQUESTABLE[doc.entity].includes(doc.status))
      throw new PortalError(`This ${noun} can't be changed now. You can still send a message.`, "closed");
  }
  if (revisionId !== doc.revision.id)
    throw new PortalError(
      `This ${noun} was updated since you opened it. Please review the latest version.`,
      "stale",
    );
}

/**
 * A client's entry in the document's conversation and everything that goes
 * with it: the conversation row, the owner's unread count, a notification and
 * an email for every owner, and activity. Rate limited per conversation (SPEC
 * 11.1: 10 an hour). The caller adds the change request and status change.
 */
async function clientPost(
  env: Env,
  db: Db,
  doc: PortalDoc,
  args: { authorName: string; body: string; meta: VisitorMeta; about?: string },
) {
  const existing = await conversationOf(db, doc.entity, doc.id);
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
    loadEmailBrand(db, env, doc.businessId),
    activeOwners(db, doc.businessId),
  ]);
  const ownerUrl = new URL(`/${doc.entity}s/${doc.id}#conversation`, env.APP_URL).toString();
  const request = args.about !== undefined;
  const messageId = newId("msg");
  const now = nowIso();
  const jobs: EmailJob[] = [];
  const statements: BatchItem<"sqlite">[] = [];
  if (!existing) {
    statements.push(
      db.insert(schema.conversation).values({
        id: conversationId,
        businessId: doc.businessId,
        entityType: doc.entity,
        entityId: doc.id,
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
      revisionId: doc.revision.id,
      createdAt: now,
    }),
    db
      .update(schema.conversation)
      .set({ lastMessageAt: now, ownerUnread: sql`${schema.conversation.ownerUnread} + 1`, updatedAt: now })
      .where(eq(schema.conversation.id, conversationId)),
    activityInsert(db, {
      businessId: doc.businessId,
      actor: { type: "client" },
      entityType: doc.entity,
      entityId: doc.id,
      action: request ? `${doc.entity}.changes_requested` : `${doc.entity}.message_received`,
      data: {
        name: args.authorName,
        revision: doc.revision.revisionNo,
        about: args.about,
        ip: args.meta.ip,
      },
    }),
  );
  for (const owner of owners) {
    statements.push(
      db.insert(schema.notification).values({
        id: newId("ntf"),
        userId: owner.id,
        type: request ? `${doc.entity}.changes_requested` : `${doc.entity}.message`,
        entityType: doc.entity,
        entityId: doc.id,
        title: request
          ? `${doc.client.displayName} asked for a change to ${doc.number}`
          : `${doc.client.displayName} sent a message about ${doc.number}`,
      }),
    );
    const message = {
      ...changesRequestedOwnerEmail(brand, {
        noun: doc.entity,
        clientName: doc.client.displayName,
        authorName: args.authorName,
        number: doc.number,
        message: args.body,
        url: ownerUrl,
        about: args.about,
      }),
      to: [owner.email],
      idempotencyKey: `message:${messageId}:${request ? "changes_requested" : "message"}:${owner.id}`,
    };
    const email = emailInsert(db, {
      businessId: doc.businessId,
      entityType: doc.entity,
      entityId: doc.id,
      template: request ? `${doc.entity}_changes_requested_owner` : `${doc.entity}_message_owner`,
      message,
    });
    statements.push(email.insert);
    jobs.push({ kind: "email", emailId: email.id, businessId: doc.businessId, message });
  }
  return { statements, jobs, conversationId, messageId };
}

/** FR-MSG-02: a plain message. It never changes the document or its status. */
export async function postClientMessage(
  env: Env,
  entity: ThreadEntity,
  token: string,
  input: MessageInput,
  meta: VisitorMeta,
) {
  const doc = await portalDoc(env, entity, token);
  if (!doc) throw new PortalError("This link isn't valid.", "invalid");
  checkWritable(doc, input.revisionId, { request: false });
  const db = getDb(env);
  const { statements, jobs } = await clientPost(env, db, doc, {
    authorName: input.name,
    body: input.message,
    meta,
  });
  await db.batch(statements as Batch);
  await enqueue(env, jobs);
}

/** "Remove this item: Cushions", "Change quantity: Cushions (2 → 1)". */
function describeRequest(kind: ChangeKind, label: string, fromQty?: number, toQty?: number | null) {
  const what = CHANGE_KIND_LABEL[kind];
  if (kind === "quantity" && fromQty !== undefined && toQty)
    return `${what}: ${label} (${formatQuantity(fromQty)} → ${formatQuantity(toQty)})`;
  return `${what}: ${label}`;
}

/**
 * FR-MSG-03: "Request a change" on a line of the revision on screen, or on the
 * whole document. The document moves to changes_requested (reminders pause,
 * FR-MSG-07); nothing in it changes until the owner sends a revision.
 */
export async function raiseChangeRequest(
  env: Env,
  entity: ThreadEntity,
  token: string,
  input: ChangeRequestInput,
  meta: VisitorMeta,
) {
  const doc = await portalDoc(env, entity, token);
  if (!doc) throw new PortalError("This link isn't valid.", "invalid");
  checkWritable(doc, input.revisionId, { request: true });
  const whole = input.lineRef === WHOLE_DOCUMENT;
  const line = whole
    ? null
    : doc.revision.content.sections.flatMap((s) => s.lines).find((l) => l.id === input.lineRef);
  if (!whole && !line) throw new PortalError("That line isn't on this version.", "stale");
  if (!kindsFor(line ?? null).includes(input.kind))
    throw new PortalError("Ask a question about this line, or choose Other.", "input", "kind");
  const label = whole ? `the whole ${entity}` : line!.description || "Untitled line";

  const db = getDb(env);
  const { statements, jobs, conversationId, messageId } = await clientPost(env, db, doc, {
    authorName: input.name,
    body: input.note,
    meta,
    about: describeRequest(input.kind, label, line?.qtyMilli, input.proposedQtyMilli),
  });
  statements.push(
    db.insert(schema.changeRequest).values({
      id: newId("chg"),
      conversationId,
      messageId,
      revisionId: doc.revision.id,
      lineRef: input.lineRef,
      lineLabel: whole ? null : line!.description || null,
      kind: input.kind,
      proposedQtyMilli: input.kind === "quantity" ? input.proposedQtyMilli : null,
    }),
  );
  const now = nowIso();
  if (entity === "quote") {
    statements.push(
      db
        .update(schema.quote)
        .set({ status: quoteTransition(doc.status as QuoteStatus, "request_changes"), updatedAt: now })
        .where(
          and(
            eq(schema.quote.id, doc.id),
            eq(schema.quote.status, doc.status as QuoteStatus),
            eq(schema.quote.currentRevisionId, doc.revision.id),
          ),
        ),
      requireChanged(db, doc.id),
    );
  } else {
    statements.push(
      db
        .update(schema.invoice)
        .set({ status: invoiceTransition(doc.status as InvoiceStatus, "request_changes"), updatedAt: now })
        .where(
          and(
            eq(schema.invoice.id, doc.id),
            eq(schema.invoice.status, doc.status as InvoiceStatus),
            eq(schema.invoice.currentRevisionId, doc.revision.id),
          ),
        ),
      requireInvoiceChanged(db, doc.id),
    );
  }
  try {
    await db.batch(statements as Batch);
  } catch (error) {
    // Revised, approved or paid in the meantime: explain from the current state.
    const fresh = await portalDoc(env, entity, token);
    if (!fresh) throw new PortalError("This link isn't valid any more.", "invalid");
    checkWritable(fresh, input.revisionId, { request: true });
    if (fresh.status !== doc.status)
      throw new PortalError("This changed while you were writing. Please try again.", "stale");
    throw error;
  }
  await enqueue(env, jobs);
}

/** The thread under a portal document, without hidden messages (FR-MSG-10). */
export async function portalThread(env: Env, entity: ThreadEntity, entityId: string) {
  const db = getDb(env);
  const conversation = await conversationOf(db, entity, entityId);
  if (!conversation) return [];
  return threadMessages(db, conversation.id, { includeHidden: false });
}

type DepositTerms = { depositType?: "percent" | "amount" | null; depositValue?: number | null };

/**
 * FR-MSG-06: what changed since the previous revision, for the card above a
 * revised document. Null on revision 1.
 */
export async function portalWhatChanged(
  env: Env,
  entity: ThreadEntity,
  entityId: string,
  revision: { revisionNo: number; content: DocumentContent } & DepositTerms,
) {
  if (revision.revisionNo < 2) return null;
  const db = getDb(env);
  const [previous] =
    entity === "quote"
      ? await db
          .select()
          .from(schema.quoteRevision)
          .where(
            and(
              eq(schema.quoteRevision.quoteId, entityId),
              eq(schema.quoteRevision.revisionNo, revision.revisionNo - 1),
            ),
          )
      : await db
          .select()
          .from(schema.invoiceRevision)
          .where(
            and(
              eq(schema.invoiceRevision.invoiceId, entityId),
              eq(schema.invoiceRevision.revisionNo, revision.revisionNo - 1),
            ),
          );
  if (!previous) return null;
  const terms = (row: DepositTerms) => depositFrom(row.depositType, row.depositValue);
  const diff = diffContent(previous.content, revision.content, {
    before: terms(previous as DepositTerms),
    after: terms(revision),
  });
  return {
    previousRevisionNo: previous.revisionNo,
    lines: describeDiff(diff),
    totalBeforeCents: diff.totalBeforeCents,
    totalAfterCents: diff.totalAfterCents,
  };
}
