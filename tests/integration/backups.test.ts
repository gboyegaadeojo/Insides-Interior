import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkBackups } from "~/features/automation/service";
import { addDays, businessToday } from "~/lib/dates";
import { getDb, schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { seed, testEnv } from "./helpers";

beforeEach(seed);

const today = businessToday();

async function notices() {
  return getDb(testEnv)
    .select({ title: schema.notification.title })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, SEED_IDS.owner), eq(schema.notification.type, "backup_stale")));
}

describe("backup freshness check (SPEC 11.3)", () => {
  it("tells the owners when the newest nightly backup is too old, and is quiet when it's fresh", async () => {
    const db = getDb(testEnv);
    for (const o of (await testEnv.BACKUPS.list({ prefix: "daily/" })).objects)
      await testEnv.BACKUPS.delete(o.key);

    await testEnv.BACKUPS.put(`daily/${addDays(today, -5)}.sql.gz`, "old");
    const before = (await notices()).length;
    expect(await checkBackups(testEnv, db, today)).toBe(true);
    const after = await notices();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)?.title).toContain("Backups have stopped");

    await testEnv.BACKUPS.put(`daily/${today}.sql.gz`, "fresh");
    expect(await checkBackups(testEnv, db, today)).toBe(false);
    expect((await notices()).length).toBe(before + 1);
  });
});
