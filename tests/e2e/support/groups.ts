import { type Browser, expect, type Page } from "@playwright/test";

import { field, newAccount, newPersonPage, onboard, signUpAndVerify } from "./accounts";

export const GROUP_URL = /\/groups\/([0-9a-f-]{36})(\?|$)/;
// Redirects after a Server Action can land on a route the dev server compiles
// on first use, while other workers compete for it.
export const NAVIGATION = { timeout: 30_000 };

export function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 7)}`;
}

/** Signs up and onboards someone new; ends on the dashboard. */
export async function newMember(page: Page, name: string) {
  await signUpAndVerify(page, newAccount());
  await onboard(page, name);
  await expect(page).toHaveURL(/\/dashboard$/, NAVIGATION);
}

/** Creates a group and returns its ID. Ends on the group's Expenses tab. */
export async function createGroup(page: Page, name: string, type: "Trip" | "Home" | "Couple" | "Other") {
  await page.goto("/groups/new");
  await field(page, "Group name").fill(name);
  await field(page, "Group type").selectOption({ label: type });
  await field(page, "Default currency").selectOption("INR");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(GROUP_URL, NAVIGATION);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return GROUP_URL.exec(page.url())?.[1] ?? "";
}

/** Opens a group tab ("Expenses", "Members", "Settings") from the tab bar. */
export async function openGroupTab(page: Page, tab: "Expenses" | "Members" | "Settings") {
  const sections = page.getByRole("navigation", { name: "Group sections" }).filter({ visible: true });
  await sections.getByRole("link", { name: tab }).click();
  await expect(sections.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page", NAVIGATION);
}

/** Creates a shareable invitation link on the Members tab and returns its path. */
export async function createInviteLink(page: Page) {
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = field(page, "Invite link");
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}\?group=/);
  const url = new URL(await link.inputValue());
  return `${url.pathname}${url.search}`;
}

export function members(page: Page) {
  return page.getByRole("list", { name: "Members" }).filter({ visible: true }).getByRole("listitem");
}

/**
 * Someone new opens the invitation link, signs up through it, onboards and
 * joins. Returns their page, on the group's Expenses tab.
 */
export async function joinThroughInvite(browser: Browser, invitePath: string, name: string): Promise<Page> {
  const page = await newPersonPage(browser);
  await page.goto(invitePath);
  await expect(page.getByRole("heading", { name: "You're invited" })).toBeVisible();
  await page.getByRole("link", { name: "Sign up to join" }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Finvite%2F/);

  await signUpAndVerify(page, newAccount(), { from: null });
  await expect(page).toHaveURL(/\/onboarding\?next=%2Finvite%2F/);
  await onboard(page, name);

  await expect(page).toHaveURL(/\/invite\/[A-Za-z0-9_-]+\?group=/, NAVIGATION);
  await expect(page.getByRole("heading", { name: "Join this group?" })).toBeVisible();
  await page.getByRole("button", { name: "Join group" }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}\?joined=1$/, NAVIGATION);
  return page;
}
