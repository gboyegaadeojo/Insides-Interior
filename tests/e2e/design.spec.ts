import { expect, test } from "@playwright/test";

// SPEC 14.4 phase 1: screenshots of /design on all five device projects, light
// and dark. Attached to the HTML report for review (docs/decisions.md explains
// why these are not pixel-diffed yet).
for (const theme of ["light", "dark"] as const) {
  test(`/design screenshot (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/design?theme=${theme}`);
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`design-${theme}-${testInfo.project.name}.png`, {
      body: shot,
      contentType: "image/png",
    });
  });
}

test("money and quantity fields store integers and re-format en-NG", async ({ page }) => {
  await page.goto("/design?theme=light");
  // Tap, type, then move on with Tab, the way a person leaves the field.
  const price = page.getByLabel("Unit price");
  await price.click();
  await price.fill("1234.5");
  await page.keyboard.press("Tab");
  await expect(price).toHaveValue("1,234.50");
  await expect(page.getByText("123450 cents")).toBeVisible();

  const qty = page.getByLabel("Quantity");
  await qty.click();
  await qty.fill("abc");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Enter a quantity with up to 3 decimals, like 4.5")).toBeVisible();
  await expect(qty).toHaveValue("abc");
});

test("combobox can create a client inline", async ({ page }) => {
  await page.goto("/design?theme=light");
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type("Priya Shah");
  await page.getByRole("option", { name: /Create “Priya Shah”/ }).click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText("Priya Shah");
});
