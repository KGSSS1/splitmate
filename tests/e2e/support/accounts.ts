import { type Browser, expect, type Page, test } from "@playwright/test";

import { getEmailLink } from "./mailpit";

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
  if (from) await page.goto(from);
  await field(page, "Email").fill(account.email);
  await field(page, "Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/check-email\?for=signup$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(await getEmailLink(account.email, "Confirm your"));
  await expect(page).toHaveURL(/\/onboarding(\?|$)/);
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
