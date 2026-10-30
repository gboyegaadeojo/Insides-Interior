import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Phase 9 (SPEC 5.10, 5.11, 6.8): Home figures open their filtered lists, an
// expense is logged with its receipt (camera first on touch) and viewed in the
// receipt viewer, and reports state their period and basis. Every device.

test.use({ actionTimeout: 15_000 });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`);
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({
    path: `${dir}/${name}-${test.info().project.name.replaceAll(" ", "-")}.png`,
    fullPage: true,
  });
}

// A small striped PNG, standing in for a photographed receipt.
const RECEIPT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADwAAABQCAIAAADKqIEEAAAAo0lEQVR4nO3VsQ0AQRDCwC37a//oeiAwQvJUYImA+wZdOyBx/yCjKUZTjKZsRrePIrEZ3Z46YTTFaIrRlM3o9lEkNqPbUyeMphhNMZqyGd0+isRmdHvqhNEUoylGUzaj20eR2IxuT50wmmI0xWjKZnT7KBKb0e2pE0ZTjKYYTdmMbh9FYjO6PXXCaIrRFKMpm9Hto0hsRrenThhNMZpiNGUy+gF4cDrg/iK7dwAAAABJRU5ErkJggg==",
  "base64",
);

test("Home shows the four figures, each opening its filtered list", async ({ page }) => {
  await page.goto("/");
  const figures = page.getByRole("region", { name: "Key figures" });
  for (const label of ["Outstanding", "Overdue", "Paid this month", "Quotes awaiting answer"]) {
    await expect(figures.getByRole("link", { name: new RegExp(label) })).toBeVisible();
  }
  // Never "₦0" placeholders while loading: the values are real once shown.
  await expect(figures.getByRole("link", { name: /Outstanding/ })).toContainText("₦");
  await expect(page.getByRole("region", { name: "What to do next" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent activity" })).toBeVisible();
  const chart = page.getByRole("region", { name: "Revenue and expenses" });
  await chart.getByRole("radio", { name: "Table" }).click();
  await expect(chart.getByRole("table")).toContainText("Revenue");
  // The phone tab bar floats over whatever scrolls beneath it; scan with the page at its end
  // so no button is mid-scroll under it (axe target-size would count that as overlap).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await seriousViolations(page), "home").toEqual([]);
  await shot(page, "phase9-home");

  await figures.getByRole("link", { name: /Paid this month/ }).click();
  await expect(page).toHaveURL(/\/payments\?from=\d{4}-\d{2}-01/);
  await expect(page.getByText(/Received since/)).toBeVisible();

  await page.goto("/");
  await page
    .getByRole("region", { name: "Key figures" })
    .getByRole("link", { name: /Outstanding/ })
    .click();
  await expect(page).toHaveURL(/\/invoices\?status=outstanding/);
});

test("an expense is logged with its receipt and opens in the receipt viewer", async ({ page }) => {
  test.setTimeout(90_000);
  const supplier = `Balogun Market ${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/expenses");
  const touch = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);

  if (touch) {
    // Camera first: the button opens the camera, then the form.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Log expense" }).click();
    await (await chooser).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: RECEIPT });
  } else {
    await page.getByRole("button", { name: "Log expense" }).click();
    const sheet = page.getByRole("dialog", { name: "Log expense" });
    const chooser = page.waitForEvent("filechooser");
    await sheet.getByRole("button", { name: "Choose file" }).click();
    await (await chooser).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: RECEIPT });
  }
  const sheet = page.getByRole("dialog", { name: "Log expense" });
  // Stored only once the server confirms it.
  await expect(sheet.getByText("Receipt stored")).toBeVisible({ timeout: 20_000 });
  await sheet.getByLabel("Supplier").fill(supplier);
  await sheet.getByLabel(/Amount paid/).fill("10,750");
  await sheet.getByLabel(/VAT paid/).fill("750");
  await sheet.getByLabel("Category").selectOption("fabric");
  expect(await seriousViolations(page), "log expense sheet").toEqual([]);
  await sheet.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved")).toBeVisible({ timeout: 15_000 });

  const list = page.getByRole("list", { name: "Expenses" });
  await expect(list).toContainText(supplier);
  await expect(list).toContainText("₦10,750.00");
  await expect(page.getByText("Expense saved")).toBeHidden({ timeout: 10_000 });
  expect(await seriousViolations(page), "expenses list").toEqual([]);
  await shot(page, "phase9-expenses");

  await list.getByRole("button", { name: `View receipt from ${supplier}` }).click();
  const viewer = page.getByRole("dialog", { name: new RegExp(supplier) });
  await expect(viewer.getByRole("img", { name: new RegExp(`Receipt: ${supplier}`) })).toBeVisible();
  await expect(viewer.getByText(/Receipt \d+ of \d+/)).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

test("reports state their period and basis, and export CSV for Excel", async ({ page, request }) => {
  await page.goto("/reports?report=tax");
  await expect(page.getByRole("heading", { name: "VAT", exact: true })).toBeVisible();
  await expect(page.getByTestId("report-scope")).toContainText("Accrual basis");
  // The controls work once the page has hydrated; retry the first tap until then.
  await expect(async () => {
    await page.getByRole("radiogroup", { name: "Basis" }).getByRole("radio", { name: "Cash basis" }).click();
    await expect(page.getByTestId("report-scope")).toContainText("Cash basis", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page).toHaveURL(/basis=cash/);
  await expect(page.getByText("VAT paid on expenses")).toBeVisible();
  expect(await seriousViolations(page), "VAT report").toEqual([]);

  await page
    .getByRole("radiogroup", { name: "Report" })
    .getByRole("radio", { name: "Aged receivables" })
    .click();
  await expect(page.getByTestId("report-scope")).toContainText("Open balances on");

  await page.getByRole("radiogroup", { name: "Report" }).getByRole("radio", { name: "Revenue" }).click();
  await expect(page.getByText("Revenue before VAT")).toBeVisible();
  expect(await seriousViolations(page), "revenue report").toEqual([]);
  await shot(page, "phase9-reports");

  await page.getByRole("button", { name: "Export" }).click();
  const sheet = page.getByRole("dialog", { name: "Export for your accountant" });
  await expect(sheet.getByRole("button", { name: "Download ZIP" })).toBeEnabled();
  expect(await seriousViolations(page), "export sheet").toEqual([]);

  const csv = await request.get("/reports/export/expenses.csv?from=2020-01-01&to=2099-12-31");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  // UTF-8 byte-order mark first, so Excel reads ₦ correctly.
  const bytes = await csv.body();
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8");
  expect(text).toContain("Net of VAT (NGN)");
  expect((await request.get("/reports/export/expenses.csv?from=bad&to=2099-12-31")).status()).toBe(400);
});
