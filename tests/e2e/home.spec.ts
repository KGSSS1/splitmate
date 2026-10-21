import { expect, test } from "@playwright/test";

test("home page shows the SplitMate brand", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("SplitMate");
  await expect(page.getByRole("heading", { level: 1, name: "SplitMate" })).toBeVisible();
  await expect(page.getByRole("img", { name: "SplitMate logo" })).toBeVisible();

  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("unknown pages ask signed-out visitors to log in", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page).toHaveURL(/\/login\?next=%2Fno-such-page$/);
});
