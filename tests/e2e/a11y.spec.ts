import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// SPEC 13: axe-core in Playwright, zero serious violations, light and dark.
const PAGES = [
  "/",
  "/quotes",
  "/invoices",
  "/clients",
  "/clients?new=1",
  "/catalogue",
  "/catalogue?item=new",
  "/catalogue?view=templates",
  "/catalogue?view=templates&template=new",
  "/projects",
  "/projects?new=1",
  "/inbox",
  "/expenses",
  "/expenses?expense=new",
  "/payments",
  "/reports",
  "/reports?report=tax&basis=cash",
  "/reports?report=aged",
  "/more",
  "/settings",
  "/settings/business",
  "/settings/branding",
  "/settings/tax",
  "/settings/documents",
  "/settings/email",
  "/settings/reminders",
  "/settings/team",
  "/settings/account",
  "/settings/appearance",
  "/settings/data",
  "/design?theme=light",
  "/design?theme=dark",
];

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`).join("; ")})`,
    );
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(path);
      // Streamed widgets (Home) and lists finish loading before the scan.
      await page.waitForLoadState("networkidle");
      if (!path.startsWith("/design")) await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  for (const noun of ["quote", "invoice"] as const) {
    test(`a new ${noun} in the builder has no serious accessibility violations (${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(`/${noun}s`);
      await page
        .getByRole("button", { name: `New ${noun}` })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/${noun}s/(qte|inv)_`));
      await page.waitForLoadState("networkidle");
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test(`/sign-in has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/sign-in");
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}
