import { expect, type Page, test } from "@playwright/test";

import { getEmailLink } from "./support/mailpit";

// Runs against local Supabase only: emails are read from its Mailpit inbox.
// Each flow visits several pages, which the dev server compiles on first use.
test.describe.configure({ timeout: 90_000 });

/**
 * A visible form control by its exact label. With Cache Components, pages
 * navigated away from stay mounted but hidden, so the same label can exist twice.
 */
function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).filter({ visible: true });
}

function newAccount() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `e2e-${id}@example.com`, password: `Test-${id}-pw` };
}

async function signUpAndVerify(page: Page, account: { email: string; password: string }) {
  await page.goto("/signup");
  await field(page, "Email").fill(account.email);
  await field(page, "Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/check-email\?for=signup$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(await getEmailLink(account.email, "Confirm your"));
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function logOut(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
  } else {
    await page.getByRole("button", { name: "Log out" }).click();
  }
  await expect(page).toHaveURL(/\/login$/);
}

async function logIn(page: Page, account: { email: string; password: string }) {
  await field(page, "Email").fill(account.email);
  await field(page, "Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

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
  await expect(page.getByRole("button", { name: /Add expense/ })).toBeVisible();

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
