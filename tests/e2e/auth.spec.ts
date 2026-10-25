import { expect, test } from "@playwright/test";

import { field, logIn, logOut, newAccount, newPersonPage, openEmailLink, signUpAndVerify } from "./support/accounts";
import { getEmailLink } from "./support/mailpit";
import { IS_REMOTE } from "./support/target";

// Runs against local Supabase only: emails are read from its Mailpit inbox.
// Each flow visits several pages, which the dev server compiles on first use.
test.describe.configure({ timeout: 90_000 });

test("sign up, verify by email, onboard, log out and back in to an empty dashboard", async ({
  page,
  isMobile,
}) => {
  test.skip(IS_REMOTE, "reads the confirmation email from local Mailpit");
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
  test.skip(IS_REMOTE, "reads the reset email from local Mailpit");
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

  await openEmailLink(page, await getEmailLink(account.email, "Reset your"));
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
  // Opening it changes nothing; pressing Continue finds the token invalid.
  await openEmailLink(page, "/auth/confirm?token_hash=not-a-real-token&type=email");
  await expect(page).toHaveURL(/\/login\?error=link$/);
  await expect(page.getByText("That link is invalid or has expired.")).toBeVisible();
});

// Review M6 (C1): "/.//host" normalises to "//host", which the client router
// used to follow to another origin after logging in or onboarding.
test("a dot-segment `next` can't send a signed-in user to another site", async ({ page, browser, baseURL }) => {
  // The dashboard on this app's own origin (local or staging), nothing else.
  const sameOrigin = new URL("/dashboard", baseURL).toString();
  const account = newAccount();
  await signUpAndVerify(page, account);
  await field(page, "Your name").fill("Redirect Test");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Already onboarded: /onboarding forwards to `next` straight away.
  await page.goto("/onboarding?next=%2F.%2F%2Fevil.example%2Fpwned");
  await expect(page).toHaveURL(sameOrigin);

  // Logging in (in a fresh browser) with the same kind of `next`.
  const other = await newPersonPage(browser);
  await other.goto("/login?next=%2F.%2F%2Fevil.example%2Fpwned-login");
  await logIn(other, account);
  await expect(other).toHaveURL(sameOrigin);
  await other.context().close();
});

// Review M6 L13: nothing in the browser reads the session, so its cookie is HttpOnly
// (an injected script can't steal the refresh token).
test("the session cookie is HttpOnly", async ({ page }) => {
  const account = newAccount();
  await signUpAndVerify(page, account);
  const session = (await page.context().cookies()).filter((cookie) => /^sb-.*-auth-token/.test(cookie.name));
  expect(session.length).toBeGreaterThan(0);
  for (const cookie of session) {
    expect(cookie.httpOnly, cookie.name).toBe(true);
    expect(cookie.sameSite, cookie.name).toBe("Lax");
  }
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/sb-.*-auth-token/);
});
