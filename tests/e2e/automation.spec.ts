import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

// SPEC 14.1 phase 8 in the UI: the command palette finds records and runs
// actions; the bell shows a client's first look at an invoice; an invoice's
// automatic reminders can be paused (with a badge in the list) and a reminder
// sent by hand once a day. The jobs themselves are covered by
// tests/integration/automation.test.ts. Run on every device.

test.use({ actionTimeout: 15_000 });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`);
}

/** Attached to the report; also written to SHOTS_DIR when set, for a design review. */
async function shot(page: Page, name: string) {
  const file = `${name}-${test.info().project.name.replaceAll(" ", "-")}.png`;
  const dir = process.env.SHOTS_DIR;
  const body = await page.screenshot({ path: dir ? `${dir}/${file}` : undefined });
  await test.info().attach(file, { body, contentType: "image/png" });
}

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function openPalette(page: Page) {
  await page.getByRole("button", { name: "Search" }).click();
  return page.getByRole("dialog", { name: "Search and commands" });
}

async function clientPage(browser: Browser) {
  const { storageState: _owner, ...device } = test.info().project.use;
  const context = await browser.newContext({ ...device, storageState: undefined });
  return context.newPage();
}

test("the command palette creates a client and finds it again (FR-SYS-01)", async ({ page }) => {
  test.setTimeout(90_000);
  const name = `Palette Client ${unique()}`;
  await page.goto("/");
  let palette = await openPalette(page);
  await palette.getByRole("combobox").fill("new client");
  await palette.getByRole("option", { name: "New client" }).click();
  const sheet = page.getByRole("dialog", { name: "New client" });
  await sheet.getByLabel("Name").first().fill(name);
  await sheet.getByRole("button", { name: "Save client" }).click();
  await expect(page).toHaveURL(/\/clients\/cli_/, { timeout: 15_000 });

  await page.goto("/");
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill(name.toLowerCase());
  const hit = palette.getByRole("option", { name: new RegExp(name) });
  await expect(hit).toBeVisible({ timeout: 10_000 });
  await expect(palette.getByRole("group", { name: "Clients" })).toBeVisible();
  expect(await seriousViolations(page), "palette with results").toEqual([]);
  await shot(page, "palette");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/clients\/cli_/);
  // Phones show the profile in place of the list, so only one copy of the name is visible.
  await expect(page.getByText(name).locator("visible=true").first()).toBeVisible();

  // Destinations still filter on the device.
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("payments");
  await palette.getByRole("option", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/payments$/);
});

test("reminders pause with a badge, a reminder goes by hand once, and the bell shows the client's first look (FR-AUTO-02, FR-SYS-02)", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const clientName = `Reminder Client ${unique()}`;

  // A sent one-line invoice.
  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await expect(page).toHaveURL(/\/invoices\/inv_/);
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(clientName);
  await page.getByRole("option", { name: new RegExp(`Create “${clientName}”`) }).click();
  const newClient = page.getByRole("dialog", { name: "New client" });
  await newClient.getByLabel("Email").fill("reminders@example.ng");
  await newClient.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText(clientName);
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: "Add to the invoice" })
    .getByRole("button", { name: /Custom line/ })
    .click();
  const line = page
    .getByRole("listitem")
    .filter({ has: page.getByLabel("Description") })
    .first();
  await line.getByLabel("Description").fill("Blind fitting");
  const price = line.getByLabel("Price");
  await price.click();
  await price.fill("40000");
  await price.press("Tab");
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Send invoice" })
    .getByRole("button", { name: /^Send ₦/ })
    .click();
  await expect(page.getByText(/sent to reminders@example\.ng/)).toBeVisible({ timeout: 20_000 });
  const invoiceUrl = page.url();

  // FR-AUTO-02: pause, and the list says so.
  const reminders = page.getByTestId("reminders");
  await expect(reminders).toContainText("Reminders on");
  await reminders.getByRole("button", { name: "Pause reminders" }).click();
  await expect(reminders).toContainText("Reminders paused", { timeout: 15_000 });
  await reminders.scrollIntoViewIfNeeded();
  await shot(page, "reminders-paused");
  await page.goto("/invoices");
  await expect(
    page.getByRole("link", { name: new RegExp(clientName) }).filter({ hasText: "Reminders paused" }),
  ).toBeVisible();

  // A reminder by hand: once a day.
  await page.goto(invoiceUrl);
  await reminders.getByRole("button", { name: "Send a reminder now" }).click();
  await expect(page.getByText("Reminder sent to reminders@example.ng")).toBeVisible({ timeout: 15_000 });
  await reminders.getByRole("button", { name: "Send a reminder now" }).click();
  await expect(page.getByText("A reminder already went to the client today")).toBeVisible({
    timeout: 15_000,
  });
  await reminders.getByRole("button", { name: "Resume reminders" }).click();
  await expect(reminders).toContainText("Reminders on", { timeout: 15_000 });

  // The client opens the link; the owner's bell has it.
  const link = new URL(await page.getByLabel("Link").inputValue()).pathname;
  const payer = await clientPage(browser);
  await payer.goto(link);
  await expect(payer.getByTestId("portal-balance")).toBeVisible();
  await payer.context().close();

  await page.goto("/");
  const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const item = page.getByRole("link", { name: new RegExp(`${clientName} opened invoice`) });
  await expect(item).toBeVisible({ timeout: 10_000 });
  expect(await seriousViolations(page), "notifications").toEqual([]);
  await shot(page, "bell");
  await item.click();
  await expect(page).toHaveURL(new RegExp(new URL(invoiceUrl).pathname));
  await expect(page.getByText("Opened by the client").first()).toBeAttached();
});
