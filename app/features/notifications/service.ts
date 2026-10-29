// In-app notifications (SPEC 5.12 FR-SYS-02): quote viewed, approved, changes
// requested, new message, invoice viewed, email bounced. One row per owner;
// the bell in the top bar shows the unread count and the latest ones.

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { activeOwners } from "~/features/email/service";
import { type Db, schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import { newId } from "~/lib/ids";

type Ctx = Pick<RequestContext, "db" | "user">;

const n = schema.notification;

/** Insert statements telling every active owner (for the caller's batch). */
export async function ownerNotices(
  db: Db,
  businessId: string,
  notice: { type: string; entityType: string; entityId: string; title: string },
) {
  const owners = await activeOwners(db, businessId);
  return owners.map((owner) => db.insert(n).values({ id: newId("ntf"), userId: owner.id, ...notice }));
}

/** Where a notification opens. */
function hrefOf(entityType: string | null, entityId: string | null, type: string) {
  if (!entityId) return "/";
  if (entityType === "quote" || entityType === "invoice") {
    const conversation = /changes_requested|message/.test(type) ? "#conversation" : "";
    return `/${entityType}s/${entityId}${conversation}`;
  }
  if (entityType === "client") return `/clients/${entityId}`;
  if (entityType === "project") return `/projects/${entityId}`;
  return "/";
}

/** The latest notifications for the signed-in user, newest first. */
export async function listNotifications(ctx: Ctx, limit = 20) {
  const rows = await ctx.db
    .select()
    .from(n)
    .where(eq(n.userId, ctx.user.id))
    .orderBy(desc(n.createdAt), desc(n.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    href: hrefOf(r.entityType, r.entityId, r.type),
    createdAt: r.createdAt,
    read: r.readAt !== null,
  }));
}

export type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];

/** Unread count for the badge (one indexed count on user_id, read_at). */
export async function unreadNotifications(ctx: Ctx) {
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(n)
    .where(and(eq(n.userId, ctx.user.id), isNull(n.readAt)));
  return row?.count ?? 0;
}

/** Marks some (or all) of the user's notifications read. Only their own. */
export async function markNotificationsRead(ctx: Ctx, ids: string[] | "all") {
  const mine = and(eq(n.userId, ctx.user.id), isNull(n.readAt));
  await ctx.db
    .update(n)
    .set({ readAt: new Date().toISOString() })
    .where(ids === "all" ? mine : and(mine, inArray(n.id, ids.slice(0, 100))));
}
