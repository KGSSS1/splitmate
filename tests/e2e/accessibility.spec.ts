import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { field } from "./support/accounts";
import { createGroup, createInviteLink, joinThroughInvite, NAVIGATION, newMember, openGroupTab, uniqueName } from "./support/groups";

// Review M6, batch 3: axe (WCAG 2.2 AA) in both themes, visible keyboard focus
// on list rows (M7) and 44 px touch targets on phones (M11, SPEC §9).

const EXPENSE_URL = /\/expenses\/([0-9a-f-]{36})\?saved=created$/;
const SETTLEMENT_URL = /\/settlements\/([0-9a-f-]{36})\?saved=paid$/;
const RECURRING_URL = /\/recurring\/([0-9a-f-]{36})\?saved=created$/;

interface World {
  groupId: string;
  expenseId: string;
  settlementId: string;
  binaId: string;
  recurringId: string;
}

/**
 * Asha and Bina share a group with one expense (with a receipt), one pending
 * repayment from Bina and a monthly recurring expense.
 */
async function buildWorld(page: Page, browser: Browser): Promise<{ world: World; binaPage: Page }> {
  const [asha, bina] = ["Asha", "Bina"].map(uniqueName) as [string, string];
  await newMember(page, asha);
  const groupId = await createGroup(page, uniqueName("Trip"), "Trip");
  await openGroupTab(page, "Members");
  const binaPage = await joinThroughInvite(browser, await createInviteLink(page), bina);

  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill("Dinner");
  await field(page, "Amount").fill("300");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(EXPENSE_URL, NAVIGATION);
  const expenseId = EXPENSE_URL.exec(page.url())?.[1] ?? "";
  await page.getByLabel("Add receipt").setInputFiles({
    name: "dinner.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(page.getByRole("list", { name: "Receipts" }).getByRole("listitem")).toHaveCount(1, NAVIGATION);

  await page.goto(`/expenses/new?group=${groupId}&repeat=monthly`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await field(page, "Description").fill("Rent");
  await field(page, "Amount").fill("1000");
  await page.getByRole("button", { name: "Save recurring expense" }).click();
  await expect(page).toHaveURL(RECURRING_URL, NAVIGATION);
  const recurringId = RECURRING_URL.exec(page.url())?.[1] ?? "";

  await binaPage.goto(`/settle-up?group=${groupId}`);
  await field(binaPage, "Settled with").selectOption({ label: asha });
  await field(binaPage, "Amount").fill("100");
  await binaPage.getByRole("button", { name: "Record payment" }).click();
  await expect(binaPage).toHaveURL(SETTLEMENT_URL, NAVIGATION);
  const settlementId = SETTLEMENT_URL.exec(binaPage.url())?.[1] ?? "";

  await page.goto("/friends");
  const binaHref = await page.getByRole("link", { name: new RegExp(bina) }).getAttribute("href");
  return { world: { groupId, expenseId, settlementId, binaId: binaHref?.split("/").pop() ?? "", recurringId }, binaPage };
}

function appPages({ groupId, expenseId, settlementId, binaId, recurringId }: World) {
  return [
    "/dashboard",
    "/groups",
    `/groups/${groupId}`,
    `/groups/${groupId}/balances`,
    `/groups/${groupId}/members`,
    `/groups/${groupId}/settings`,
    "/friends",
    `/friends/${binaId}`,
    "/activity",
    "/settlements",
    `/settlements/${settlementId}`,
    "/settle-up",
    "/expenses/new",
    `/expenses/${expenseId}`,
    `/expenses/${expenseId}/edit`,
    "/expenses/new?repeat=monthly",
    "/recurring",
    `/recurring/${recurringId}`,
    `/recurring/${recurringId}/edit`,
    "/settings",
    // An app URL that doesn't exist (L29: the not-found page inside the app shell).
    "/groups/not-a-group/balances",
  ];
}

test("app pages pass axe in light and dark themes", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { world, binaPage } = await buildWorld(page, browser);
  const problems: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const path of appPages(world)) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(NAVIGATION);
      // Submit buttons fade in once hydrated; measure colours after transitions end.
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      for (const violation of violations) {
        const where = violation.nodes
          .slice(0, 3)
          .map((node) => {
            const data = node.any[0]?.data as { contrastRatio?: number; fgColor?: string; bgColor?: string } | undefined;
            const colours = data?.contrastRatio ? ` ${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}` : "";
            return `${node.target.join(" ")}${colours}`;
          })
          .join(", ");
        problems.push(`[${colorScheme}] ${path}: ${violation.id} (${violation.nodes.length}) at ${where}`);
      }
    }
  }
  expect(problems).toEqual([]);
  await binaPage.context().close();
});

test("list rows show where keyboard focus is", async ({ page, browser }) => {
  // buildWorld alone signs up two people and saves four things.
  test.setTimeout(120_000);
  const { world, binaPage } = await buildWorld(page, browser);
  const rows: [string, string][] = [
    ["/groups", `a[href="/groups/${world.groupId}"]`],
    [`/groups/${world.groupId}`, `a[href="/expenses/${world.expenseId}"]`],
    ["/friends", `a[href="/friends/${world.binaId}"]`],
    ["/settlements", `a[href="/settlements/${world.settlementId}"]`],
    ["/recurring", `a[href="/recurring/${world.recurringId}"]`],
    ["/activity", 'main li a[href^="/"]'],
    ["/dashboard", `main a[href="/friends/${world.binaId}"]`],
  ];
  const invisible: string[] = [];
  for (const [path, selector] of rows) {
    await page.goto(path);
    const row = page.locator(selector).filter({ visible: true }).first();
    await expect(row).toBeVisible(NAVIGATION);
    // After a key press, Chromium treats focus as keyboard focus (:focus-visible).
    await page.keyboard.press("Shift");
    await row.focus();
    expect(await row.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    const style = await row.evaluate((element) => {
      const css = getComputedStyle(element);
      return { shadow: css.boxShadow, outline: `${css.outlineStyle} ${css.outlineWidth}` };
    });
    const ringed = style.shadow !== "none" || !style.outline.startsWith("none");
    if (!ringed) invisible.push(`${path} ${selector}: ${JSON.stringify(style)}`);
  }
  expect(invisible).toEqual([]);
  await binaPage.context().close();
});

test("touch targets are at least 44 px on phones", async ({ page, browser, isMobile }) => {
  test.skip(!isMobile, "phones only");
  test.setTimeout(120_000);
  const { world, binaPage } = await buildWorld(page, browser);
  const small: string[] = [];
  for (const path of [
    "/dashboard",
    "/settings",
    "/expenses/new",
    "/expenses/new?repeat=monthly",
    `/expenses/${world.expenseId}`,
    `/recurring/${world.recurringId}`,
    `/groups/${world.groupId}/settings`,
    `/settlements/${world.settlementId}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(NAVIGATION);
    if (path.startsWith("/expenses/new")) await page.getByText("Notes and tags").scrollIntoViewIfNeeded();
    const found = await page.evaluate(() => {
      // Buttons, links outside running text, disclosure summaries and radio pills.
      const targets = [
        ...document.querySelectorAll<HTMLElement>("button, a[href], summary, label:has(> input[type=radio])"),
      ]
        // Visually hidden until focused (the skip link) or not rendered.
        .filter((element) => !element.closest("p") && element.getBoundingClientRect().width > 1);
      return targets
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 40), h: box.height, w: box.width };
        })
        .filter((box) => box.h > 0 && (box.h < 44 || box.w < 44));
    });
    for (const target of found) small.push(`${path}: "${target.text}" ${Math.round(target.w)}×${Math.round(target.h)}`);
  }
  expect(small).toEqual([]);
  await binaPage.context().close();
});

// Review L24: on a 375 px phone the adjustment's split select cut "Proportionally" off.
test("the itemized form fits a 375 px phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phones only");
  await page.setViewportSize({ width: 375, height: 812 });
  await newMember(page, uniqueName("Asha"));
  const groupId = await createGroup(page, uniqueName("Trip"), "Trip");
  await page.goto(`/expenses/new?group=${groupId}`);
  await expect(field(page, "Split with")).toHaveValue(`group:${groupId}`, NAVIGATION);
  await page.locator("label", { hasText: "By item" }).click();
  await page.getByRole("button", { name: "Add tax, tip or discount" }).click();
  const split = field(page, "Line 1 split");
  await expect(split).toHaveValue("proportional");
  const room = await split.evaluate((select: HTMLSelectElement) => {
    const css = getComputedStyle(select);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const text = context.measureText(select.selectedOptions[0]?.textContent ?? "").width;
    const inner = select.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    return { text: Math.ceil(text), inner: Math.floor(inner) };
  });
  expect(room).not.toBeNull();
  expect(room!.inner).toBeGreaterThanOrEqual(room!.text);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
