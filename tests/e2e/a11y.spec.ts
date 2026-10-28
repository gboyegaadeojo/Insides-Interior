import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// SPEC 13: axe-core in Playwright, zero serious violations, light and dark.
const PAGES = [
  "/",
  "/quotes",
  "/invoices",
  "/clients",
  "/settings",
  "/more",
  "/design?theme=light",
  "/design?theme=dark",
];

for (const path of PAGES) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${path} has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious.map(
          (v) =>
            `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`).join("; ")})`,
        ),
      ).toEqual([]);
    });
  }
}
