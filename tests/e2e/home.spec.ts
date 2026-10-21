import { expect, test } from "@playwright/test";

test("home page shows the SplitMate brand", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("SplitMate");
  await expect(page.getByRole("heading", { level: 1, name: "SplitMate" })).toBeVisible();
  await expect(page.getByRole("img", { name: "SplitMate logo" })).toBeVisible();
});
