import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points the suite at a deployed preview (CI). Without it, the
// suite builds the app and runs it locally with `vite preview` (workerd),
// using the local D1 seeded by `npm run db:seed:local` and `--e2e`.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";

// Locally the sign-in helper's secret comes from .dev.vars.
if (!process.env.E2E_SECRET && existsSync(".dev.vars")) {
  const match = /^E2E_SECRET=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"));
  if (match?.[1]) process.env.E2E_SECRET = match[1].trim();
}

const OWNER_STATE = "tests/e2e/.auth/owner.json";

const DEVICES = [
  { name: "iPad Pro 11 landscape", use: { ...devices["iPad Pro 11 landscape"] } },
  { name: "iPad Mini portrait", use: { ...devices["iPad Mini"] } },
  { name: "iPhone 14", use: { ...devices["iPhone 14"] } },
  { name: "Pixel 7", use: { ...devices["Pixel 7"] } },
  {
    name: "Desktop Chrome 1440",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  },
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    ...DEVICES.map((d) => ({
      ...d,
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { ...d.use, storageState: OWNER_STATE },
    })),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run preview -- --port 4173 --strictPort",
        url: "http://localhost:4173/health",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
