import { defineConfig } from "drizzle-kit";

// drizzle-kit only generates SQL here; Wrangler applies it to D1
// (npm run db:migrate:local / db:migrate:remote).
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/server/db/schema.ts",
  out: "./app/server/db/migrations",
});
