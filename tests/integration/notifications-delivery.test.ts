import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deliverNotifications, savePushSubscription } from "~/features/notifications/service";
import { newId } from "~/lib/ids";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed, testEnv } from "./helpers";

beforeEach(seed);

async function notify(type: string, title: string) {
  const id = newId("ntf");
  await ownerContext().db.insert(schema.notification).values({
    id,
    userId: SEED_IDS.owner,
    type,
    entityType: "quote",
    entityId: "qte_x",
    title,
  });
  return id;
}

describe("notification delivery (owner request: always email, push alerts)", () => {
  it("emails the owner for events with no email of their own, once, and marks them delivered", async () => {
    const db = ownerContext().db;
    const viewed = await notify("quote.viewed", "Ada opened quote Q-1001");
    const approved = await notify("quote.approved", "Ada approved Q-1001");
    await deliverNotifications(testEnv);

    const emails = await db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.template, "owner_alert"));
    expect(emails.filter((e) => e.subject === "Ada opened quote Q-1001")).toHaveLength(1);
    // Approvals already email the owner where they happen; no second email here.
    expect(emails.some((e) => e.subject === "Ada approved Q-1001")).toBe(false);
    for (const id of [viewed, approved]) {
      const [row] = await db.select().from(schema.notification).where(eq(schema.notification.id, id));
      expect(row?.deliveredAt).toBeTruthy();
    }

    await deliverNotifications(testEnv);
    const again = await db
      .select()
      .from(schema.emailMessage)
      .where(
        and(
          eq(schema.emailMessage.template, "owner_alert"),
          eq(schema.emailMessage.subject, "Ada opened quote Q-1001"),
        ),
      );
    expect(again).toHaveLength(1);
  });

  it("keeps one subscription per device and moves it to whoever signs in there", async () => {
    const ctx = ownerContext();
    const device = {
      endpoint: "https://push.example/abc",
      p256dh: "k".repeat(87),
      auth: "a".repeat(22),
      userAgent: "iPhone",
    };
    await savePushSubscription(ctx, device);
    await savePushSubscription(ctx, { ...device, auth: "b".repeat(22) });
    const rows = await ctx.db
      .select()
      .from(schema.pushSubscription)
      .where(eq(schema.pushSubscription.endpoint, device.endpoint));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.auth).toBe("b".repeat(22));
  });
});
