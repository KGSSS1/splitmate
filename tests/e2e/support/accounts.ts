import { type Browser, expect, type Page, test } from "@playwright/test";

import { getEmailLink } from "./mailpit";
import { IS_REMOTE, remoteAdmin } from "./target";

export interface Account {
  email: string;
  password: string;
}

/**
 * A visible form control by its exact label. With Cache Components, pages
 * navigated away from stay mounted but hidden, so the same label can exist twice.
 */
export function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).filter({ visible: true });
}

export function newAccount(): Account {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `e2e-${id}@example.com`, password: `Test-${id}-pw` };
}

/**
 * Fills in the sign-up form on the current page (or /signup), then opens the
 * confirmation link from Mailpit. Ends on onboarding, possibly with `?next=`.
 */
export async function signUpAndVerify(page: Page, account: Account, { from = "/signup" }: { from?: string | null } = {}) {
  if (IS_REMOTE) return remoteSignUp(page, account, from);
  if (from) await page.goto(from);
  await field(page, "Email").fill(account.email);
  await field(page, "Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/check-email\?for=signup$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await openEmailLink(page, await getEmailLink(account.email, "Confirm your"));
  await expect(page).toHaveURL(/\/onboarding(\?|$)/);
}

/**
 * Staging has no inbox to read: create the account already confirmed through
 * the Auth admin API (no email is sent), then log in through the app, keeping
 * any `next` the sign-up page carried. Ends on onboarding, as locally.
 */
async function remoteSignUp(page: Page, account: Account, from: string | null) {
  const { error } = await remoteAdmin().auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
  });
  if (error) throw error;
  const next = from === null ? new URL(page.url()).searchParams.get("next") : null;
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await logIn(page, account);
  await expect(page).toHaveURL(/\/onboarding(\?|$)/, { timeout: 30_000 });
}

/**
 * Opens a token-hash email link: it lands on /auth/continue, and nothing
 * happens until Continue is pressed (review M9 L3).
 */
export async function openEmailLink(page: Page, link: string) {
  await page.goto(link);
  await expect(page).toHaveURL(/\/auth\/continue\?/);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Onboarding with a name and the default currency (INR). */
export async function onboard(page: Page, name: string) {
  await field(page, "Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
}

export async function logIn(page: Page, account: Account) {
  await field(page, "Email").fill(account.email);
  await field(page, "Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

export async function logOut(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
  } else {
    await page.getByRole("button", { name: "Log out" }).click();
  }
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * A page for another person, in its own browser context (own cookies) with
 * the same device settings as the current project (desktop or phone).
 */
export async function newPersonPage(browser: Browser): Promise<Page> {
  const { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = test.info().project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
  return context.newPage();
}
