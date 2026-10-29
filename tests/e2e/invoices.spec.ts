import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

// SPEC 14.1 phase 6 exit: F1–F3 reproduced through the UI. F1 is built and
// approved, the deposit invoice (F2) and the final invoice (F3) both come to
// ₦60,975.28 and add up to the quote; payments, WHT and void work from the
// invoice screen on every device.

async function shot(page: Page, name: string) {
  await test.info().attach(`${name}-${test.info().project.name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function fillLine(line: Locator, v: { description: string; qty: string; unit: string; price: string }) {
  await line.getByLabel("Description").fill(v.description);
  const qty = line.getByLabel("Qty");
  await qty.click();
  await qty.fill(v.qty);
  await qty.press("Tab");
  await line.getByLabel("Unit").fill(v.unit);
  const price = line.getByLabel("Price");
  await price.click();
  await price.fill(v.price);
  await price.press("Tab");
}

async function chargeVat(line: Locator, description: string) {
  await line.getByRole("button", { name: `More options for ${description}` }).click();
  await line.getByRole("checkbox", { name: /^VAT/ }).check();
}

async function addCustomLine(page: Page) {
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: /^Add to the (quote|invoice)$/ })
    .getByRole("button", { name: /Custom line/ })
    .click();
}

async function newClient(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(name);
  await page.getByRole("option", { name: new RegExp(`Create “${name}”`) }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await dialog.getByLabel("Email").fill("f1-client@example.ng");
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText(name);
}

async function waitSaved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });
}

async function send(page: Page, sheetName: RegExp, amount: string) {
  await page.getByRole("button", { name: /^Send( revision)?$/ }).click();
  const sheet = page.getByRole("dialog", { name: sheetName });
  await expect(sheet.getByLabel("To")).toHaveValue("f1-client@example.ng");
  await sheet.getByRole("button", { name: `Send ${amount}` }).click();
  await expect(page.getByText(/sent to f1-client@example\.ng/)).toBeVisible({ timeout: 15_000 });
}

async function clientPage(browser: Browser) {
  const { storageState: _owner, ...device } = test.info().project.use;
  const context = await browser.newContext({ ...device, storageState: undefined });
  return context.newPage();
}

test("F1 quote → F2 deposit invoice → payment → F3 final invoice (SPEC 10.2)", async ({ page, browser }) => {
  test.setTimeout(180_000);
  // F1, built and sent.
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await expect(page).toHaveURL(/\/quotes\/qte_/);
  await newClient(page, `F1 Client ${Date.now().toString(36)}`);
  await page.getByLabel("Room name").first().fill("Living room");
  const lines = page.getByRole("list", { name: "Lines in Living room" }).getByRole("listitem");
  await addCustomLine(page);
  await fillLine(lines.nth(0), {
    description: "Design consultation",
    qty: "3",
    unit: "hour",
    price: "25000",
  });
  await chargeVat(lines.nth(0), "Design consultation");
  await addCustomLine(page);
  await fillLine(lines.nth(1), {
    description: "Drapery fabric",
    qty: "4.5",
    unit: "metre",
    price: "8542.75",
  });
  await chargeVat(lines.nth(1), "Drapery fabric");
  await expect(page.getByTestId("quote-total")).toHaveText("₦121,950.56");
  await waitSaved(page);
  await send(page, /Send quote/, "₦121,950.56");
  const quoteUrl = page.url();
  const link = new URL(await page.getByLabel("Link").inputValue()).pathname;

  // The client approves on their device.
  const client = await clientPage(browser);
  await client.goto(link);
  await client.getByRole("button", { name: "Approve", exact: true }).click();
  const approve = client.getByRole("dialog", { name: "Approve this quote" });
  await approve.getByLabel("Your full name").fill("Amaka Obi");
  await approve.getByRole("checkbox", { name: /I approve quote/ }).check();
  await approve.getByRole("button", { name: /^Approve ₦121,950\.56/ }).click();
  await expect(client.getByText(/Approved by Amaka Obi/)).toBeVisible({ timeout: 15_000 });

  // F2: the deposit invoice.
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: "Deposit invoice" }).click();
  await expect(page).toHaveURL(/\/invoices\/inv_/);
  await expect(page.getByText(/Deposit invoice for quote Q-\d+/)).toBeVisible();
  await expect(page.getByTestId("quote-total")).toHaveText("₦60,975.28");
  await shot(page, "f2-builder");
  await send(page, /Send invoice/, "₦60,975.28");
  await expect(page.getByTestId("invoice-balance")).toHaveText("₦60,975.28");

  // The client opens the invoice link and sees what's due and how to pay.
  const invoiceLink = new URL(await page.getByLabel("Link").inputValue()).pathname;
  await client.goto(invoiceLink);
  await expect(client.getByTestId("portal-balance")).toHaveText("₦60,975.28");
  // Bank details when they're set in Settings; otherwise who to contact.
  await expect(client.getByText(/How to pay|for payment details/).first()).toBeVisible();

  // Paid in full by bank transfer.
  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record a payment" });
  await pay.getByLabel("Reference (optional)").fill("TRF-001");
  await pay.getByRole("button", { name: "Record ₦60,975.28" }).click();
  await expect(page.getByText("Paid in full").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("invoice-balance")).toHaveText("₦0.00");
  await shot(page, "f2-paid");
  await client.reload();
  await expect(client.getByText("Paid in full").first()).toBeVisible();

  // F3: the final invoice credits the deposit and comes to the rest exactly.
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: "Final invoice" }).click();
  await expect(page).toHaveURL(/\/invoices\/inv_/);
  await expect(page.getByText(/Less deposit invoice INV-\d+/).first()).toBeVisible();
  await expect(page.getByTestId("quote-total")).toHaveText("₦60,975.28");
  await shot(page, "f3-builder");
  await send(page, /Send invoice/, "₦60,975.28");
  await client.context().close();
});

test("a blank invoice: terms, partial payment with WHT, delete a payment, void", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await expect(page).toHaveURL(/\/invoices\/inv_/);
  await newClient(page, `Invoice Client ${Date.now().toString(36)}`);
  await page.getByLabel("Client's PO or reference").fill("PO-4471");
  await page.getByRole("radio", { name: "7 days" }).click();
  await page.getByLabel("Room name").first().fill("Bedroom");
  const lines = page.getByRole("list", { name: "Lines in Bedroom" }).getByRole("listitem");
  await addCustomLine(page);
  await fillLine(lines.nth(0), { description: "Wardrobe fitting", qty: "1", unit: "job", price: "200000" });
  await expect(page.getByTestId("quote-total")).toHaveText("₦200,000.00");
  await waitSaved(page);
  await send(page, /Send invoice/, "₦200,000.00");
  await expect(page.getByText("Your reference").first()).toBeVisible();

  // ₦95,000 cash plus 5% WHT (₦10,000 on the whole pre-VAT amount, edited down to ₦5,000).
  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record a payment" });
  await pay.getByRole("checkbox", { name: /The client deducted WHT/ }).check();
  const wht = pay.getByLabel("WHT amount");
  await expect(wht).toHaveValue("10,000.00");
  await wht.fill("5000");
  await wht.press("Tab");
  const cash = pay.getByLabel("Amount received");
  await cash.fill("95000");
  await cash.press("Tab");
  await pay.getByRole("button", { name: "Record ₦100,000.00" }).click();
  await expect(page.getByTestId("invoice-balance")).toHaveText("₦100,000.00", { timeout: 15_000 });
  await expect(page.getByText(/Partially paid/i).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Payments" })).toContainText("WHT ₦5,000.00");

  // Owner deletes it with a reason; the balance returns.
  await page.getByRole("button", { name: /Delete the payment of ₦95,000\.00/ }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this payment?" });
  await confirm.getByLabel("Reason").fill("Transfer reversed");
  await confirm.getByRole("button", { name: "Delete payment" }).click();
  await expect(page.getByTestId("invoice-balance")).toHaveText("₦200,000.00", { timeout: 15_000 });

  // Unpaid, so it can be voided outright.
  await page.getByRole("button", { name: "Void" }).click();
  const voiding = page.getByRole("alertdialog", { name: "Void this invoice?" });
  await voiding.getByLabel("Reason").fill("Raised against the wrong client");
  await voiding.getByRole("button", { name: "Void invoice" }).click();
  await expect(page.getByText("Reason: Raised against the wrong client")).toBeVisible({ timeout: 15_000 });

  // It shows in the ledger, struck through, and in the invoice list as void.
  await page.goto("/payments");
  await expect(page.getByText(/Deleted: Transfer reversed/).first()).toBeVisible();
  await page.goto("/invoices?status=void");
  await expect(page.getByRole("list", { name: "Invoices" })).toContainText("Void");
});
