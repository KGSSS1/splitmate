import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { field, logIn, newAccount, newPersonPage, onboard, signUpAndVerify } from "./support/accounts";
import { createGroup, createInviteLink, joinThroughInvite, NAVIGATION, newMember, openGroupTab, uniqueName } from "./support/groups";

// M9: PWA files load without a session, the offline banner, the data export and
// account deletion (refused with an open balance, then done and signed out).

test("PWA files are public and the service worker is never cached", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const data = (await manifest.json()) as { display: string; icons: { purpose?: string }[] };
  expect(data.display).toBe("standalone");
  expect(data.icons.some((icon) => icon.purpose === "maskable")).toBe(true);

  const worker = await request.get("/sw.js", { maxRedirects: 0 });
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("application/javascript");
  expect(worker.headers()["cache-control"]).toBe("no-cache, no-store, must-revalidate");

  const offline = await request.get("/offline.html", { maxRedirects: 0 });
  expect(offline.status()).toBe(200);
  expect(await offline.text()).toContain("You're offline");
});

test("the offline banner follows the connection", async ({ page, context }) => {
  await newMember(page, uniqueName("Asha"));
  await context.setOffline(true);
  await expect(page.getByText("You're offline. You can look around, but nothing can be saved")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You're offline.")).toHaveCount(0);
});

test("data export and account deletion", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const asha = uniqueName("Asha");
  const bina = uniqueName("Bina");
  await newMember(page, asha);
  const groupId = await createGroup(page, uniqueName("Home"), "Home");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), bina);

  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill("Groceries");
  await field(page, "Amount").fill("400");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}\?saved=created$/, NAVIGATION);

  // ---------------------------------------------------------------- export
  await page.goto("/settings#your-data");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download everything (JSON)" }).click(),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), "utf8")) as {
    data: { profile: { display_name: string }[]; expenses: { description: string }[] };
    people: Record<string, string>;
  };
  expect(exported.data.profile[0]?.display_name).toBe(asha);
  expect(exported.data.expenses.map((row) => row.description)).toContain("Groceries");
  expect(Object.values(exported.people)).toContain(bina);

  // ---------------------------------------------------------------- deletion refused
  await binaPage.goto("/settings#delete-account");
  await field(binaPage, "Type DELETE to confirm").fill("DELETE");
  await binaPage.getByRole("button", { name: "Delete my account" }).click();
  await expect(binaPage.getByText("Settle up first: you still have a balance in a group.")).toBeVisible(NAVIGATION);
  await binaPage.context().close();

  // ---------------------------------------------------------------- deletion done
  const chitraPage = await newPersonPage(browser);
  const chitra = newAccount();
  await signUpAndVerify(chitraPage, chitra);
  await onboard(chitraPage, uniqueName("Chitra"));
  await expect(chitraPage).toHaveURL(/\/dashboard$/, NAVIGATION);
  await chitraPage.goto("/settings#delete-account");
  await field(chitraPage, "Type DELETE to confirm").fill("delete");
  await chitraPage.getByRole("button", { name: "Delete my account" }).click();
  await expect(chitraPage.getByText("Type DELETE to confirm.")).toBeVisible();
  await field(chitraPage, "Type DELETE to confirm").fill("DELETE");
  await chitraPage.getByRole("button", { name: "Delete my account" }).click();
  await expect(chitraPage).toHaveURL(/\/account-deleted$/, NAVIGATION);
  await expect(chitraPage.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();

  // Signed out, and the account no longer exists.
  await chitraPage.goto("/dashboard");
  await expect(chitraPage).toHaveURL(/\/login\?next=%2Fdashboard$/, NAVIGATION);
  await logIn(chitraPage, chitra);
  await expect(chitraPage.getByText("Incorrect email or password.")).toBeVisible(NAVIGATION);
  await chitraPage.context().close();
});
