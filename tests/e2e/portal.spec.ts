import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

// SPEC 14.1 phase 5 exit: a test client approves from a phone. The owner builds
// and sends a quote; a separate, signed-out browser on the same device opens
// the client link, chooses an option, approves and sees the celebration.

async function shot(page: Page, name: string) {
  await test.info().attach(`${name}-${test.info().project.name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`);
}

async function fillLine(line: Locator, values: { description: string; price: string }) {
  await line.getByLabel("Description").fill(values.description);
  const price = line.getByLabel("Price");
  await price.click();
  await price.fill(values.price);
  await price.press("Tab");
}

async function addCustomLine(page: Page) {
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: "Add to the quote" })
    .getByRole("button", { name: /Custom line/ })
    .click();
}

/** Builds a one-room quote (a sofa plus optional cushions) for a new client and sends it. */
async function buildAndSend(page: Page) {
  const client = `Portal Client ${Date.now().toString(36)}`;
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await expect(page).toHaveURL(/\/quotes\/qte_/);

  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(client);
  await page.getByRole("option", { name: new RegExp(`Create “${client}”`) }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await dialog.getByLabel("Email").fill("portal-client@example.ng");
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText(client);

  await page.getByLabel("Room name").first().fill("Living room");
  const lines = page.getByRole("list", { name: "Lines in Living room" }).getByRole("listitem");
  await addCustomLine(page);
  await fillLine(lines.nth(0), { description: "Three-seater sofa", price: "450000" });
  await addCustomLine(page);
  await fillLine(lines.nth(1), { description: "Scatter cushions", price: "25000" });
  await lines
    .nth(1)
    .getByRole("button", { name: /More options for Scatter cushions/ })
    .click();
  await lines
    .nth(1)
    .getByLabel(/Optional item/)
    .check();
  await expect(page.getByTestId("quote-total")).toHaveText("₦450,000.00");
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Send", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Send quote" });
  await expect(sheet.getByLabel("To")).toHaveValue("portal-client@example.ng");
  await expect(sheet.getByRole("region", { name: "Email preview" })).toContainText("₦450,000.00");
  await sheet.getByRole("button", { name: /^Send ₦450,000\.00/ }).click();

  // The sent view: a number, the status and the client link.
  await expect(page.getByText(/sent to portal-client@example\.ng/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
  const link = await page.getByLabel("Link").inputValue();
  expect(link).toMatch(/\/q\/[A-Za-z0-9_-]{43}$/);
  return { link: new URL(link).pathname, quoteUrl: page.url() };
}

/** A signed-out browser on the same device as the test project. */
async function clientPage(browser: Browser) {
  const { storageState: _owner, ...device } = test.info().project.use;
  const context = await browser.newContext({ ...device, storageState: undefined });
  return context.newPage();
}

test("a client opens the link on their device, chooses an option and approves (FR-QT-10)", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { link, quoteUrl } = await buildAndSend(page);

  const client = await clientPage(browser);
  await client.goto(link);
  await expect(client.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(client.getByText("Three-seater sofa").first()).toBeVisible();
  const bar = client.getByTestId("portal-total");
  await expect(bar).toContainText("Your selection");
  await expect(bar).toContainText("₦450,000.00");

  // SPEC 13: the portal meets WCAG 2.2 AA in light and dark.
  for (const colorScheme of ["light", "dark"] as const) {
    // Set before loading, as tests/e2e/a11y.spec.ts does: WebKit restyles a live page lazily.
    await client.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await client.reload();
    await expect(bar).toContainText("₦450,000.00");
    expect(await seriousViolations(client), colorScheme).toEqual([]);
  }

  // Options update the total live (FR-QT-03).
  await client.getByRole("checkbox", { name: /Scatter cushions/ }).check();
  await expect(bar).toContainText("₦475,000.00");
  await shot(client, "portal-open");

  await client.getByRole("button", { name: "Approve", exact: true }).click();
  const sheet = client.getByRole("dialog", { name: "Approve this quote" });
  await expect(sheet.getByLabel("Your full name")).toBeVisible();
  expect(await seriousViolations(client), "approve sheet").toEqual([]);
  // Agreeing without a name is refused by the browser; the server checks too.
  await sheet.getByLabel("Your full name").fill("Amaka Obi");
  await sheet.getByRole("checkbox", { name: /I approve quote/ }).check();
  await sheet.getByRole("button", { name: /^Approve ₦475,000\.00/ }).click();

  await expect(client.getByText(/Approved by Amaka Obi/)).toBeVisible({ timeout: 15_000 });
  await expect(client.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await shot(client, "portal-approved");

  // The owner sees the approval, the chosen total and the new project.
  await page.goto(quoteUrl);
  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
  await expect(page.getByText("₦475,000.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the project" })).toBeVisible();
  await expect(page.getByText("Approval notice").first()).toBeVisible();
  await client.context().close();
});

test("a client can ask for changes; the owner revises and the old link stops working (FR-QT-09)", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { link, quoteUrl } = await buildAndSend(page);

  const client = await clientPage(browser);
  await client.goto(link);
  await client.getByRole("button", { name: "Request changes" }).click();
  const sheet = client.getByRole("dialog", { name: "Request a change" });
  await sheet.getByRole("radio", { name: "Other" }).check();
  await sheet.getByLabel("What would you like to change?").fill("Could the sofa be in green velvet?");
  await sheet.getByRole("button", { name: "Send request" }).click();
  await expect(client.getByText("We've got your request")).toBeVisible({ timeout: 15_000 });

  await page.goto(quoteUrl);
  await expect(page.getByText("Changes requested").first()).toBeVisible();
  await page.getByRole("button", { name: "Revise" }).click();
  await expect(page.getByText(/Revising Q-\d+ \(rev 2\)/)).toBeVisible();

  // While the owner revises, the client sees a notice instead of Approve.
  await client.reload();
  await expect(client.getByText("We're updating this quote")).toBeVisible();

  await page.getByRole("button", { name: "Send revision" }).click();
  const send = page.getByRole("dialog", { name: "Send revision 2" });
  // The owner made the change by hand: sending says this revision deals with the request.
  await expect(send.getByRole("checkbox", { name: /deals with the 1 open request/ })).toBeChecked();
  await send.getByRole("button", { name: /^Send ₦/ }).click();
  await expect(page.getByText(/\(rev 2\) sent to/)).toBeVisible({ timeout: 15_000 });

  await client.reload();
  await expect(client.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  const newLink = new URL(await page.getByLabel("Link").inputValue()).pathname;
  await client.goto(newLink);
  await expect(client.getByText(/Revised \(rev 2\)/).first()).toBeVisible();
  await client.context().close();
});

test("unknown links explain themselves and the portal refuses other writes", async ({ page }) => {
  const fake = `/q/${"A".repeat(43)}`;
  const response = await page.goto(fake);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  const write = await page.request.post(fake, { form: { intent: "delete" } });
  expect(write.status()).toBe(400);
});
