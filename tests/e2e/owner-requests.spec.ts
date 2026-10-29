import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Owner requests (docs/decisions.md): the owner signs once in Settings and the
// signature is on the documents; lines read Qty, Description, Price per unit,
// Amount; a quote starts with an 85% deposit and states its 7-day validity.
// Run on every device.

test.use({ actionTimeout: 15_000 });

async function seriousViolations(page: Page) {
  // The toast is left out: a tap can leave it paused mid fade-in, which axe reads as low contrast.
  const results = await new AxeBuilder({ page })
    .exclude("[data-sonner-toaster]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`);
}

/** Written to SHOTS_DIR when set, for a design review. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page
    .locator("article.doc")
    .screenshot({ path: `${dir}/${name}-${test.info().project.name.replaceAll(" ", "-")}.png` });
}

/** Draws a short scribble across the signature pad. */
async function sign(page: Page) {
  const pad = page.getByRole("img", { name: "Sign here" });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.7);
  await page.mouse.down();
  for (const [x, y] of [
    [0.25, 0.3],
    [0.4, 0.75],
    [0.6, 0.35],
    [0.85, 0.6],
  ]) {
    await page.mouse.move(box.x + box.width * x!, box.y + box.height * y!, { steps: 4 });
  }
  await page.mouse.up();
}

test("the owner's signature, the new columns and the quote defaults show on the document", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Sign once in Settings → Branding.
  await page.goto("/settings/branding");
  await sign(page);
  await page.getByLabel("Name under the signature").fill("Funmi Adeyemi");
  await page.getByLabel("Title (optional)").fill("Managing Director");
  await page.getByRole("button", { name: /^(Save|Replace) signature$/ }).click();
  await expect(page.getByTestId("signature-preview")).toContainText("Funmi Adeyemi", { timeout: 15_000 });
  // Scan once the save has settled (a busy button is dimmed on purpose).
  await expect(page.getByRole("button", { name: "Replace signature" })).toBeEnabled();
  expect(await seriousViolations(page), "branding").toEqual([]);

  // A new quote: 85% deposit, and the document shows Qty first, the validity and the signature.
  await page.goto("/quotes");
  await page.getByRole("button", { name: "New quote" }).first().click();
  await expect(page).toHaveURL(/\/quotes\/qte_/);
  await expect(page.getByLabel("Deposit (%)")).toHaveValue("85");
  const view = page.getByRole("radiogroup", { name: "Edit or preview" });
  if ((page.viewportSize()?.width ?? 0) < 1024) await view.getByRole("radio", { name: "Preview" }).click();
  const doc = page.locator("article.doc");
  await expect(doc).toContainText("This quote is valid for 7 days from the date it was issued");
  await expect(doc.getByRole("region", { name: "Authorised signature" })).toContainText("Funmi Adeyemi");
  await expect(doc.getByRole("img", { name: "Signature of Funmi Adeyemi" })).toBeVisible();

  // The column order needs a line.
  if ((page.viewportSize()?.width ?? 0) < 1024) await view.getByRole("radio", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Add line" }).first().click();
  await page
    .getByRole("dialog", { name: "Add to the quote" })
    .getByRole("button", { name: /Custom line/ })
    .click();
  await page.getByLabel("Description").first().fill("Roman blind");
  if ((page.viewportSize()?.width ?? 0) < 1024) await view.getByRole("radio", { name: "Preview" }).click();
  const headers = doc.getByRole("columnheader", { includeHidden: true });
  // Phones stack each line (no header row shown); the order is in the markup either way.
  await expect(headers).toHaveText(["Qty", "Description", "Price per unit", "Amount"]);
  await shot(page, "quote-document");
});
