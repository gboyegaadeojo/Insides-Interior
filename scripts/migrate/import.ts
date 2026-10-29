// SPEC 12.1 steps 6–9: load the plan through the services and print the
// reconciliation report (counts, totals that changed, outstanding per client).
//
//   npx tsx scripts/migrate/import.ts migration-data/plan.json --local
//   npx tsx scripts/migrate/import.ts migration-data/plan.json --remote --env preview
//   npx tsx scripts/migrate/import.ts migration-data/plan.json --remote --yes      (production)
//
// Safe to re-run: records already imported are skipped. Nothing is emailed.
// Writes import-report.json and client-balances.csv next to the plan.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import { formatCents } from "~/domain/money";
import { importPlan } from "~/features/migration/service";
import { csvMoney, toCsv } from "~/lib/csv";
import { getDb, schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import { bindings } from "./platform";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    local: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    env: { type: "string" },
    "owner-email": { type: "string" },
    receipts: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const planPath = positionals[0];
if (!planPath || !existsSync(planPath) || values.local === values.remote) {
  console.error(
    "Usage: import.ts <plan.json> --local | --remote [--env preview] [--owner-email you@…] [--yes]",
  );
  process.exit(1);
}
if (values.remote && !values.env && !values.yes) {
  console.error("This writes to PRODUCTION. Run it on preview first, then add --yes.");
  process.exit(1);
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};
const receiptsDir = values.receipts ?? join(dirname(planPath), "receipts");

const { env, dispose, database } = await bindings({ remote: values.remote, env: values.env });
try {
  const db = getDb(env as Env);
  const owners = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.role, "owner"), isNull(schema.user.disabledAt)));
  const owner = values["owner-email"] ? owners.find((u) => u.email === values["owner-email"]) : owners[0];
  if (!owner?.businessId) throw new Error("No active owner found; seed the database or pass --owner-email");
  const ctx = {
    env: env as Env,
    db,
    user: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: "owner",
      businessId: owner.businessId,
      sessionId: "migration",
    },
  } satisfies RequestContext;
  console.log(`Importing into ${database} (${values.remote ? "remote" : "local"}) as ${owner.email}…`);

  const report = await importPlan(ctx, JSON.parse(readFileSync(planPath, "utf8")), {
    receipt: async (expense) => {
      const dir = join(receiptsDir, expense.legacyId);
      if (!existsSync(dir)) return null;
      const [file] = readdirSync(dir);
      if (!file) return null;
      const type = TYPES[extname(file).toLowerCase()];
      return type ? { bytes: new Uint8Array(readFileSync(join(dir, file))), type } : null;
    },
  });

  console.table(report.counts);
  const changed = report.totals.filter((t) => t.legacyCents !== null && t.legacyCents !== t.newCents);
  if (changed.length) {
    console.log("Totals that differ from the old app (it summed floats; review each):");
    console.table(
      changed.map((t) => ({
        document: `${t.kind} ${t.number ?? "(draft)"}`,
        old: formatCents(t.legacyCents ?? 0),
        new: formatCents(t.newCents),
      })),
    );
  }
  console.log("Outstanding per client (for the owner's sign-off):");
  console.table(
    report.clients.map((c) => ({
      client: c.name,
      old: formatCents(c.legacyOutstandingCents),
      new: formatCents(c.newOutstandingCents),
      match: c.legacyOutstandingCents === c.newOutstandingCents ? "yes" : "CHECK",
    })),
  );
  console.table(report.sequences);
  for (const w of report.warnings) console.warn(`! ${w}`);

  const dir = dirname(planPath);
  writeFileSync(join(dir, "import-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(dir, "client-balances.csv"),
    toCsv(
      ["Client", "Outstanding in the old app (NGN)", "Outstanding now (NGN)", "Matches"],
      report.clients.map((c) => [
        c.name,
        csvMoney(c.legacyOutstandingCents),
        csvMoney(c.newOutstandingCents),
        c.legacyOutstandingCents === c.newOutstandingCents ? "Yes" : "No",
      ]),
    ),
  );
  console.log(`Wrote ${join(dir, "import-report.json")} and client-balances.csv`);
} finally {
  await dispose();
}
