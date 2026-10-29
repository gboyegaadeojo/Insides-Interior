import { expect, type Page, test } from "@playwright/test";

/** Below tablet landscape (1024px) the section replaces the list and has a Back link. */
function isNarrow(page: Page) {
  return (page.viewportSize()?.width ?? 1440) < 1024;
}

async function openSection(page: Page, label: string) {
  await page.goto("/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: new RegExp(`^${label}`) })
    .click();
  if (isNarrow(page)) await expect(page.getByRole("link", { name: "Settings" }).first()).toBeVisible();
}

test("settings lists every group for the owner (FR-SET-11)", async ({ page }) => {
  await page.goto("/settings");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  for (const label of [
    "Business",
    "Branding",
    "Tax and currency",
    "Documents",
    "Email",
    "Reminders",
    "Team",
    "Account",
    "Appearance",
    "Data",
  ]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
});

test("business details save and show inline errors", async ({ page }) => {
  await openSection(page, "Business");
  // Server-side validation shows next to the field (DS-TCH-06) and keeps what was typed.
  const postal = page.getByLabel("Postcode (optional)");
  await postal.fill("101233 LEKKI 1");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Use 12 characters or fewer")).toBeVisible();
  await expect(postal).toHaveValue("101233 LEKKI 1");
  await postal.fill("101233");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Business details saved")).toBeVisible();
});

test("numbering previews the next number and refuses to go down (FR-SET-04)", async ({ page }) => {
  await openSection(page, "Documents");
  const next = page.getByLabel("Next quote number");
  const current = Number(await next.inputValue());
  await next.fill(String(current - 1));
  await expect(page.getByText(new RegExp(`Next quote: Q-${current - 1}`))).toBeVisible();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText(/can only go up/)).toBeVisible();
});

test("brand colour checks contrast and suggests a darker shade (FR-SET-09)", async ({ page }) => {
  await openSection(page, "Branding");
  const hex = page.getByLabel("Hex");
  await hex.fill("#F2C94C");
  await expect(page.getByText(/below 4.5:1/)).toBeVisible();
  await page.getByRole("button", { name: /^Use #/ }).click();
  await expect(page.getByText(/Passes WCAG AA/)).toBeVisible();
});

test("email template preview fills merge fields (FR-SET-07)", async ({ page }) => {
  await openSection(page, "Email");
  await page.getByLabel("Subject").fill("Hello {client.firstName} about {quote.number} {oops}");
  await expect(page.getByText("Hello Amaka about Q-1042 {oops}")).toBeVisible();
  await expect(page.getByText(/Not recognised: \{oops\}/)).toBeVisible();
});

test("unsaved changes warn before leaving (FR-SET-11)", async ({ page }) => {
  await openSection(page, "Reminders");
  await page.getByLabel("Maximum reminders per invoice").fill("3");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.goto("/settings/reminders");
  // A full reload isn't blocked; an in-app navigation is.
  await page.getByLabel("Maximum reminders per invoice").fill("2");
  const link = isNarrow(page)
    ? page.getByRole("link", { name: "Settings" }).first()
    : page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Team/ });
  await link.click();
  await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Maximum reminders per invoice")).toHaveValue("2");
});

test("account lists this device (FR-AUTH-05)", async ({ page }) => {
  await openSection(page, "Account");
  await expect(page.getByText("This device")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
});
