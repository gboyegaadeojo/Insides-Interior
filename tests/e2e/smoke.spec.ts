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
