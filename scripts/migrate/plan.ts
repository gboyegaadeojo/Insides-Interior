// SPEC 12.1 steps 4–5: merge the exports, drop demo records, transform, and
// write the import plan for review before anything is loaded.
//
//   npx tsx scripts/migrate/plan.ts migration-data/firestore.json migration-data/insides-browser-export-*.json
//
// Writes migration-data/plan.json and prints counts and warnings.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { planSchema } from "~/features/migration/schema";
import { buildPlan, type LegacyExport, mergeExports } from "./transform";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Pass the export files: firestore.json and each browser export.");
  process.exit(1);
}
const exports = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as LegacyExport);
const merged = mergeExports(exports);
const plan = planSchema.parse(buildPlan(merged));

console.table(merged.counts);
console.log(
  `Plan: ${plan.clients.length} clients, ${plan.items.length} items, ${plan.quotes.length} quotes, ` +
    `${plan.invoices.length} invoices, ${plan.payments.length} payments, ${plan.expenses.length} expenses`,
);
for (const w of plan.warnings) console.warn(`! ${w}`);
const out = join(dirname(files[0]!), "plan.json");
writeFileSync(out, JSON.stringify(plan, null, 2));
console.log(`Wrote ${out}. Review it, then run scripts/migrate/import.ts.`);
