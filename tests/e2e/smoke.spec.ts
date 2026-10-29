import { expect, test } from "@playwright/test";

test("home renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  // Setup steps show only on a brand-new account; the figures always do.
  await expect(page.getByRole("region", { name: "Key figures" })).toBeVisible();
});

test("health reports ok", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", checks: { db: "ok" } });
});

test("PWA manifest and icons are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body).toMatchObject({ display: "standalone", short_name: "Insides" });
  for (const icon of body.icons as { src: string }[]) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
});

test("pages carry a strict CSP and nothing on them is blocked by it (SPEC 11.1)", async ({ page }) => {
  const blocked: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) blocked.push(m.text());
  });
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["referrer-policy"]).toBe("same-origin");
  for (const path of ["/quotes", "/expenses", "/reports", "/design"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  // Interactivity proves the nonce'd scripts ran.
  await page.goto("/reports");
  await expect(async () => {
    await page.getByRole("radiogroup", { name: "Report" }).getByRole("radio", { name: "VAT" }).click();
    await expect(page).toHaveURL(/report=tax/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  expect(blocked).toEqual([]);
});

test("API and file responses carry the baseline security headers", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
});
