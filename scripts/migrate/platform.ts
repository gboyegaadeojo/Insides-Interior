// Bindings for the migration scripts: the app's D1 and R2, local (the same
// state `npm run dev` uses) or remote (production, or `--env preview`), via
// wrangler's platform proxy. The app's services then run in Node unchanged.

import { rmSync, writeFileSync } from "node:fs";
import { getPlatformProxy, unstable_readConfig } from "wrangler";

export async function bindings(opts: { remote: boolean; env?: string }) {
  const config = unstable_readConfig({ config: "wrangler.jsonc", env: opts.env });
  const db = config.d1_databases.find((d: { binding: string }) => d.binding === "DB");
  const files = config.r2_buckets.find((b: { binding: string }) => b.binding === "FILES");
  if (!db || !files) throw new Error("wrangler.jsonc has no DB or FILES binding");
  // A throwaway config with only what the import needs, marked remote when asked.
  const path = `wrangler.migrate.${process.pid}.json`;
  writeFileSync(
    path,
    JSON.stringify({
      name: "insides-migrate",
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
      d1_databases: [{ ...db, remote: opts.remote }],
      r2_buckets: [{ ...files, remote: opts.remote }],
    }),
  );
  try {
    const proxy = await getPlatformProxy<Pick<Env, "DB" | "FILES">>({ configPath: path });
    return { env: proxy.env, dispose: proxy.dispose, database: db.database_name };
  } finally {
    rmSync(path, { force: true });
  }
}
