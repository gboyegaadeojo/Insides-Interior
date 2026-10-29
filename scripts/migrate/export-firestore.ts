// SPEC 12.1 step 2: dump the old app's Firestore collections to JSON, and its
// receipts from Firebase Storage, with the Admin SDK. Run on your computer.
//
//   npm install --no-save firebase-admin@13
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/service-account.json \
//     npx tsx scripts/migrate/export-firestore.ts --out migration-data
//
// The service account key must live outside this repository and is never
// committed (CLAUDE.md). migration-data/ is git-ignored.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { COLLECTIONS, type FirestoreExport, type LegacyRecord } from "./transform";

const { values } = parseArgs({
  options: { out: { type: "string", default: "migration-data" }, bucket: { type: "string" } },
});

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credentials || !existsSync(credentials)) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON (kept outside the repo).");
  process.exit(1);
}
if (resolve(credentials).startsWith(resolve("."))) {
  console.error(
    "The service account key is inside the repository. Move it elsewhere first; it must never be committed.",
  );
  process.exit(1);
}

/** The parts of firebase-admin used here (it's installed only for the export, not a dependency). */
interface Admin {
  initializeApp(o: { credential: unknown; storageBucket?: string }): {
    firestore(): {
      collection(name: string): { get(): Promise<{ size: number; docs: { id: string; data(): unknown }[] }> };
    };
    storage(): {
      bucket(): {
        getFiles(o: {
          prefix: string;
        }): Promise<[{ name: string; download(o: { destination: string }): Promise<unknown> }[]]>;
      };
    };
    delete(): Promise<void>;
  };
  credential: { applicationDefault(): unknown };
}
const SDK = "firebase-admin";
let admin: Admin;
try {
  admin = ((await import(SDK)) as { default: Admin }).default;
} catch {
  console.error("Install the Admin SDK first: npm install --no-save firebase-admin@13");
  process.exit(1);
}

const app = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: values.bucket,
});
const db = app.firestore();

/** Firestore Timestamps become ISO strings; everything else is plain JSON. */
function plain(value: unknown): unknown {
  if (value && typeof value === "object") {
    if ("toDate" in value && typeof (value as { toDate: unknown }).toDate === "function")
      return (value as { toDate: () => Date }).toDate().toISOString();
    if (Array.isArray(value)) return value.map(plain);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });
const dump: FirestoreExport = { source: "firestore", exportedAt: new Date().toISOString(), collections: {} };
for (const name of COLLECTIONS) {
  const snap = await db.collection(name).get();
  dump.collections[name] = snap.docs.map((d) => ({ ...(plain(d.data()) as LegacyRecord), id: d.id }));
  console.log(`${name}: ${snap.size}`);
}
writeFileSync(join(out, "firestore.json"), JSON.stringify(dump, null, 2));

// SPEC 12.1 step 9: receipts (receipts/<uid>/<expenseId>/<file>) to migration-data/receipts/<expenseId>/.
if (values.bucket) {
  const [files] = await app.storage().bucket().getFiles({ prefix: "receipts/" });
  for (const file of files) {
    const [, , expenseId, name] = file.name.split("/");
    if (!expenseId || !name) continue;
    const target = join(out, "receipts", expenseId, name);
    mkdirSync(dirname(target), { recursive: true });
    await file.download({ destination: target });
  }
  console.log(`receipts: ${files.length}`);
} else {
  console.log("No --bucket given (e.g. your-project.appspot.com), so receipts were not downloaded.");
}
console.log(`Wrote ${join(out, "firestore.json")}`);
await app.delete();
