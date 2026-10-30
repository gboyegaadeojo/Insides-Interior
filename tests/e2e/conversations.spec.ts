import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

// SPEC 14.1 phase 7 exit, flow 6 (SPEC 6.9): the payer opens the invoice, taps
// a line, asks to remove it; the owner sees it in the Inbox, accepts, and the
// draft revision opens with the line gone and the total recalculated; the
// payer gets "Revised (rev 2)" with What changed. Run on every device.

// A stuck click or fill names its step instead of using up the whole test.
test.use({ actionTimeout: 15_000 });

/** Attached to the report; also written to SHOTS_DIR when set, for a design review. */
async function shot(page: Page, name: string) {
  const file = `${name}-${test.info().project.name.replaceAll(" ", "-")}.png`;
  const dir = process.env.SHOTS_DIR;
  const body = await page.screenshot({ fullPage: true, path: dir ? `${dir}/${file}` : undefined });
  await test.info().attach(file, { body, contentType: "image/png" });
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`);
}

async function fillLine(line: Locator, v: { description: string; qty: string; price: string }) {
  await line.getByLabel("Description").fill(v.description);
  const qty = line.getByLabel("Qty");
  await qty.click();
  await qty.fill(v.qty);
  await qty.press("Tab");
  const price = line.getByLabel("Price");
  await price.click();
  await price.fill(v.price);
  await price.press("Tab");
}

async function addCustomLine(page: Page) {
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: "Add to the invoice" })
    .getByRole("button", { name: /Custom line/ })
    .click();
}

async function clientPage(browser: Browser) {
  const { storageState: _owner, ...device } = test.info().project.use;
  const context = await browser.newContext({ ...device, storageState: undefined });
  return context.newPage();
}

test("flow 6: the payer asks to remove a line; the owner accepts and sends rev 2 (FR-MSG-03…06)", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const clientName = `Payer ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  // The owner sends a two-line invoice.
  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await expect(page).toHaveURL(/\/invoices\/inv_/);
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(clientName);
  await page.getByRole("option", { name: new RegExp(`Create “${clientName}”`) }).click();
  const newClient = page.getByRole("dialog", { name: "New client" });
  await newClient.getByLabel("Email").fill("payer@example.ng");
  await newClient.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText(clientName);
  await page.getByLabel("Room name").first().fill("Living room");
  const lines = page.getByRole("list", { name: "Lines in Living room" }).getByRole("listitem");
  await addCustomLine(page);
  await fillLine(lines.nth(0), { description: "Three-seater sofa", qty: "1", price: "100000" });
  await addCustomLine(page);
  await fillLine(lines.nth(1), { description: "Scatter cushions", qty: "2", price: "5000" });
  await expect(page.getByTestId("quote-total")).toHaveText("₦110,000.00");
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Send invoice" })
    .getByRole("button", { name: "Send ₦110,000.00" })
    .click();
  await expect(page.getByText(/sent to payer@example\.ng/)).toBeVisible({ timeout: 15_000 });
  const invoiceUrl = page.url();
  const link = new URL(await page.getByLabel("Link").inputValue()).pathname;

  // The payer taps a line → Request a change → Remove this item + note → Send.
  const payer = await clientPage(browser);
  await payer.goto(link);
  await payer.getByRole("button", { name: "Request a change to Scatter cushions" }).click();
  const sheet = payer.getByRole("dialog", { name: "Request a change" });
  await expect(sheet.getByLabel("Which item?")).toHaveValue(/.+/);
  await expect(sheet.getByRole("radio", { name: "Remove this item" })).toBeChecked();
  await sheet.getByLabel("Anything to add? (optional)").fill("We already have cushions.");
  await sheet.getByLabel("Your name").fill("Amaka Obi");
  expect(await seriousViolations(payer), "change request sheet").toEqual([]);
  await sheet.getByRole("button", { name: "Send request" }).click();
  await expect(payer.getByText("We've got your request")).toBeVisible({ timeout: 15_000 });
  const thread = payer.getByRole("region", { name: "Messages" });
  await expect(thread.getByTestId("change-request")).toContainText("Scatter cushions");
  await expect(thread.getByTestId("change-request")).toContainText("Open");
  await expect(payer.getByText("Change requested", { exact: true })).toBeVisible();
  // The name is remembered on this device (FR-MSG-02).
  await expect(thread.getByText("Sending as")).toContainText("Amaka Obi");
  // Scan once the confirmation toast has gone: axe reads its fade-in as low contrast.
  await expect(payer.getByText("Your request was sent")).toBeHidden({ timeout: 10_000 });
  expect(await seriousViolations(payer), "portal with a request").toEqual([]);
  await shot(payer, "flow6-payer-request");

  // The owner sees it in Home "Needs you" and the Inbox, opens the thread and accepts.
  await page.goto("/");
  await expect(page.getByRole("region", { name: "What to do next" })).toContainText(clientName);
  await page.goto("/inbox");
  const row = page
    .getByRole("list", { name: "Conversations" })
    .getByRole("link", { name: new RegExp(clientName) });
  await expect(row).toContainText("1 change request");
  await row.click();
  const card = page.getByTestId("change-request").filter({ hasText: "Scatter cushions" });
  await expect(card).toContainText("We already have cushions.");
  expect(await seriousViolations(page), "inbox thread").toEqual([]);
  await shot(page, "flow6-inbox");
  await card.getByRole("button", { name: "Accept" }).click();

  // The draft revision opens with the line removed and the total recalculated.
  await expect(page).toHaveURL(/\/invoices\/inv_/, { timeout: 15_000 });
  await expect(page.getByText(/Revising INV-\d+ \(rev 2\)/)).toBeVisible();
  await expect(page.getByTestId("accepted-requests")).toContainText("Remove this item: Scatter cushions");
  await expect(page.getByTestId("quote-total")).toHaveText("₦100,000.00");
  await shot(page, "flow6-revision");
  await page.getByRole("button", { name: "Send revision" }).click();
  await page
    .getByRole("dialog", { name: "Send revision 2" })
    .getByRole("button", { name: "Send ₦100,000.00" })
    .click();
  await expect(page.getByText(/\(rev 2\) sent to payer@example\.ng/)).toBeVisible({ timeout: 15_000 });

  // The owner replies from the invoice's conversation (a tab below tablet landscape).
  // Below tablet landscape (1024px) the conversation is a tab beside the document.
  const tabs = (page.viewportSize()?.width ?? 0) < 1024;
  const show = page.getByRole("radiogroup", { name: "Show" });
  if (tabs) await show.getByRole("radio", { name: /Conversation/ }).click();
  await page.getByLabel(`Reply to ${clientName}`).fill("Done, the cushions are off.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Reply sent; the client gets it by email")).toBeVisible({ timeout: 15_000 });

  // The payer's old link is gone; the new one shows rev 2 with What changed and the outcome.
  await page.goto(invoiceUrl);
  if (tabs) await expect(show.getByRole("radio", { name: "Document" })).toBeChecked();
  const newLink = new URL(await page.getByLabel("Link").inputValue()).pathname;
  await payer.goto(newLink);
  await expect(payer.getByText(/Revised \(rev 2\)/).first()).toBeVisible();
  const changed = payer.getByTestId("what-changed");
  await expect(changed).toContainText("Removed Scatter cushions");
  await expect(changed).toContainText("₦110,000.00");
  await expect(changed).toContainText("₦100,000.00");
  await expect(payer.getByTestId("portal-balance")).toHaveText("₦100,000.00");
  await expect(payer.getByTestId("change-request")).toContainText("Accepted");
  await expect(payer.getByText("Done, the cushions are off.")).toBeVisible();
  expect(await seriousViolations(payer), "revised portal").toEqual([]);
  await shot(payer, "flow6-payer-revised");
  await payer.context().close();
});

test("a message from the payer reaches the owner without changing the document", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  // Reuse the quote builder path: a one-line quote, sent.
  const clientName = `Writer ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(clientName);
  await page.getByRole("option", { name: new RegExp(`Create “${clientName}”`) }).click();
  const newClient = page.getByRole("dialog", { name: "New client" });
  await newClient.getByLabel("Email").fill("writer@example.ng");
  await newClient.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText(clientName);
  await page.getByLabel("Room name").first().fill("Study");
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: "Add to the quote" })
    .getByRole("button", { name: /Custom line/ })
    .click();
  const line = page.getByRole("list", { name: "Lines in Study" }).getByRole("listitem").first();
  await fillLine(line, { description: "Desk", qty: "1", price: "80000" });
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Send quote" })
    .getByRole("button", { name: /^Send ₦/ })
    .click();
  await expect(page.getByText(/sent to writer@example\.ng/)).toBeVisible({ timeout: 15_000 });
  const link = new URL(await page.getByLabel("Link").inputValue()).pathname;

  const client = await clientPage(browser);
  await client.goto(link);
  const thread = client.getByRole("region", { name: "Messages" });
  await thread.getByLabel("Write a message").fill("Can you deliver on a Saturday?");
  await thread.getByLabel("Your name").fill("Tunde");
  await thread.getByRole("button", { name: "Send message" }).click();
  await expect(thread.getByText("Can you deliver on a Saturday?")).toBeVisible({ timeout: 15_000 });
  // Still approvable: a message isn't a change request.
  await expect(client.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

  // The owner's quote opens on the conversation (an unread message); the status is untouched.
  await page.reload();
  await expect(page.getByText("Can you deliver on a Saturday?").first()).toBeVisible();
  await expect(page.getByText("Changes requested", { exact: true })).toHaveCount(0);
  await client.context().close();
});
