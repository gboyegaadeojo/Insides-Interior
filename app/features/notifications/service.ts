// In-app notifications (SPEC 5.12 FR-SYS-02): quote viewed, approved, changes
// requested, new message, invoice viewed, email bounced. One row per owner;
// the bell in the top bar shows the unread count and the latest ones.

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { activeOwners, emailInsert, type EmailJob, enqueue } from "~/features/email/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { type Db, getDb, schema } from "~/server/db";
import { ownerAlertEmail } from "~/server/email/templates";
import { sendPush } from "~/server/push";
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

// ---------- Delivery: push alerts and owner emails (owner request) ----------

/**
 * Notification types that have no email of their own. Approvals, change
 * requests, messages and bounces already email the owner where they happen.
 */
const EMAIL_TYPES = new Set(["quote.viewed", "invoice.viewed", "invoice.drafted", "backup_stale"]);

/** Ask the queue to deliver new notifications (push + email). Call after the batch that made them. */
export function notifyOwners(env: Pick<Env, "JOBS">) {
  return enqueue(env, [{ kind: "notify" }]);
}

/**
 * Delivers notifications not yet delivered (the last two days): a push alert
 * to each of the owner's devices, and for EMAIL_TYPES an email. Each row is
 * claimed first (delivered_at), so a repeat or a parallel run sends nothing twice.
 */
export async function deliverNotifications(env: Env) {
  const db = getDb(env);
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const pending = await db
    .select({
      id: n.id,
      type: n.type,
      title: n.title,
      entityType: n.entityType,
      entityId: n.entityId,
      userId: n.userId,
      email: schema.user.email,
      businessId: schema.user.businessId,
      disabledAt: schema.user.disabledAt,
    })
    .from(n)
    .innerJoin(schema.user, eq(schema.user.id, n.userId))
    .where(and(isNull(n.deliveredAt), gt(n.createdAt, since)))
    .orderBy(n.createdAt)
    .limit(50);
  const jobs: EmailJob[] = [];
  const brands = new Map<string, Awaited<ReturnType<typeof loadEmailBrand>>>();
  let pushed = 0;
  for (const row of pending) {
    const claimed = await db
      .update(n)
      .set({ deliveredAt: new Date().toISOString() })
      .where(and(eq(n.id, row.id), isNull(n.deliveredAt)))
      .returning({ id: n.id });
    if (claimed.length === 0 || row.disabledAt) continue;
    const path = hrefOf(row.entityType, row.entityId, row.type);
    const subscriptions = await db
      .select()
      .from(schema.pushSubscription)
      .where(eq(schema.pushSubscription.userId, row.userId));
    for (const sub of subscriptions) {
      const result = await sendPush(env, sub, { title: row.title, url: path, tag: row.id });
      if (result === "sent") pushed++;
      if (result === "gone")
        await db.delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, sub.id));
    }
    if (EMAIL_TYPES.has(row.type) && row.email && row.businessId) {
      let brand = brands.get(row.businessId);
      if (!brand) {
        brand = await loadEmailBrand(db, env, row.businessId);
        brands.set(row.businessId, brand);
      }
      const message = {
        ...ownerAlertEmail(brand, { title: row.title, url: new URL(path, env.APP_URL).toString() }),
        to: [row.email],
        idempotencyKey: `notify:${row.id}`,
      };
      const email = emailInsert(db, {
        businessId: row.businessId,
        entityType: row.entityType ?? "notification",
        entityId: row.entityId ?? row.id,
        template: "owner_alert",
        message,
      });
      await db.batch([email.insert]);
      jobs.push({ kind: "email", emailId: email.id, businessId: row.businessId, message });
    }
  }
  await enqueue(env, jobs);
  return { delivered: pending.length, pushed, emailed: jobs.length };
}

// ---------- Devices (Web Push subscriptions) ----------

export async function savePushSubscription(
  ctx: Ctx,
  input: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
) {
  await ctx.db
    .insert(schema.pushSubscription)
    .values({ id: newId("psh"), userId: ctx.user.id, ...input })
    .onConflictDoUpdate({
      target: schema.pushSubscription.endpoint,
      set: { userId: ctx.user.id, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent },
    });
}

export async function removePushSubscription(ctx: Ctx, endpoint: string) {
  await ctx.db
    .delete(schema.pushSubscription)
    .where(
      and(eq(schema.pushSubscription.userId, ctx.user.id), eq(schema.pushSubscription.endpoint, endpoint)),
    );
}

export async function pushDevices(ctx: Ctx) {
  return ctx.db
    .select({ endpoint: schema.pushSubscription.endpoint, userAgent: schema.pushSubscription.userAgent })
    .from(schema.pushSubscription)
    .where(eq(schema.pushSubscription.userId, ctx.user.id));
}

/** A test alert to the signed-in user's devices (Settings → Notifications). */
export async function sendTestAlert(ctx: Ctx & { env: Env }) {
  await ctx.db.insert(n).values({
    id: newId("ntf"),
    userId: ctx.user.id,
    type: "test",
    title: "Alerts are on. You'll hear about approvals, messages and payments here.",
  });
  await notifyOwners(ctx.env);
}
