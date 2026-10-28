import { expect, test } from "@playwright/test";

// Signed-out behaviour (FR-AUTH-03/06). These run without the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test("the app sends signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/quotes");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fquotes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  // No registration or password links (FR-AUTH-03, FR-AUTH-06).
  await expect(page.getByRole("link", { name: /sign up|register|forgot/i })).toHaveCount(0);
});

test("an uninvited email is told so", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't invited");
});

test("an invited email gets the check-your-email screen", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("e2e-owner@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
});

test("a used or bad link explains what happened", async ({ page }) => {
  await page.goto(
    "/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=%2F&errorCallbackURL=%2Fsign-in",
  );
  await expect(page).toHaveURL(/\/sign-in\?error=/);
  await expect(page.getByRole("alert")).toContainText(/link/i);
});

test("there is no registration page", async ({ request }) => {
  expect((await request.get("/register")).status()).toBe(404);
});
