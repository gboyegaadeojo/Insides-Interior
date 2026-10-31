import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkBackups } from "~/features/automation/service";
import { addDays, businessToday } from "~/lib/dates";
import { getDb, schema } from "~/server/db";
import { seed, testEnv } from "./helpers";

beforeEach(seed);

const today = businessToday();

describe("backup freshness check (SPEC 11.3)", () => {
  it("spots an old nightly backup without telling the owners (owner request)", async () => {
    for (const o of (await testEnv.BACKUPS.list({ prefix: "daily/" })).objects)
      await testEnv.BACKUPS.delete(o.key);
    const notices = () =>
      getDb(testEnv)
        .select({ id: schema.notification.id })
        .from(schema.notification)
        .where(eq(schema.notification.type, "backup_stale"));

    await testEnv.BACKUPS.put(`daily/${addDays(today, -5)}.sql.gz`, "old");
    expect(await checkBackups(testEnv, today)).toBe(true);
    expect(await notices()).toHaveLength(0);

    await testEnv.BACKUPS.put(`daily/${today}.sql.gz`, "fresh");
    expect(await checkBackups(testEnv, today)).toBe(false);
  });
});
