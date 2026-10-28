import { env } from "cloudflare:workers";
import { getDb } from "~/server/db";
import { SEED_IDS, seedStatements } from "~/server/db/seed-sql";
import type { RequestContext } from "~/server/session";

export const testEnv = env as unknown as Env;

export const OWNER_EMAIL = "owner@example.com";

export async function seed() {
  for (const statement of seedStatements({
    ownerEmail: OWNER_EMAIL,
    ownerName: "Owner Example",
    e2e: true,
  })) {
    await testEnv.DB.prepare(statement).run();
  }
}

export function ownerContext(): RequestContext {
  return {
    env: testEnv,
    db: getDb(testEnv),
    user: {
      id: SEED_IDS.owner,
      name: "Owner Example",
      email: OWNER_EMAIL,
      role: "owner",
      businessId: SEED_IDS.business,
      sessionId: "test",
    },
  };
}

export function appRequest(path = "/", init?: RequestInit) {
  return new Request(new URL(path, testEnv.APP_URL), init);
}
