import { expect, type Page, test } from "@playwright/test";

import { field } from "./support/accounts";
import {
  createGroup,
  createInviteLink,
  joinThroughInvite,
  members,
  NAVIGATION,
  newMember,
  openGroupTab,
  uniqueName,
} from "./support/groups";

// SPEC §17 E2E step 3 (A adds ₹900 paid by A, split equally), then an edit and
// a cancel. Balances on the Members tab come from group_balances(), i.e. the
// ledger, so they show what the ledger holds after each step.
test.describe.configure({ timeout: 240_000 });

const EXPENSE_URL = /\/expenses\/([0-9a-f-]{36})\?saved=(created|updated)$/;

async function expectBalances(page: Page, groupId: string, expected: Record<string, string>) {
  await page.goto(`/groups/${groupId}/members`);
  for (const [name, text] of Object.entries(expected)) {
    await expect(members(page).filter({ hasText: name })).toContainText(text);
  }
}

test("A adds ₹900 split equally (E2E step 3); an edit and a cancel are reflected in balances", async ({
  page,
  browser,
}) => {
  // Steps 1–2: A, B and C in one group.
  const [asha, bina, chetan] = [uniqueName("Asha"), uniqueName("Bina"), uniqueName("Chetan")];
  await newMember(page, asha);
  const groupName = uniqueName("Goa trip");
  const groupId = await createGroup(page, groupName, "Trip");
  await openGroupTab(page, "Members");
  const invitePath = await createInviteLink(page);
  const binaPage = await joinThroughInvite(browser, invitePath, bina);
  const chetanPage = await joinThroughInvite(browser, invitePath, chetan);
  await chetanPage.context().close();

  // Step 3: A adds ₹900 paid by A, split equally between A, B and C.
  await page.goto(`/groups/${groupId}`);
  await page.getByRole("main").getByRole("link", { name: "Add expense" }).click();
  await expect(page).toHaveURL(new RegExp(`/expenses/new\\?group=${groupId}$`), NAVIGATION);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`);
  const save = page.getByRole("button", { name: "Save expense" });
  await expect(save).toBeDisabled();

  await field(page, "Description").fill("Dinner at the shack");
  await field(page, "Amount").fill("900");
  await field(page, "Category").selectOption({ label: "Food and drink" });
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("list", { name: "Shares" }).getByRole("listitem")).toHaveCount(3);
  await expect(preview.getByText(`${bina} owes ${asha} (you) ₹300.00`)).toBeVisible();
  await expect(preview.getByText(`${chetan} owes ${asha} (you) ₹300.00`)).toBeVisible();
  await save.click();

  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  const expenseId = EXPENSE_URL.exec(page.url())?.[1] ?? "";
  await expect(page.getByRole("heading", { level: 1, name: "Dinner at the shack" })).toBeVisible();
  await expect(page.getByText("₹900.00").first()).toBeVisible();
  const shares = page.getByRole("list", { name: "Shares" });
  for (const name of ["You", bina, chetan]) {
    await expect(shares.getByRole("listitem").filter({ hasText: name })).toContainText("₹300.00");
  }
  await expect(page.getByRole("list", { name: "History" })).toContainText(`${asha} added this expense`);

  await expectBalances(page, groupId, {
    [`${asha} (you)`]: "you are owed ₹600.00",
    [bina]: "owes ₹300.00",
    [chetan]: "owes ₹300.00",
  });

  // B sees the expense in the group list, with their part.
  await binaPage.goto(`/groups/${groupId}`);
  const binaRow = binaPage.getByRole("list", { name: "Group expenses" }).getByRole("listitem");
  await expect(binaRow).toHaveCount(1);
  await expect(binaRow).toContainText("Dinner at the shack");
  await expect(binaRow).toContainText(`${asha} paid ₹900.00`);
  await expect(binaRow).toContainText("You borrowed ₹300.00");

  // B comments.
  await binaRow.getByRole("link").click();
  await field(binaPage, "Add a comment").fill("Thanks for paying!");
  await binaPage.getByRole("button", { name: "Post comment" }).click();
  await expect(binaPage.getByRole("list", { name: "Comments" })).toContainText("Thanks for paying!");

  // Edit: ₹1,200, B takes 50%, A and C 25% each.
  await page.goto(`/expenses/${expenseId}`);
  await expect(page.getByRole("list", { name: "Comments" })).toContainText("Thanks for paying!");
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible(NAVIGATION);
  await expect(field(page, "Amount")).toHaveValue("900.00");
  await field(page, "Amount").fill("1200");
  await page.locator("label", { hasText: "Percentages" }).click();
  await field(page, `${asha}'s percentage`).fill("25");
  await field(page, `${bina}'s percentage`).fill("50");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await field(page, `${chetan}'s percentage`).fill("25");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  await expect(page.getByText("Changes saved.")).toBeVisible();
  const history = page.getByRole("list", { name: "History" });
  await expect(history).toContainText(`${asha} edited it`);
  await expect(history).toContainText("Amount");
  await expect(history).toContainText("₹900.00");
  await expect(history).toContainText("₹1,200.00");

  await expectBalances(page, groupId, {
    [`${asha} (you)`]: "you are owed ₹900.00",
    [bina]: "owes ₹600.00",
    [chetan]: "owes ₹300.00",
  });

  // Cancel: the edit's charges are reversed and everyone is settled up.
  await page.goto(`/expenses/${expenseId}`);
  await page.getByRole("button", { name: "Cancel expense" }).click();
  await page.getByRole("group", { name: /Cancel this expense/ }).getByRole("button", { name: "Cancel expense" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "History" })).toContainText(`${asha} cancelled it`);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  await expectBalances(page, groupId, {
    [`${asha} (you)`]: "Settled up",
    [bina]: "Settled up",
    [chetan]: "Settled up",
  });
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole("list", { name: "Group expenses" })).toContainText("Cancelled");

  // Duplicate the cancelled expense: a new ₹1,200 expense with the same split.
  await page.goto(`/expenses/${expenseId}`);
  await page.getByRole("link", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "Duplicate expense" })).toBeVisible(NAVIGATION);
  await expect(field(page, "Description")).toHaveValue("Dinner at the shack");
  await expect(field(page, `${bina}'s percentage`)).toHaveValue("50");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  expect(EXPENSE_URL.exec(page.url())?.[1]).not.toBe(expenseId);

  await expectBalances(page, groupId, {
    [`${asha} (you)`]: "you are owed ₹900.00",
    [bina]: "owes ₹600.00",
    [chetan]: "owes ₹300.00",
  });
  await binaPage.context().close();
});

test("a direct expense with a friend, split by exact amounts", async ({ page, browser }) => {
  const [asha, bina] = [uniqueName("Asha"), uniqueName("Bina")];
  await newMember(page, asha);
  await createGroup(page, uniqueName("Flat"), "Home");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), bina);
  await binaPage.context().close();

  // From the friend page: Bina paid ₹500, Asha's part is ₹350.
  await page.goto("/friends");
  await page.getByRole("link", { name: new RegExp(bina) }).click();
  await page.getByRole("main").getByRole("link", { name: "Add expense" }).click();
  await expect(page.getByRole("heading", { name: "Add expense" })).toBeVisible(NAVIGATION);
  await expect(page.getByRole("checkbox", { name: `Include ${bina}` })).toBeVisible();
  await field(page, "Description").fill("Taxi");
  await field(page, "Amount").fill("500");
  await field(page, "Paid by").selectOption({ label: bina });
  await page.locator("label", { hasText: "Exact amounts" }).click();
  await field(page, `${asha}'s share`).fill("350");
  await expect(page.getByText("₹150.00 is left to assign.").first()).toBeVisible();
  await field(page, `${bina}'s share`).fill("150");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  await expect(page.getByText(/· Direct expense/).filter({ visible: true })).toBeVisible();

  // The friend balance comes from the ledger: Asha owes Bina ₹350.
  await page.goto("/friends");
  await expect(page.getByRole("link", { name: new RegExp(bina) })).toContainText("you owe ₹350.00");
});
