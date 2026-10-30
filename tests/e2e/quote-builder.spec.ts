import { expect, type Locator, type Page, test } from "@playwright/test";

// SPEC 14.4 phase 4: build F1 in the builder and verify ₦121,950.56, on every
// device project (including iPad Pro 11 and iPhone 14).

async function shot(page: Page, name: string) {
  await test.info().attach(`${name}-${test.info().project.name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function fillLine(
  line: Locator,
  values: { description: string; qty: string; unit: string; price: string },
) {
  await line.getByLabel("Description").fill(values.description);
  const qty = line.getByLabel("Qty");
  await qty.click();
  await qty.fill(values.qty);
  await qty.press("Tab");
  const price = line.getByLabel("Price");
  await price.click();
  await price.fill(values.price);
  await price.press("Tab");
}

/** VAT is off by default (Nigeria); F1 charges it on every line. */
async function chargeVat(line: Locator, description: string) {
  await line.getByRole("button", { name: `More options for ${description}` }).click();
  await line.getByRole("checkbox", { name: /^VAT/ }).check();
}

async function addCustomLine(page: Page) {
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: "Add to the quote" })
    .getByRole("button", { name: /Custom line/ })
    .click();
}

test("build fixture F1 and see ₦121,950.56, saved on the server", async ({ page }) => {
  // The whole F1 build (inline client, two lines, autosave, reload) outruns the 30 s default.
  test.setTimeout(90_000);
  const client = `F1 Client ${Date.now().toString(36)}`;
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await expect(page).toHaveURL(/\/quotes\/qte_/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // Client, created inline (FR-CLI-01).
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(client);
  await page.getByRole("option", { name: new RegExp(`Create “${client}”`) }).click();
  await page
    .getByRole("dialog", { name: "New client" })
    .getByRole("button", { name: "Create client" })
    .click();
  await expect(page.getByRole("combobox", { name: "Client" })).toContainText(client);

  await page.getByLabel("Room name").first().fill("Living room");

  await addCustomLine(page);
  const lines = page.getByRole("list", { name: "Lines in Living room" }).getByRole("listitem");
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
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });
  await shot(page, "builder-f1");

  // Phone and tablet portrait: the sticky total bar and the preview tab.
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await expect(page.getByRole("button", { name: "Show the totals breakdown" })).toContainText(
      "₦121,950.56",
    );
    await page.getByRole("radio", { name: "Preview" }).click();
  }
  const preview = page.getByRole("complementary", { name: "Live preview" });
  await expect(preview.getByText("₦121,950.56").first()).toBeVisible();
  await expect(preview.getByText("Drapery fabric")).toBeVisible();

  // The server kept it (and recomputed it the same way).
  await page.reload();
  await expect(page.getByTestId("quote-total")).toHaveText("₦121,950.56");
});

test("optional items stay out of the total until selected (FR-QT-03)", async ({ page }) => {
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await expect(page).toHaveURL(/\/quotes\/qte_/);
  await addCustomLine(page);
  const line = page
    .getByRole("listitem")
    .filter({ has: page.getByLabel("Description") })
    .first();
  await fillLine(line, { description: "Blackout lining", qty: "1", unit: "each", price: "100" });
  await expect(page.getByTestId("quote-total")).toHaveText("₦100.00");
  await line.getByRole("button", { name: /More options for Blackout lining/ }).click();
  await line.getByLabel(/Optional item/).check();
  await expect(page.getByTestId("quote-total")).toHaveText("₦0.00");
  await line.getByLabel("Include it in the preview total").check();
  await expect(page.getByTestId("quote-total")).toHaveText("₦100.00");
  await expect(page.getByText("Base total (no options)")).toBeVisible();
});

test("a second tab gets a newer-version warning instead of overwriting (FR-QT-06)", async ({
  page,
  context,
}) => {
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await expect(page).toHaveURL(/\/quotes\/qte_/);
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);

  await page.getByLabel("Project title").fill("First tab");
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });

  await other.getByLabel("Project title").fill("Second tab");
  await expect(other.getByRole("alert").filter({ hasText: "newer version" })).toBeVisible({
    timeout: 15_000,
  });
  await other.close();
});
