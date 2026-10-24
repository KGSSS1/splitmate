import { expect, type Page, test } from "@playwright/test";

import { field, newPersonPage } from "./support/accounts";
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

// M7: a monthly expense set up from the Add expense form (today's one is added
// straight away), paused, resumed, edited for the future and cancelled; and
// receipts uploaded, opened and refused to an outsider.
test.describe.configure({ timeout: 240_000 });

const RECURRING_URL = /\/recurring\/([0-9a-f-]{36})\?saved=(created|updated)$/;
const EXPENSE_URL = /\/expenses\/([0-9a-f-]{36})\?saved=created$/;

// A 1×1 PNG and a minimal PDF.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

async function outsiderPage(page: Page): Promise<Page> {
  const outsider = await newPersonPage(page.context().browser()!);
  await newMember(outsider, uniqueName("Dev"));
  return outsider;
}

test("a monthly expense: added today, paused, resumed, edited for the future and cancelled", async ({ page, browser }) => {
  const [asha, bina] = [uniqueName("Asha"), uniqueName("Bina")];
  await newMember(page, asha);
  const groupId = await createGroup(page, uniqueName("Flat"), "Home");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), bina);
  await binaPage.context().close();

  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill("Rent");
  await field(page, "Amount").fill("20000");
  // Save is enabled only once the form is hydrated and the split is valid.
  await expect(page.getByRole("button", { name: "Save expense" })).toBeEnabled();
  await field(page, "Repeat").selectOption({ label: "Every month" });
  await expect(field(page, "First date")).toBeVisible();
  await expect(page.getByText(/^Every month on the \d+(st|nd|rd|th)/)).toBeVisible();
  await page.getByRole("button", { name: "Save recurring expense" }).click();
  await expect(page).toHaveURL(RECURRING_URL, NAVIGATION);
  const recurringId = RECURRING_URL.exec(page.url())?.[1] ?? "";
  await expect(page.getByText("Recurring expense saved. Anything due up to today has been added.")).toBeVisible();

  // Today's occurrence is already an expense, in the group's balances.
  const added = page.getByRole("list", { name: "Expenses added" }).getByRole("link");
  await expect(added).toHaveCount(1);
  await added.click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/, NAVIGATION);
  const firstExpense = page.url();
  await expect(page.getByText("Added automatically by")).toBeVisible();
  await expect(page.getByText("₹20,000.00").first()).toBeVisible();
  await page.goto(`/groups/${groupId}/members`);
  await expect(members(page).filter({ hasText: bina })).toContainText("₹10,000.00");

  // Listed under Recurring.
  await page.goto("/recurring");
  await expect(page.getByRole("list", { name: "Recurring expenses" }).getByRole("link", { name: /Rent/ })).toBeVisible();

  // Pause, then resume.
  await page.goto(`/recurring/${recurringId}`);
  const header = page.getByRole("main").locator("header");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(header.getByText("Paused")).toBeVisible(NAVIGATION);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(header.getByText("Active")).toBeVisible(NAVIGATION);

  // Edit: the next ones cost more; the one already added keeps its amount.
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit recurring expense" })).toBeVisible(NAVIGATION);
  await expect(field(page, "Repeat")).toHaveValue("monthly");
  await field(page, "Amount").fill("24000");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/recurring/${recurringId}\\?saved=updated$`), NAVIGATION);
  await expect(page.getByRole("main").getByText("₹24,000.00").first()).toBeVisible();
  await page.goto(firstExpense);
  await expect(page.getByText("₹20,000.00").first()).toBeVisible();

  // An outsider can't open it.
  const outsider = await outsiderPage(page);
  await outsider.goto(`/recurring/${recurringId}`);
  await expect(outsider.getByRole("heading", { name: "Page not found" })).toBeVisible(NAVIGATION);
  await outsider.context().close();

  // Cancel (asks first).
  await page.goto(`/recurring/${recurringId}`);
  await page.getByRole("button", { name: "Cancel recurring expense" }).click();
  await page.getByRole("button", { name: "Cancel recurring expense" }).click();
  await expect(header.getByText("Cancelled")).toBeVisible(NAVIGATION);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByText("This recurring expense was cancelled.")).toBeVisible();
});

test("receipts: a PDF and a photo are attached, opened by members and refused to others", async ({ page, browser }) => {
  await newMember(page, uniqueName("Asha"));
  const groupId = await createGroup(page, uniqueName("Trip"), "Trip");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), uniqueName("Bina"));

  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill("Hotel");
  await field(page, "Amount").fill("6000");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  const expenseId = EXPENSE_URL.exec(page.url())?.[1] ?? "";

  const receipts = page.getByRole("list", { name: "Receipts" });
  const upload = page.getByLabel("Add receipt");
  await upload.setInputFiles({ name: "hotel bill.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("status").filter({ hasText: "Receipt added." })).toBeVisible(NAVIGATION);
  await expect(receipts.getByText("hotel bill.pdf")).toBeVisible(NAVIGATION);

  await upload.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await expect(receipts.getByRole("listitem")).toHaveCount(2, NAVIGATION);

  // A text file named like a PDF is refused by its content.
  await upload.setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just text") });
  await expect(page.getByRole("alert").filter({ hasText: "Choose a JPEG, PNG, WebP or PDF file." })).toBeVisible();
  await expect(receipts.getByRole("listitem")).toHaveCount(2);

  // Another member opens it through a fresh signed URL.
  const href = (await receipts.getByRole("link", { name: /hotel bill\.pdf/ }).getAttribute("href")) ?? "";
  expect(href).toMatch(new RegExp(`^/expenses/${expenseId}/receipts/[0-9a-f-]{36}$`));
  const redirect = await binaPage.request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()["location"]).toContain("/storage/v1/object/sign/receipts/");
  const file = await binaPage.request.get(redirect.headers()["location"] ?? "");
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(await file.body()).toEqual(PDF);
  await binaPage.context().close();

  // An outsider gets a 404 for the same link.
  const outsider = await outsiderPage(page);
  expect((await outsider.request.get(href, { maxRedirects: 0 })).status()).toBe(404);
  await outsider.context().close();

  // The uploader can remove it.
  const pdfRow = receipts.getByRole("listitem").filter({ hasText: "hotel bill.pdf" });
  await pdfRow.getByRole("button", { name: "Remove" }).click();
  await pdfRow.getByRole("button", { name: "Remove" }).click();
  await expect(receipts.getByRole("listitem")).toHaveCount(1, NAVIGATION);
  expect((await page.request.get(href, { maxRedirects: 0 })).status()).toBe(404);
});
