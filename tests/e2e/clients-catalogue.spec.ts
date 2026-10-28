import { expect, type Page, test } from "@playwright/test";

// SPEC 14.4 phase 3: create a client and an item (run on every device project,
// including iPhone 14 and iPad Pro 11).

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

async function shot(page: Page, name: string) {
  await test.info().attach(`${name}-${test.info().project.name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("create a client, add a site and find them by search", async ({ page }) => {
  const name = unique("Amelia Chen");
  await page.goto("/clients");
  await page.getByRole("button", { name: "New client" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New client" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("Email").fill("amelia@example.com");
  await sheet.getByLabel("Phone").fill("0803 123 4567");
  await sheet.getByLabel("Billing address").fill("12 Admiralty Way, Lekki");
  await page.getByRole("button", { name: "Save client" }).click();

  await expect(page).toHaveURL(/\/clients\/cli_/);
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

  await page.getByRole("button", { name: "Add job address" }).click();
  await page.getByLabel("Address name").fill("Cottage");
  await page.getByLabel("Street address").fill("4 Bourdillon Rd, Ikoyi");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("4 Bourdillon Rd, Ikoyi")).toBeVisible();
  await shot(page, "client-profile");

  await page.goto("/clients");
  await page.getByRole("searchbox", { name: "Search clients" }).fill("bourdillon");
  await expect(page.getByRole("list", { name: "Clients" }).getByText(name)).toBeVisible();
});

test("create a catalogue item with cost and markup", async ({ page }) => {
  const name = unique("Linen fabric");
  await page.goto("/catalogue");
  await page.getByRole("button", { name: "New item" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New item" });
  await sheet.getByText("Product").click();
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("Unit", { exact: true }).selectOption("yard");
  await sheet.getByLabel("Your cost").fill("28.50");
  await sheet.getByLabel("Your cost").press("Tab");
  await sheet.getByLabel("Markup (%)").fill("50");
  await sheet.getByLabel("Markup (%)").press("Tab");
  await expect(sheet.getByLabel("Price (per unit)")).toHaveValue("42.75");
  await page.getByRole("button", { name: "Add to catalogue" }).click();

  await expect(page.getByText("Item added to your catalogue")).toBeVisible();
  const card = page
    .getByRole("list", { name: "Catalogue items" })
    .getByRole("button", { name: new RegExp(name) });
  await expect(card).toContainText("₦42.75 / yard");
  await shot(page, "catalogue");
});

test("start a project with a client created inline (FR-CLI-01)", async ({ page }) => {
  const client = unique("Kwame Mensah");
  await page.goto("/projects?new=1");
  const sheet = page.getByRole("dialog", { name: "New project" });
  await sheet.getByLabel("Project name").fill("Main floor drapery");
  await sheet.getByRole("combobox", { name: "Client" }).click();
  await page.keyboard.type(client);
  await page.getByRole("option", { name: new RegExp(`Create “${client}”`) }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await dialog.getByLabel("Email").fill("kwame@example.com");
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(sheet.getByRole("combobox", { name: "Client" })).toContainText(client);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  await expect(page.getByRole("heading", { level: 2, name: "Main floor drapery" })).toBeVisible();
  await expect(page.getByRole("img", { name: /0% paid/ })).toBeVisible();
  await shot(page, "project");
});
