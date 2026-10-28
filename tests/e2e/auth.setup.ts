import { expect, test as setup } from "@playwright/test";

// Signs in once as the seeded E2E owner through the real magic-link verify
// route and saves the session for every other test (one sign-in, so the auth
// rate limit is never hit). Needs E2E_SECRET to match the server's.
export const OWNER_STATE = "tests/e2e/.auth/owner.json";

setup("sign in as the E2E owner", async ({ page, request }) => {
  const secret = process.env.E2E_SECRET;
  if (!secret) throw new Error("Set E2E_SECRET (the same value as the server's) to run the e2e tests.");
  const response = await request.post("/api/test/sign-in", {
    headers: { "x-e2e-secret": secret },
    data: { next: "/" },
  });
  expect(response.status(), await response.text()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.context().storageState({ path: OWNER_STATE });
});
