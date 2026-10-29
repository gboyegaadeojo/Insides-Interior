import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = { "~": fileURLToPath(new URL("./app", import.meta.url)) };

export default defineConfig({
  test: {
    // SPEC 13: 100% line coverage on app/domain (money, tax, numbering, lifecycle).
    coverage: {
      provider: "istanbul",
      include: ["app/domain/**/*.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 100, functions: 100 },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        plugins: [
          cloudflareTest(async () => ({
            // Bindings come from wrangler.jsonc; Miniflare runs them locally.
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                // Secrets the Worker expects (see .dev.vars.example); test-only values.
                APP_ENV: "test",
                BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
                RESEND_API_KEY: "",
                GOOGLE_CLIENT_ID: "",
                GOOGLE_CLIENT_SECRET: "",
                E2E_SECRET: "",
                RESEND_WEBHOOK_SECRET: "whsec_aW50ZWdyYXRpb24tdGVzdC13ZWJob29rLXNlY3JldA==",
                TEST_MIGRATIONS: await readD1Migrations(
                  fileURLToPath(new URL("./app/server/db/migrations", import.meta.url)),
                ),
              },
            },
          })),
        ],
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/apply-migrations.ts"],
        },
      },
    ],
  },
});
