import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { field, newAccount, newPersonPage, onboard, signUpAndVerify } from "./support/accounts";
import { apiClientFor } from "./support/api";
import {
  createGroup,
  createInviteLink,
  joinThroughInvite,
  NAVIGATION,
  newMember,
  openGroupTab,
  uniqueName,
} from "./support/groups";

// SPEC §17 E2E steps 4–9: dashboards, a payer-recorded repayment confirmed by
// the receiver, a percentage expense, everyone's history, and an outsider (D)
// denied in the UI and through direct API/RPC calls. Steps 1–3 set the scene.
test.describe.configure({ timeout: 300_000 });

const EXPENSE_URL = /\/expenses\/([0-9a-f-]{36})\?saved=created$/;
const SETTLEMENT_URL = /\/settlements\/([0-9a-f-]{36})\?saved=(paid|received)$/;

async function expectNet(page: Page, net: string) {
  await page.goto("/dashboard");
  await expect(page.getByRole("group", { name: "Net balance" })).toContainText(net);
}

/** Adds a group expense paid by the page's user; `percentages` switches to a percentage split. */
async function addExpense(
  page: Page,
  groupId: string,
  description: string,
  amount: string,
  percentages?: Record<string, string>,
) {
  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill(description);
  await field(page, "Amount").fill(amount);
  if (percentages) {
    await page.locator("label", { hasText: "Percentages" }).click();
    for (const [name, percent] of Object.entries(percentages)) {
      await field(page, `${name}'s percentage`).fill(percent);
    }
  }
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  return EXPENSE_URL.exec(page.url())?.[1] ?? "";
}

test("dashboards, a confirmed repayment, a percentage expense, history, and an outsider denied (E2E steps 4–9)", async ({
  page,
  browser,
}) => {
  // Steps 1–3: A creates a group, B and C join, A adds ₹900 split equally.
  const [asha, bina, chetan, dev] = ["Asha", "Bina", "Chetan", "Dev"].map(uniqueName) as [string, string, string, string];
  await newMember(page, asha);
  const groupId = await createGroup(page, uniqueName("Goa trip"), "Trip");
  await openGroupTab(page, "Members");
  const invitePath = await createInviteLink(page);
  const binaPage = await joinThroughInvite(browser, invitePath, bina);
  const chetanPage = await joinThroughInvite(browser, invitePath, chetan);
  const dinnerId = await addExpense(page, groupId, "Dinner at the shack", "900");

  // Step 4: dashboards show A +₹600, B −₹300, C −₹300.
  await expectNet(page, "+₹600.00");
  await expect(page.getByRole("group", { name: "You are owed" })).toContainText("₹600.00");
  const people = page.getByRole("list", { name: "Balances by person" }).getByRole("listitem");
  await expect(people.filter({ hasText: bina })).toContainText("owes you ₹300.00");
  await expect(people.filter({ hasText: chetan })).toContainText("owes you ₹300.00");
  await expectNet(binaPage, "-₹300.00");
  await expectNet(chetanPage, "-₹300.00");

  // Step 5: B records a ₹100 repayment to A from the simplified suggestions; it waits for A.
  await binaPage.goto(`/groups/${groupId}/balances`);
  await expect(binaPage.getByText("Simplified", { exact: true }).filter({ visible: true })).toBeVisible();
  const suggestions = binaPage.getByRole("list", { name: "Suggested repayments" });
  await expect(suggestions).toContainText(`You pay ${asha} ₹300.00`);
  await suggestions.getByRole("link", { name: "Record payment" }).click();
  await expect(binaPage.getByRole("heading", { name: "Settle up" })).toBeVisible(NAVIGATION);
  await expect(field(binaPage, "Amount")).toHaveValue("300.00");
  await expect(binaPage.getByRole("radio", { name: `I paid ${asha}` })).toBeChecked();
  await field(binaPage, "Amount").fill("100");
  await field(binaPage, "Paid with").selectOption({ label: "UPI (recorded manually)" });
  await field(binaPage, "UPI reference (optional)").fill("UPI-E2E-0001");
  await binaPage.getByRole("button", { name: "Record payment" }).click();
  await expect(binaPage).toHaveURL(SETTLEMENT_URL, NAVIGATION);
  const settlementId = SETTLEMENT_URL.exec(binaPage.url())?.[1] ?? "";
  await expect(binaPage.getByText("Payment recorded. It counts once the receiver confirms it.")).toBeVisible();
  await expect(binaPage.getByRole("heading", { level: 1 })).toHaveText(`You paid ${asha} ₹100.00`);
  await expect(binaPage.getByText(`Waiting for ${asha} to confirm. Balances change once they do.`)).toBeVisible();
  await expectNet(binaPage, "-₹300.00");

  // A confirms it from the dashboard.
  await page.goto("/dashboard");
  const waiting = page.getByRole("list", { name: "Waiting for you" });
  await expect(waiting).toContainText(`${bina} paid you ₹100.00`);
  await waiting.getByRole("button", { name: `Confirm ₹100.00 from ${bina}` }).click();
  await expect(page.getByRole("list", { name: "Waiting for you" })).toHaveCount(0);

  // Step 6: A +₹500, B −₹200, C −₹300.
  await expectNet(page, "+₹500.00");
  await expectNet(binaPage, "-₹200.00");
  await expectNet(chetanPage, "-₹300.00");
  await binaPage.goto(`/settlements/${settlementId}`);
  await expect(binaPage.getByText("Completed", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(binaPage.getByRole("list", { name: "History" })).toContainText(`${asha} confirmed your payment of ₹100.00`);

  // Step 7: A adds ₹1,000 by percentage (A 20%, B 30%, C 50%): A +₹1,300, B −₹500, C −₹800.
  const groceriesId = await addExpense(page, groupId, "Groceries", "1000", { [asha]: "20", [bina]: "30", [chetan]: "50" });
  await page.goto(`/groups/${groupId}/balances`);
  const memberBalances = page.getByRole("list", { name: "Member balances" }).getByRole("listitem");
  await expect(memberBalances.filter({ hasText: asha })).toContainText("you are owed ₹1,300.00");
  await expect(memberBalances.filter({ hasText: bina })).toContainText("owes ₹500.00");
  await expect(memberBalances.filter({ hasText: chetan })).toContainText("owes ₹800.00");
  const ashaSuggestions = page.getByRole("list", { name: "Suggested repayments" });
  await expect(ashaSuggestions).toContainText(`${chetan} pays you ₹800.00`);
  await expect(ashaSuggestions).toContainText(`${bina} pays you ₹500.00`);
  await expectNet(page, "+₹1,300.00");
  await expectNet(binaPage, "-₹500.00");
  await expectNet(chetanPage, "-₹800.00");

  // Step 8: each member views their expense history.
  const history: [Page, string[]][] = [
    [
      page,
      [
        "You added “Groceries” (₹1,000.00)",
        `You confirmed ${bina}'s payment of ₹100.00`,
        `${bina} recorded paying you ₹100.00`,
        "You added “Dinner at the shack” (₹900.00)",
      ],
    ],
    [binaPage, [`${asha} added “Groceries” (₹1,000.00)`, `You recorded paying ${asha} ₹100.00`, "You owe ₹300.00"]],
    [chetanPage, [`${asha} added “Groceries” (₹1,000.00)`, "You owe ₹500.00", `${bina} recorded paying ${asha} ₹100.00`]],
  ];
  for (const [memberPage, lines] of history) {
    await memberPage.goto("/activity");
    const activity = memberPage.getByRole("list", { name: "Activity" });
    for (const line of lines) await expect(activity).toContainText(line);
    await memberPage.goto(`/groups/${groupId}`);
    const expenses = memberPage.getByRole("list", { name: "Group expenses" }).getByRole("listitem");
    await expect(expenses).toHaveCount(2);
  }
  await chetanPage.goto(`/expenses/${groceriesId}`);
  await expect(chetanPage.getByRole("list", { name: "History" })).toContainText(`${asha} added this expense`);
  await binaPage.context().close();
  await chetanPage.context().close();

  // Step 9: D, a signed-up stranger, cannot reach the group's pages…
  const devPage = await newPersonPage(browser);
  const devAccount = newAccount();
  await signUpAndVerify(devPage, devAccount);
  await onboard(devPage, dev);
  await expect(devPage).toHaveURL(/\/dashboard$/, NAVIGATION);
  for (const path of [
    `/groups/${groupId}`,
    `/groups/${groupId}/balances`,
    `/groups/${groupId}/members`,
    `/groups/${groupId}/settings`,
    `/expenses/${dinnerId}`,
    `/expenses/${groceriesId}/edit`,
    `/settlements/${settlementId}`,
    `/settle-up?group=${groupId}`,
  ]) {
    await devPage.goto(path);
    await expect(devPage.getByRole("heading", { name: "Page not found" }), path).toBeVisible(NAVIGATION);
  }
  await devPage.goto("/activity");
  await expect(devPage.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  await devPage.goto("/dashboard");
  await expect(devPage.getByRole("heading", { name: "No balances yet" })).toBeVisible();
  await devPage.context().close();

  // …nor its data through direct API and RPC calls with their own session.
  const api = await apiClientFor(devAccount);
  expect((await api.from("groups").select("id").eq("id", groupId)).data).toEqual([]);
  for (const table of ["group_members", "expenses", "ledger_entries", "settlements", "audit_events"] as const) {
    const { data, error } = await api.from(table).select("*").eq("group_id", groupId);
    expect(error, table).toBeNull();
    expect(data, table).toEqual([]);
  }
  expect((await api.from("settlements").select("id").eq("id", settlementId)).data).toEqual([]);
  expect((await api.rpc("group_balances", { p_group_id: groupId })).data).toEqual([]);
  expect((await api.rpc("group_pairwise_balances", { p_group_id: groupId })).data).toEqual([]);

  const { data: me } = await api.auth.getUser();
  const devId = me.user?.id ?? "";
  expect(devId).not.toBe("");
  const settle = await api.rpc("create_settlement", {
    p_idempotency_key: randomUUID(),
    p_group_id: groupId,
    p_payer_id: devId,
    p_receiver_id: randomUUID(),
    p_amount: 10000,
    p_currency: "INR",
  });
  expect(settle.error?.code).toMatch(/^SM40[34]$/);
  for (const fn of ["confirm_settlement", "reject_settlement", "cancel_settlement"] as const) {
    expect((await api.rpc(fn, { p_settlement_id: settlementId })).error?.code, fn).toBe("SM404");
  }
  const cancelExpense = await api.rpc("cancel_expense", { p_expense_id: dinnerId, p_expected_version: 1 });
  expect(cancelExpense.error?.code).toMatch(/^SM40[34]$/);
  const leave = await api.rpc("leave_group", { p_group_id: groupId });
  expect(leave.error?.code).toMatch(/^SM40[34]$/);

  // A's balances are untouched by all of that.
  await expectNet(page, "+₹1,300.00");
});

test("settle up everything with a friend; the friend rejects one part; a completed one is cancelled", async ({
  page,
  browser,
}) => {
  const [asha, bina] = [uniqueName("Asha"), uniqueName("Bina")];
  await newMember(page, asha);
  const groupName = uniqueName("Flat");
  const groupId = await createGroup(page, groupName, "Home");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), bina);

  // In the group, Bina owes Asha ₹450. Directly, Asha owes Bina ₹250.
  await addExpense(page, groupId, "Electricity", "900");
  await binaPage.goto("/friends");
  await binaPage.getByRole("link", { name: new RegExp(asha) }).click();
  await binaPage.getByRole("main").getByRole("link", { name: "Add expense" }).click();
  await expect(binaPage.getByRole("heading", { name: "Add expense" })).toBeVisible(NAVIGATION);
  await field(binaPage, "Description").fill("Taxi");
  await field(binaPage, "Amount").fill("500");
  await binaPage.getByRole("button", { name: "Save expense" }).click();
  await expect(binaPage).toHaveURL(EXPENSE_URL, NAVIGATION);

  // Asha's friend page: ₹200 overall, by group and direct.
  await page.goto("/friends");
  await page.getByRole("link", { name: new RegExp(bina) }).click();
  await expect(page.getByRole("heading", { level: 1, name: bina })).toBeVisible(NAVIGATION);
  const byGroup = page.getByRole("list", { name: "Balance by group" });
  await expect(byGroup).toContainText(`${groupName}: owes you ₹450.00`);
  await expect(byGroup).toContainText("Outside groups: you owe ₹250.00");
  const plan = page.getByRole("list", { name: "What will be settled" });
  await expect(plan).toContainText(`${bina} pays you ₹450.00 in ${groupName}`);
  await expect(plan).toContainText(`You pay ${bina} ₹250.00 outside groups`);
  await page.getByRole("button", { name: "Settle up everything" }).click();
  await expect(page.getByText("Recorded 2 settlements.", { exact: false })).toBeVisible();
  // The group part completed at once; the direct part waits for Bina.
  await expect(page.getByRole("list", { name: "Balance by group" })).toContainText("Outside groups: you owe ₹250.00");
  const between = page.getByRole("list", { name: "Settlements with friend" }).getByRole("listitem");
  await expect(between).toHaveCount(2);
  await expect(between.filter({ hasText: `${bina} paid you ₹450.00` })).toContainText("Completed");
  await expect(between.filter({ hasText: `You paid ${bina} ₹250.00` })).toContainText("Pending");

  // Bina rejects the ₹250: balances stay as they were.
  await binaPage.goto("/settlements");
  const toConfirm = binaPage.getByRole("list", { name: "Waiting for you" });
  await expect(toConfirm).toContainText(`${asha} paid you ₹250.00`);
  await toConfirm.getByRole("button", { name: "Reject" }).click();
  await binaPage.getByRole("group", { name: /Reject this payment/ }).getByRole("button", { name: "Reject payment" }).click();
  await expect(binaPage.getByRole("list", { name: "Waiting for you" })).toHaveCount(0);
  await expect(binaPage.getByRole("list", { name: "Settlement history" })).toContainText("Rejected");

  // Asha cancels the completed ₹450: it is reversed and Bina owes ₹200 overall again.
  await page.reload();
  await page
    .getByRole("list", { name: "Settlements with friend" })
    .getByRole("link", { name: new RegExp(`${bina} paid you ₹450.00`) })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${bina} paid you ₹450.00`, NAVIGATION);
  await page.getByRole("button", { name: "Cancel settlement" }).click();
  await page.getByRole("group", { name: /Cancel this settlement/ }).getByRole("button", { name: "Cancel settlement" }).click();
  await expect(page.getByText("Cancelled", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "History" })).toContainText(
    `You cancelled the ₹450.00 payment from ${bina} to you`,
  );
  await page.goto("/friends");
  await expect(page.getByRole("link", { name: new RegExp(bina) })).toContainText("owes you ₹200.00");

  // With simplify-debts off, the Balances tab no longer says "simplified".
  await page.goto(`/groups/${groupId}/settings`);
  await page.getByRole("checkbox", { name: "Simplify debts" }).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Group settings saved.")).toBeVisible(NAVIGATION);
  await page.goto(`/groups/${groupId}/balances`);
  await expect(page.getByRole("heading", { name: "Suggested repayments" })).toBeVisible();
  await expect(page.getByText("Simplified", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Suggested repayments" })).toContainText(`${bina} pays you ₹450.00`);
  await binaPage.context().close();
});
