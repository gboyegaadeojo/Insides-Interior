// Conversation reads and statement builders shared by the services that touch
// a thread: the portal (client writes), quotes and invoices (sending and
// discarding revisions) and conversations (owner writes). Like server/audit.ts
// these only build statements; the calling service puts them in its batch.

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ChangeKind, ChangeStatus } from "~/domain/change-requests";
import { type Db, schema } from "~/server/db";

export type ThreadEntity = "quote" | "invoice";

const c = schema.conversation;
const cr = schema.changeRequest;

export async function conversationOf(db: Db, entity: ThreadEntity, entityId: string) {
  const [row] = await db
    .select()
    .from(c)
    .where(and(eq(c.entityType, entity), eq(c.entityId, entityId)));
  return row ?? null;
}

/** Subquery: the conversation id of a document (null when it has none yet). */
function conversationIdSql(entity: ThreadEntity, entityId: string) {
  return sql`(select ${c.id} from ${c} where ${c.entityType} = ${entity} and ${c.entityId} = ${entityId})`;
}

export async function openRequestCount(db: Db, entity: ThreadEntity, entityId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(cr)
    .innerJoin(c, eq(c.id, cr.conversationId))
    .where(and(eq(c.entityType, entity), eq(c.entityId, entityId), eq(cr.status, "open")));
  return row?.n ?? 0;
}

/** Accepted requests not yet in a sent revision (they were applied to the draft). */
export async function pendingAccepted(db: Db, entity: ThreadEntity, entityId: string) {
  return db
    .select({ id: cr.id })
    .from(cr)
    .innerJoin(c, eq(c.id, cr.conversationId))
    .where(
      and(
        eq(c.entityType, entity),
        eq(c.entityId, entityId),
        eq(cr.status, "accepted"),
        isNull(cr.resolvedInRevisionId),
      ),
    );
}

/** On send: accepted requests are now resolved in this revision (FR-MSG-05). */
export function resolveAcceptedIn(db: Db, entity: ThreadEntity, entityId: string, revisionId: string) {
  return db
    .update(cr)
    .set({ resolvedInRevisionId: revisionId })
    .where(
      and(
        sql`${cr.conversationId} = ${conversationIdSql(entity, entityId)}`,
        eq(cr.status, "accepted"),
        isNull(cr.resolvedInRevisionId),
      ),
    );
}

/**
 * On send, when the owner says the revision deals with them: the open requests
 * are accepted in this revision (changes made by hand, FR-MSG-05).
 */
export function acceptOpenIn(
  db: Db,
  entity: ThreadEntity,
  entityId: string,
  revisionId: string,
  revisionNo: number,
) {
  return db
    .update(cr)
    .set({
      status: "accepted",
      resolutionNote: `Changed in revision ${revisionNo}`,
      resolvedAt: new Date().toISOString(),
      resolvedInRevisionId: revisionId,
    })
    .where(and(sql`${cr.conversationId} = ${conversationIdSql(entity, entityId)}`, eq(cr.status, "open")));
}

/** On discarding a revision: its accepted requests go back to open, as nothing was sent. */
export function reopenAccepted(db: Db, entity: ThreadEntity, entityId: string) {
  return db
    .update(cr)
    .set({ status: "open", resolutionNote: null, resolvedAt: null })
    .where(
      and(
        sql`${cr.conversationId} = ${conversationIdSql(entity, entityId)}`,
        eq(cr.status, "accepted"),
        isNull(cr.resolvedInRevisionId),
      ),
    );
}

export interface ThreadRequest {
  id: string;
  kind: ChangeKind;
  lineRef: string;
  lineLabel: string | null;
  proposedQtyMilli: number | null;
  status: ChangeStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  revisionId: string;
  resolvedInRevisionId: string | null;
}

export interface ThreadMessage {
  id: string;
  /** `client`, or the team member who wrote it. */
  from: "client" | "team";
  /** The client's typed name, or the team member's name. */
  authorName: string;
  body: string;
  createdAt: string;
  hidden: boolean;
  revisionId: string | null;
  request: ThreadRequest | null;
}

/**
 * Messages in order with the change request each one raised. The portal never
 * gets hidden messages (FR-MSG-10); the app gets them flagged.
 */
export async function threadMessages(
  db: Db,
  conversationId: string,
  opts: { includeHidden: boolean },
): Promise<ThreadMessage[]> {
  const m = schema.message;
  const [messages, requests] = await Promise.all([
    db
      .select({
        id: m.id,
        author: m.author,
        clientName: m.clientName,
        body: m.body,
        createdAt: m.createdAt,
        hiddenAt: m.hiddenAt,
        revisionId: m.revisionId,
        userName: schema.user.name,
      })
      .from(m)
      // author is `owner:<user id>` or `staff:<user id>` for the team.
      .leftJoin(schema.user, sql`${schema.user.id} = substr(${m.author}, instr(${m.author}, ':') + 1)`)
      .where(and(eq(m.conversationId, conversationId), opts.includeHidden ? undefined : isNull(m.hiddenAt)))
      .orderBy(asc(m.createdAt), asc(m.id)),
    db.select().from(cr).where(eq(cr.conversationId, conversationId)),
  ]);
  const byMessage = new Map(requests.map((r) => [r.messageId, r]));
  return messages.map((row) => {
    const r = byMessage.get(row.id);
    return {
      id: row.id,
      from: row.author === "client" ? "client" : "team",
      authorName: row.author === "client" ? (row.clientName ?? "Client") : (row.userName ?? "Team"),
      body: row.body,
      createdAt: row.createdAt,
      hidden: row.hiddenAt !== null,
      revisionId: row.revisionId,
      request: r
        ? {
            id: r.id,
            kind: r.kind,
            lineRef: r.lineRef,
            lineLabel: r.lineLabel,
            proposedQtyMilli: r.proposedQtyMilli,
            status: r.status,
            resolutionNote: r.resolutionNote,
            resolvedAt: r.resolvedAt,
            revisionId: r.revisionId,
            resolvedInRevisionId: r.resolvedInRevisionId,
          }
        : null,
    };
  });
}

/** Open requests per line of a revision, for the coloured markers on the document (FR-MSG-03). */
export function openLineRefs(messages: ThreadMessage[]): string[] {
  return [
    ...new Set(messages.flatMap((msg) => (msg.request?.status === "open" ? [msg.request.lineRef] : []))),
  ];
}

export async function requestsByIds(db: Db, conversationId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(cr)
    .where(and(eq(cr.conversationId, conversationId), inArray(cr.id, ids)));
}
