import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points the suite at a deployed preview (CI). Without it, the
// suite builds the app and runs it locally with `vite preview` (workerd).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "iPad Pro 11 landscape", use: { ...devices["iPad Pro 11 landscape"] } },
    { name: "iPad Mini portrait", use: { ...devices["iPad Mini"] } },
    { name: "iPhone 14", use: { ...devices["iPhone 14"] } },
    { name: "Pixel 7", use: { ...devices["Pixel 7"] } },
    {
      name: "Desktop Chrome 1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
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
