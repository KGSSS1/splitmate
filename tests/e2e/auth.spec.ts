import { expect, test } from "@playwright/test";

import { field, logIn, logOut, newAccount, newPersonPage, signUpAndVerify } from "./support/accounts";
import { getEmailLink } from "./support/mailpit";

// Runs against local Supabase only: emails are read from its Mailpit inbox.
// Each flow visits several pages, which the dev server compiles on first use.
test.describe.configure({ timeout: 90_000 });

test("sign up, verify by email, onboard, log out and back in to an empty dashboard", async ({
  page,
  isMobile,
}) => {
  const account = newAccount();
  await signUpAndVerify(page, account);

  // Onboarding: name and default currency.
  await field(page, "Your name").fill("Asha Test");
  await field(page, "Default currency").selectOption("INR");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await logOut(page, isMobile);

  // Protected pages now send us to login, remembering where we were going.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await logIn(page, account);

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Hi, Asha Test" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No balances yet" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Add expense" }).filter({ visible: true }).first()).toBeVisible();

  if (isMobile) {
    // Bottom bar on phones, with the secondary pages behind the menu.
    const box = await nav.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.y + box.height).toBeCloseTo(viewport?.height ?? 0, 0);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
  } else {
    // Sidebar on desktop.
    const box = await nav.boundingBox();
    expect(box?.x).toBeLessThan(300);
    await page.getByRole("link", { name: "Settings" }).click();
  }
  await expect(page).toHaveURL(/\/settings$/);
  await expect(field(page, "Name")).toHaveValue("Asha Test");

  // Signed in, an unknown URL shows the not-found page instead of the login redirect.
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("password reset by email", async ({ page }) => {
  const account = newAccount();
  await signUpAndVerify(page, account);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await field(page, "Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page).toHaveURL(/\/check-email\?for=reset$/);

  await page.goto(await getEmailLink(account.email, "Reset your"));
  await expect(page).toHaveURL(/\/reset-password\/update$/);
  const newPassword = `${account.password}-new`;
  await field(page, "New password").fill(newPassword);
  await field(page, "Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/settings\?updated=password$/);
  await expect(page.getByText("Your password has been updated.")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await logIn(page, account);
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await logIn(page, { ...account, password: newPassword });
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an invalid email link explains itself on the login page", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=email");
  await expect(page).toHaveURL(/\/login\?error=link$/);
  await expect(page.getByText("That link is invalid or has expired.")).toBeVisible();
});

// Review M6 (C1): "/.//host" normalises to "//host", which the client router
// used to follow to another origin after logging in or onboarding.
test("a dot-segment `next` can't send a signed-in user to another site", async ({ page, browser }) => {
  const account = newAccount();
  await signUpAndVerify(page, account);
  await field(page, "Your name").fill("Redirect Test");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Already onboarded: /onboarding forwards to `next` straight away.
  await page.goto("/onboarding?next=%2F.%2F%2Fevil.example%2Fpwned");
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/dashboard$/);

  // Logging in (in a fresh browser) with the same kind of `next`.
  const other = await newPersonPage(browser);
  await other.goto("/login?next=%2F.%2F%2Fevil.example%2Fpwned-login");
  await logIn(other, account);
  await expect(other).toHaveURL(/^http:\/\/localhost:\d+\/dashboard$/);
  await other.context().close();
});
