import { expect, type Page, test } from "@playwright/test";

import { getDefaultTemplateLink } from "./support/mailpit";

// Supabase's default email templates ({{ .ConfirmationURL }}) send users
// through the auth server's /verify endpoint, which redirects to
// /auth/confirm?code=…. The app exchanges that code (PKCE) for a session.
// Local Supabase uses custom token_hash templates (tests/e2e/auth.spec.ts),
// so these tests build the default-style link from the same email.
test.describe.configure({ timeout: 90_000 });

/** A visible form control by its exact label (hidden pages stay mounted). */
function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).filter({ visible: true });
}

function newAccount() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `e2e-code-${id}@example.com`, password: `Test-${id}-pw` };
}

async function signUp(page: Page, account: { email: string; password: string }) {
  await page.goto("/signup");
  await field(page, "Email").fill(account.email);
  await field(page, "Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email\?for=signup$/);
}

test("default sign-up link in the same browser exchanges the code and signs in", async ({ page }) => {
  const account = newAccount();
  await signUp(page, account);

  await page.goto(await getDefaultTemplateLink(account.email, "Confirm your", "signup"));
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
});

test("default sign-up link in another browser confirms the email and asks to log in", async ({
  page,
  browser,
}) => {
  const account = newAccount();
  await signUp(page, account);
  const link = await getDefaultTemplateLink(account.email, "Confirm your", "signup");

  // A fresh context has no PKCE verifier cookie, like Gmail's in-app browser on iOS.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(link);
  await expect(otherPage).toHaveURL(/\/login\?error=browser$/);
  await expect(otherPage.getByText(/opened in a different browser/)).toBeVisible();

  // The email was confirmed by the auth server, so logging in works there.
  await field(otherPage, "Email").fill(account.email);
  await field(otherPage, "Password").fill(account.password);
  await otherPage.getByRole("button", { name: "Log in" }).click();
  await expect(otherPage).toHaveURL(/\/onboarding$/);
  await other.close();
});

test("default password-reset link exchanges the code and opens the new-password page", async ({ page }) => {
  const account = newAccount();
  await signUp(page, account);
  await page.goto(await getDefaultTemplateLink(account.email, "Confirm your", "signup"));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.context().clearCookies();

  await page.goto("/reset-password");
  await field(page, "Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page).toHaveURL(/\/check-email\?for=reset$/);

  await page.goto(await getDefaultTemplateLink(account.email, "Reset your", "recovery"));
  await expect(page).toHaveURL(/\/reset-password\/update$/);

  const newPassword = `${account.password}-new`;
  await field(page, "New password").fill(newPassword);
  await field(page, "Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/settings\?updated=password$/);
});

test("a used default link explains itself", async ({ page }) => {
  const account = newAccount();
  await signUp(page, account);
  const link = await getDefaultTemplateLink(account.email, "Confirm your", "signup");

  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.context().clearCookies();

  // The auth server reports the reuse in the URL fragment (#error=…), which
  // the server never sees; the route still falls through to the link message.
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?error=link(#.*)?$/);
  await expect(page.getByText("That link is invalid or has expired.")).toBeVisible();
});
