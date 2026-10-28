import { expect, type Page, test } from "@playwright/test";

const PHONES = ["iPhone 14", "Pixel 7"];

function isPhone(name: string) {
  return PHONES.includes(name);
}

/** The visible main navigation (rail on tablet/desktop, tab bar on phone). */
function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

test("navigation matches the device class (SPEC 6.1)", async ({ page }, testInfo) => {
  await page.goto("/");
  const nav = mainNav(page);
  await expect(nav).toHaveCount(1);
  if (isPhone(testInfo.project.name)) {
    // Tab bar: Home, Quotes, + New, Invoices, More.
    await expect(nav.getByRole("link")).toHaveText(["Home", "Quotes", "Invoices", "More"]);
    await expect(nav.getByRole("button", { name: "New" })).toBeVisible();
  } else {
    await expect(nav.getByRole("link", { name: "Clients" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  }
  // No horizontal page scroll at any width (DS-PLT small phone rule).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("navigating sets the page title and the selected item", async ({ page }, testInfo) => {
  await page.goto("/");
  await mainNav(page).getByRole("link", { name: "Quotes" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quotes" })).toBeVisible();
  await expect(mainNav(page).getByRole("link", { name: "Quotes" })).toHaveAttribute("aria-current", "page");

  if (isPhone(testInfo.project.name)) {
    await mainNav(page).getByRole("link", { name: "More" }).click();
    await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  }
});

test("+ New opens the create sheet with colourful tiles (DS-NAV-02)", async ({ page }) => {
  await page.goto("/");
  // Keyboard open: Safari doesn't focus buttons on tap, so there is nothing to restore then.
  await mainNav(page).getByRole("button", { name: "New" }).focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Create" });
  await expect(sheet).toBeVisible();
  for (const tile of ["New quote", "New invoice", "Record payment", "Log expense", "New client"]) {
    await expect(sheet.getByRole("link", { name: new RegExp(tile) })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Focus returns to the trigger (DS-A11Y).
  await expect(mainNav(page).getByRole("button", { name: "New" })).toBeFocused();
});

test("command palette opens from search and with Ctrl+K (DS-NAV-06)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("catal");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/catalogue$/);

  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("appearance setting switches theme and survives a reload", async ({ page }) => {
  await page.goto("/settings");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/preferences") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await saved;
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^System/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
});

test("theme-color follows the module (DS-PLT-04)", async ({ page }) => {
  await page.goto("/quotes");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#F5EBF3");
  await page.goto("/invoices");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#ECEEFC");
});
