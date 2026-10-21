import { expect, test } from "@playwright/test";

import { field, newAccount, newPersonPage, onboard, signUpAndVerify } from "./support/accounts";
import {
  createGroup,
  createInviteLink,
  members,
  NAVIGATION,
  newMember,
  openGroupTab,
  uniqueName,
} from "./support/groups";

// SPEC §17 E2E steps 1–2, plus invitation token misuse. Runs against local
// Supabase (emails from Mailpit). Several people sign up in one test, each in
// their own browser context.
test.describe.configure({ timeout: 180_000 });

test("A creates a group; B and C sign up from the invite link and join (E2E steps 1–2)", async ({
  page,
  browser,
}) => {
  // Step 1: A signs up and creates a group.
  const asha = uniqueName("Asha");
  await newMember(page, asha);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Groups" }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole("heading", { name: "No groups yet" })).toBeVisible();

  const groupName = uniqueName("Goa trip");
  const groupId = await createGroup(page, groupName, "Trip");
  await expect(page.getByText("Trip · INR · Debts simplified")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No expenses yet" })).toBeVisible();
  await openGroupTab(page, "Members");
  await expect(members(page)).toHaveCount(1);
  await expect(members(page).first()).toContainText(`${asha} (you)`);
  await expect(members(page).first()).toContainText("Admin");
  await expect(members(page).first()).toContainText("Settled up");

  // Step 2: A invites B and C with one link; each signs up through it and joins.
  const invitePath = await createInviteLink(page);
  const others = [uniqueName("Bina"), uniqueName("Chetan")];
  for (const name of others) {
    const other = await newPersonPage(browser);
    await other.goto(invitePath);
    await expect(other.getByRole("heading", { name: "You're invited" })).toBeVisible();
    await other.getByRole("link", { name: "Sign up to join" }).click();
    await expect(other).toHaveURL(/\/signup\?next=%2Finvite%2F/);

    await signUpAndVerify(other, newAccount(), { from: null });
    await expect(other).toHaveURL(/\/onboarding\?next=%2Finvite%2F/);
    await onboard(other, name);

    await expect(other).toHaveURL(new RegExp(`/invite/[A-Za-z0-9_-]+\\?group=${groupId}$`), NAVIGATION);
    await expect(other.getByRole("heading", { name: "Join this group?" })).toBeVisible();
    await expect(other.getByText(groupName)).toBeVisible();
    await expect(other.getByText(`${asha} invited you.`, { exact: false })).toBeVisible();
    await other.getByRole("button", { name: "Join group" }).click();

    await expect(other).toHaveURL(new RegExp(`/groups/${groupId}\\?joined=1$`), NAVIGATION);
    await expect(other.getByText(`You joined ${groupName}.`)).toBeVisible();
    await openGroupTab(other, "Members");
    await expect(members(other).filter({ hasText: asha })).toHaveCount(1);
    await expect(members(other).filter({ hasText: `${name} (you)` })).toHaveCount(1);

    // Joining made them friends with everyone already in the group.
    await other.goto("/friends");
    await expect(other.getByRole("link", { name: new RegExp(asha) })).toBeVisible();
    await other.context().close();
  }

  // A sees all three members, all settled up, and the link's use count.
  await page.reload();
  await expect(members(page)).toHaveCount(3);
  for (const name of [asha, ...others]) {
    await expect(members(page).filter({ hasText: name })).toContainText("Settled up");
  }
  await expect(page.getByRole("list", { name: "Open invitations" })).toContainText("2 of 10 used");

  // ...and both new members as friends, with a ledger-backed (zero) balance.
  await page.goto("/friends");
  for (const name of others) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toContainText("Settled up");
  }
  await page.getByRole("link", { name: new RegExp(others[0] ?? "") }).click();
  await expect(page.getByRole("heading", { level: 1, name: others[0] })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(groupName) })).toBeVisible();
});

test("an invite token cannot be used for a different group, and fails after revocation", async ({
  page,
  browser,
}) => {
  // A has two groups and an invite link for the first one.
  await newMember(page, uniqueName("Asha"));
  const alpha = uniqueName("Alpha");
  const alphaId = await createGroup(page, alpha, "Home");
  await openGroupTab(page, "Members");
  const invitePath = await createInviteLink(page);
  const betaId = await createGroup(page, uniqueName("Beta"), "Other");
  const token = /\/invite\/([^?]+)/.exec(invitePath)?.[1] ?? "";

  // The admin edits the group's settings: name, type, currency, simplify debts.
  await openGroupTab(page, "Settings");
  await expect(field(page, "Group name")).toHaveValue(/^Beta /);
  await field(page, "Group name").fill("Beta flat");
  await field(page, "Group type").selectOption({ label: "Couple" });
  await field(page, "Default currency").selectOption("USD");
  await field(page, "Simplify debts").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Group settings saved.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Beta flat" })).toBeVisible();
  await expect(page.getByText("Couple · USD · Debts not simplified")).toBeVisible();

  // D is signed up but in no group.
  const dave = await newPersonPage(browser);
  await newMember(dave, uniqueName("Dave"));

  // The token presented for Beta is refused, and nothing about either group is shown.
  await dave.goto(`/invite/${token}?group=${betaId}`);
  await expect(dave.getByRole("heading", { name: "Invitation can't be used" })).toBeVisible();
  await expect(dave.getByText("This invitation link isn't valid for this group.")).toBeVisible();
  await expect(dave.getByText(alpha)).toHaveCount(0);
  await expect(dave.getByRole("button", { name: "Join group" })).toHaveCount(0);

  // The genuine link works for Alpha — until A revokes it.
  await dave.goto(invitePath);
  await expect(dave.getByRole("heading", { name: "Join this group?" })).toBeVisible();
  await expect(dave.getByText(alpha)).toBeVisible();

  await page.goto(`/groups/${alphaId}/members`);
  const invitations = page.getByRole("list", { name: "Open invitations" });
  await expect(invitations.getByRole("listitem")).toHaveCount(1);
  await invitations.getByRole("button", { name: "Revoke" }).click();
  await invitations.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("list", { name: "Open invitations" })).toHaveCount(0);

  // D's open page still offers to join, but the server refuses the revoked token.
  await dave.getByRole("button", { name: "Join group" }).click();
  // (Next's route announcer is also an alert, so match by text.)
  await expect(dave.getByRole("alert").filter({ hasText: "revoked" })).toHaveText("This invitation has been revoked.");
  await dave.reload();
  await expect(dave.getByRole("heading", { name: "Invitation can't be used" })).toBeVisible();
  await expect(dave.getByText("This invitation has been revoked.", { exact: false })).toBeVisible();

  // D joined neither group and cannot open them.
  await dave.goto("/groups");
  await expect(dave.getByRole("heading", { name: "No groups yet" })).toBeVisible();
  for (const id of [alphaId, betaId]) {
    await dave.goto(`/groups/${id}`);
    await expect(dave.getByRole("heading", { name: "Page not found" })).toBeVisible();
  }
  await dave.context().close();
});
