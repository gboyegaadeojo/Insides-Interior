import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = { "~": fileURLToPath(new URL("./app", import.meta.url)) };

export default defineConfig({
  test: {
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
