import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

import { field, newPersonPage } from "./support/accounts";
import { createGroup, createInviteLink, joinThroughInvite, NAVIGATION, newMember, openGroupTab, uniqueName } from "./support/groups";

// M8: Bina's expense notifies Asha (badge, list, mark read), Asha turns that
// type off, analytics shows her share with a table view and prints without the
// app chrome, the CSV export holds her rows only, and search stays within what
// each person can see.

const EXPENSE_URL = /\/expenses\/([0-9a-f-]{36})\?saved=created$/;

async function addExpense(page: Page, groupId: string, description: string, amount: string) {
  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill(description);
  await field(page, "Amount").fill(amount);
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
}

/** The unread count as the visible navigation shows it: the phone's bell or the sidebar link. */
function unreadLink(page: Page, isMobile: boolean, count: number | null) {
  if (isMobile) {
    return page.getByRole("link", { name: count ? `Notifications, ${count} unread` : "Notifications", exact: true });
  }
  return page
    .getByRole("navigation", { name: "Main" })
    .filter({ visible: true })
    .getByRole("link", { name: count ? `Notifications ${count} unread` : "Notifications", exact: true });
}

async function downloadCsv(page: Page, name: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name }).click()]);
  return readFile(await download.path(), "utf8");
}

test("notifications, preferences, analytics, export and search", async ({ page, browser, isMobile }) => {
  test.setTimeout(240_000);
  const asha = uniqueName("Asha");
  const bina = uniqueName("Bina");
  const trip = uniqueName("Trip");
  await newMember(page, asha);
  const groupId = await createGroup(page, trip, "Trip");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), bina);

  // ---------------------------------------------------------------- notifications
  // Asha hears that Bina joined through her invitation, and about the expense.
  await addExpense(binaPage, groupId, "Dinner", "900");
  await page.goto("/dashboard");
  await expect(unreadLink(page, isMobile, 2)).toBeVisible(NAVIGATION);

  await unreadLink(page, isMobile, 2).click();
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible(NAVIGATION);
  const list = page.getByRole("list", { name: "Notifications" });
  const dinner = list.getByRole("link", { name: `Unread: ${bina} added “Dinner” (₹900.00) in ${trip}` });
  await expect(dinner).toContainText("Unread");
  await expect(list.getByRole("link", { name: new RegExp(`${bina} joined ${trip}`) })).toContainText("Unread");
  await expect(page.getByText("2 unread notifications.")).toBeVisible();

  // Following one marks it read and opens the expense.
  await dinner.click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/, NAVIGATION);
  await expect(unreadLink(page, isMobile, 1)).toBeVisible(NAVIGATION);
  await page.goto("/notifications");
  await expect(page.getByText("1 unread notification.")).toBeVisible(NAVIGATION);
  await expect(page.getByRole("button", { name: /^Mark read/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("You're all caught up.")).toBeVisible(NAVIGATION);
  await expect(page.getByRole("button", { name: /^Mark read/ })).toHaveCount(0);
  await expect(unreadLink(page, isMobile, null)).toBeVisible(NAVIGATION);

  // Turning new-expense notifications off stops the next one.
  await page.getByRole("link", { name: "Choose what you get" }).click();
  const newExpenses = page.getByRole("checkbox", { name: "Someone adds an expense you're part of" });
  await expect(newExpenses).toBeChecked(NAVIGATION);
  await newExpenses.uncheck();
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible(NAVIGATION);

  await addExpense(binaPage, groupId, "Taxi", "300");
  await page.goto("/notifications");
  await expect(page.getByText("You're all caught up.")).toBeVisible(NAVIGATION);
  await expect(list.getByText(/Taxi/)).toHaveCount(0);

  // ---------------------------------------------------------------- analytics
  await page.goto("/analytics?range=this-month");
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible(NAVIGATION);
  // ₹450 of Dinner + ₹150 of Taxi; Asha paid nothing; repayments are separate.
  await expect(page.getByRole("group", { name: "Your spending (your share)" })).toContainText("₹600.002 expenses");
  await expect(page.getByRole("group", { name: "You paid" })).toContainText("₹0.00Others paid ₹600.00 of your share");
  await expect(page.getByRole("group", { name: "Repayments you made" })).toContainText("₹0.00");

  const byCategory = page.getByRole("region", { name: "Spending by category" });
  await byCategory.getByRole("button", { name: "Table" }).click();
  const table = byCategory.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /Uncategorised ₹600\.00 ₹0\.00 2/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Total ₹600\.00/ })).toBeVisible();

  // Printing: no navigation, every table shown.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Spending by group" }).getByRole("table")).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // ---------------------------------------------------------------- export
  const csv = await downloadCsv(page, "Expenses CSV");
  const rows = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  expect(rows[0]).toBe(
    "Date,Description,Category,Group,Currency,Total,You paid,Your share,Your net (paid minus share),From a recurring expense,Expense ID",
  );
  expect(rows.slice(1).map((row) => row.split(",").slice(1, 9))).toEqual(
    expect.arrayContaining([
      ["Dinner", "", trip, "INR", "900.00", "0.00", "450.00", "-450.00"],
      ["Taxi", "", trip, "INR", "300.00", "0.00", "150.00", "-150.00"],
    ]),
  );
  expect(rows).toHaveLength(3);

  // ---------------------------------------------------------------- search
  await page.goto("/search");
  await field(page, "Search for").fill("taxi");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search\?q=taxi$/, NAVIGATION);
  await expect(page.getByRole("list", { name: "Matching expenses" }).getByText("Taxi")).toBeVisible();
  await page.goto(`/search?q=${encodeURIComponent(bina.split(" ")[1] ?? "")}`);
  await expect(page.getByRole("list", { name: "Matching friends" }).getByText(bina)).toBeVisible(NAVIGATION);

  // ---------------------------------------------------------------- an outsider
  const outsider = await newPersonPage(browser);
  await newMember(outsider, uniqueName("Chitra"));
  await outsider.goto(`/search?q=taxi`);
  await expect(outsider.getByRole("heading", { name: "No matches" })).toBeVisible(NAVIGATION);
  await outsider.goto("/analytics?range=this-month");
  await expect(outsider.getByRole("heading", { name: "Nothing in this period" })).toBeVisible(NAVIGATION);
  const theirs = await downloadCsv(outsider, "Expenses CSV");
  expect(theirs.replace(/^﻿/, "").trimEnd().split("\r\n")).toHaveLength(1); // header only

  await outsider.context().close();
  await binaPage.context().close();
});
