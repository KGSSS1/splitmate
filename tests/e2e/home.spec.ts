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

// Review M6 L14: no framing by other sites (clickjacking on Confirm / Join buttons),
// no MIME sniffing, a strict referrer policy, and no framework banner.
test("pages send security headers", async ({ request }) => {
  for (const path of ["/", "/login", "/invite/not-a-real-token"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});
