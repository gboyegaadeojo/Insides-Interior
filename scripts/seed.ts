// Seeds the one business (SPEC 14.4 phase 2): the business, settings, the owner
// from OWNER_EMAIL, GST 5% and MB PST 7%, and quote/invoice sequences. Safe to
// re-run: every insert is INSERT OR IGNORE on fixed ids.
//
//   npm run db:seed:local  -- --owner-email you@example.ca --owner-name "Your Name"
//   npm run db:seed:remote -- --owner-email …            (production)
//   node scripts/seed.ts --env preview --e2e              (CI previews: adds the E2E owner)
//
// Arguments fall back to the OWNER_EMAIL / OWNER_NAME environment variables.
// Runs wrangler through node directly, so paths with spaces work everywhere.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { seedStatements } from "../app/server/db/seed-sql.ts";

const { values } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    env: { type: "string" },
    "owner-email": { type: "string" },
    "owner-name": { type: "string" },
    "business-name": { type: "string" },
    e2e: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

/** Wrangler's JS entry point, run with this node (no shell, so spaces in paths are safe). */
function wranglerBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("wrangler/package.json");
  const pkg = require(pkgPath) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.wrangler!;
  return join(dirname(pkgPath), bin);
}

const ownerEmail = values["owner-email"] ?? process.env.OWNER_EMAIL;
const ownerName = values["owner-name"] ?? process.env.OWNER_NAME;
if (!ownerEmail && !values.e2e) {
  console.error("Give the owner's email: --owner-email you@example.ca (or set OWNER_EMAIL).");
  process.exit(1);
}

const sql =
  seedStatements({ ownerEmail, ownerName, businessName: values["business-name"], e2e: values.e2e })
    .map((s) => `${s};`)
    .join("\n") + "\n";

if (values["dry-run"]) {
  process.stdout.write(sql);
} else {
  const target = values.remote || values.env ? "--remote" : "--local";
  const envArgs = values.env ? ["--env", values.env] : [];
  const database = values.env === "preview" ? "insides_db_preview" : "insides_db";
  const dir = mkdtempSync(join(tmpdir(), "insides-seed-"));
  const file = join(dir, "seed.sql");
  writeFileSync(file, sql);
  try {
    execFileSync(
      process.execPath,
      [wranglerBin(), "d1", "execute", database, target, ...envArgs, "--file", file, "--yes"],
      {
        stdio: "inherit",
      },
    );
    console.log(
      `Seeded ${database} (${target.slice(2)})${ownerEmail ? ` with owner ${ownerEmail}` : ""}${values.e2e ? " and the E2E owner" : ""}.`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
