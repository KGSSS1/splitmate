import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { byCategory, byGroup, sumShares, trend } from "@/lib/analytics/aggregate";
import { addDays } from "@/lib/recurring/schedule";
import { todayIn } from "@/lib/expenses/dates";
import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { resolveExpense } from "@/lib/expenses/resolve";
import { loadAnalytics, loadExpenseShares, loadSettlements } from "@/server/analytics";
import { buildExpensesCsv, buildSettlementsCsv, EXPENSE_CSV_HEADER } from "@/server/exports";
import { countUnread, loadNotifications } from "@/server/notifications";
import { loadSearch } from "@/server/search";
import type { Database } from "@/types/database.types";

import { psqlAdmin } from "./support/psql";
import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

// The server modules are server-only; here they run with signed-in test clients.
vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;

const TODAY = todayIn("UTC");
const YEAR = { from: addDays(TODAY, -365), to: TODAY };

/** Rows of a CSV body (BOM and trailing newline removed), naively split: test data has no commas. */
function csvRows(body: string): string[][] {
  return body.replace(/^﻿/, "").trimEnd().split("\r\n").map((line) => line.split(","));
}

/**
 * Per currency: the viewer's paid and share sums over active expenses dated in
 * the range, straight from the tables (current version rows only), as postgres.
 */
async function databaseTotals(userId: string, from: string, to: string) {
  const { code, output } = await psqlAdmin(`
    select e.currency,
           coalesce(sum((select sum(p.amount) from public.expense_payers p
                          where p.expense_id = e.id and p.version = e.version and p.user_id = '${userId}')), 0),
           coalesce(sum((select sum(p.amount) from public.expense_participants p
                          where p.expense_id = e.id and p.version = e.version and p.user_id = '${userId}')), 0)
      from public.expenses e
     where e.status = 'active' and e.expense_date between '${from}' and '${to}'
       and e.id in (select expense_id from public.expense_payers where user_id = '${userId}'
                    union select expense_id from public.expense_participants where user_id = '${userId}')
     group by e.currency order by e.currency;`);
  expect(code).toBe(0);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [currency, paid, share] = line.split("|");
      return { currency, paid: Number(paid), share: Number(share) };
    });
}

async function settlementTotals(userId: string, from: string, to: string) {
  const { code, output } = await psqlAdmin(`
    select currency,
           coalesce(sum(amount) filter (where payer_id = '${userId}'), 0),
           coalesce(sum(amount) filter (where receiver_id = '${userId}'), 0)
      from public.settlements
     where status = 'completed' and settled_on between '${from}' and '${to}'
       and '${userId}' in (payer_id, receiver_id)
     group by currency order by currency;`);
  expect(code).toBe(0);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [currency, paid, received] = line.split("|");
      return { currency, paid: Number(paid), received: Number(received) };
    });
}

/** Every chart and table total in the report equals the database's sums for the viewer. */
async function expectReportMatchesDatabase(client: Client, userId: string, range: { from: string; to: string }) {
  const report = await loadAnalytics(client, userId, { preset: "custom", range, granularity: "week", currency: undefined }, "INR");
  const expenses = await databaseTotals(userId, range.from, range.to);
  const settlements = await settlementTotals(userId, range.from, range.to);

  expect(report.totals.map((t) => ({ currency: t.currency, paid: t.paid, share: t.share })).sort((x, y) =>
    String(x.currency).localeCompare(String(y.currency)),
  )).toEqual(
    // Currencies with only repayments have zero paid/share.
    [...new Set([...expenses.map((row) => row.currency), ...settlements.map((row) => row.currency)])]
      .sort()
      .map((currency) => ({
        currency,
        paid: expenses.find((row) => row.currency === currency)?.paid ?? 0,
        share: expenses.find((row) => row.currency === currency)?.share ?? 0,
      })),
  );
  for (const totals of report.totals) {
    const repaid = settlements.find((row) => row.currency === totals.currency);
    expect(totals.settlementsPaid, totals.currency).toBe(repaid?.paid ?? 0);
    expect(totals.settlementsReceived, totals.currency).toBe(repaid?.received ?? 0);
  }

  // Every breakdown chart adds up to the database total, in every currency.
  const rows = await loadExpenseShares(client, range);
  for (const { currency, share } of expenses) {
    const code = String(currency);
    expect(sumShares(byCategory(rows, code)), `category ${code}`).toBe(share);
    expect(sumShares(byGroup(rows, code, (id) => id)), `group ${code}`).toBe(share);
    expect(sumShares(trend(rows, code, range, "week")), `week ${code}`).toBe(share);
    expect(sumShares(trend(rows, code, range, "month")), `month ${code}`).toBe(share);
  }
  // And the selected currency's charts as the page renders them.
  const selected = expenses.find((row) => row.currency === report.currency);
  if (selected) {
    expect(sumShares(report.byCategory)).toBe(selected.share);
    expect(sumShares(report.byGroup)).toBe(selected.share);
    expect(sumShares(report.trend)).toBe(selected.share);
  }
  return report;
}

describe("analytics against the seeded database", () => {
  it("chart totals equal the database totals for Alice (supabase/seed.sql)", async () => {
    const { output } = await psqlAdmin("select id from public.profiles where email = 'alice@example.test';");
    const aliceId = output.trim();
    expect(aliceId, "run `npm run db:reset` to load the seed").toMatch(/^[0-9a-f-]{36}$/);
    // The seed's local-only password (supabase/seed.sql).
    const asAlice = await signedInClient({ id: aliceId, email: "alice@example.test", password: "splitmate-local-dev" });

    const report = await expectReportMatchesDatabase(asAlice, aliceId, YEAR);
    // The seed has INR and USD expenses for Alice; their totals are never mixed.
    expect(report.currencies).toEqual(expect.arrayContaining(["INR", "USD"]));
    expect(report.totals.find((t) => t.currency === "USD")?.share).toBeGreaterThan(0);
  });
});

describe("analytics, exports, search and notifications against local Supabase", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  const tag = randomUUID().slice(0, 6);
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let d: TestUser;
  let e: TestUser;
  let asA: Client;
  let asB: Client;
  let asC: Client;
  let asD: Client;
  let groupId: string;
  let otherGroupId: string;
  const ids: Record<string, string> = {};

  async function makeGroup(owner: Client, members: TestUser[], name: string) {
    const group = await owner.rpc("create_group", { p_name: name });
    if (group.error) throw group.error;
    const invite = await owner.rpc("create_invitation", { p_group_id: group.data, p_max_uses: 5 });
    if (invite.error) throw invite.error;
    for (const member of members) {
      const joined = await (await signedInClient(member)).rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
      if (joined.error) throw joined.error;
    }
    return group.data;
  }

  async function addExpense(
    client: Client,
    {
      group,
      friend,
      people,
      payer,
      amount,
      description,
      category,
      date = TODAY,
      currency = "INR",
    }: {
      group?: string;
      friend?: string;
      people: string[];
      payer: string;
      amount: string;
      description: string;
      category: string;
      date?: string;
      currency?: string;
    },
  ) {
    const result = resolveExpense({
      ...blankExpenseValues({
        splitWith: group ? `group:${group}` : `friend:${friend}`,
        userIds: people,
        paidBy: payer,
        currency,
        date,
      }),
      description,
      amount,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    const created = await client.rpc("create_expense", {
      ...payload,
      p_idempotency_key: randomUUID(),
      p_group_id: group ?? (null as unknown as string),
      p_description: description,
      p_expense_date: date,
      p_category: category,
    });
    if (created.error) throw created.error;
    return created.data;
  }

  beforeAll(async () => {
    const created = await Promise.all(
      ["Asha", "Bina", "Chitra", "Dev", "Esha"].map((name) => createTestUser(admin, { displayName: `${name} ${tag}` })),
    );
    [a, b, c, d, e] = created as [TestUser, TestUser, TestUser, TestUser, TestUser];
    users.push(a, b, c, d, e);
    [asA, asB, asC, asD] = (await Promise.all([a, b, c, d].map((user) => signedInClient(user)))) as [
      Client,
      Client,
      Client,
      Client,
    ];

    groupId = await makeGroup(asA, [b, c], `Goa ${tag}`);
    otherGroupId = await makeGroup(asD, [e], `Pune ${tag}`);

    ids.dinner = await addExpense(asA, {
      group: groupId,
      people: [a.id, b.id, c.id],
      payer: a.id,
      amount: "900",
      description: `Dinner ${tag}`,
      category: "food",
    });
    ids.taxi = await addExpense(asB, {
      group: groupId,
      people: [b.id, c.id],
      payer: b.id,
      amount: "600",
      description: `Taxi ${tag}`,
      category: "transport",
      date: addDays(TODAY, -40),
    });
    ids.snacks = await addExpense(asA, {
      friend: b.id,
      people: [a.id, b.id],
      payer: b.id,
      amount: "45",
      description: `Snacks ${tag}`,
      category: "food",
      currency: "USD",
      date: addDays(TODAY, -10),
    });
    ids.villa = await addExpense(asD, {
      group: otherGroupId,
      people: [d.id, e.id],
      payer: d.id,
      amount: "1000",
      description: `Villa ${tag}`,
      category: "travel",
    });
    // A cancelled one never counts.
    const cancelled = await addExpense(asA, {
      group: groupId,
      people: [a.id, b.id],
      payer: a.id,
      amount: "5000",
      description: `Mistake ${tag}`,
      category: "other",
    });
    const cancel = await asA.rpc("cancel_expense", { p_expense_id: cancelled, p_expected_version: 1 });
    if (cancel.error) throw cancel.error;

    // A recurring expense, added by the generator, in which A has a share.
    const recurring = resolveExpense({
      ...blankExpenseValues({ splitWith: `group:${groupId}`, userIds: [a.id, b.id], paidBy: b.id, currency: "INR", date: TODAY }),
      description: `Rent ${tag}`,
      amount: "2000",
    });
    if (!recurring.ok) throw new Error("recurring payload");
    const { p_items: recurringItems, ...recurringPayload } = buildExpensePayload(recurring.expense);
    expect(recurringItems ?? null).toBeNull();
    const template = await asB.rpc("create_recurring_expense", {
      ...recurringPayload,
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
      p_description: `Rent ${tag}`,
      p_frequency: "monthly",
      p_start_date: TODAY,
      p_timezone: "UTC",
    });
    if (template.error) throw template.error;
    ids.template = template.data;

    // Repayments: B pays A ₹100 (A records it: completed); E pays D (not A's business).
    for (const [client, group, payer, receiver] of [
      [asA, groupId, b, a],
      [asD, otherGroupId, e, d],
    ] as const) {
      const settled = await client.rpc("create_settlement", {
        p_idempotency_key: randomUUID(),
        p_group_id: group,
        p_payer_id: payer.id,
        p_receiver_id: receiver.id,
        p_amount: 10000,
        p_currency: "INR",
      });
      if (settled.error) throw settled.error;
    }
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("charts match database totals for every person, including the recurring summary", async () => {
    for (const [client, user] of [
      [asA, a],
      [asB, b],
      [asC, c],
      [asD, d],
    ] as const) {
      await expectReportMatchesDatabase(client, user.id, YEAR);
    }

    const report = await loadAnalytics(asA, a.id, { preset: "custom", range: YEAR, granularity: undefined, currency: "INR" }, "INR");
    expect(report.totals.find((t) => t.currency === "INR")).toMatchObject({
      paid: 90000,
      share: 30000 + 100000,
      settlementsReceived: 10000,
      settlementsPaid: 0,
    });
    expect(report.recurring.inRange).toMatchObject({ share: 100000, count: 1 });
    expect(report.recurring.commitments).toEqual([
      { frequency: "monthly", currency: "INR", perOccurrence: 100000, templates: 1, perYear: 1200000 },
    ]);
    expect(report.largest.map((row) => row.description)).toEqual([`Rent ${tag}`, `Dinner ${tag}`]);
  });

  it("the expenses export contains only the viewer's own rows", async () => {
    const asAFile = await buildExpensesCsv(asA, YEAR);
    const [header, ...rows] = csvRows(asAFile.body);
    expect(header).toEqual([...EXPENSE_CSV_HEADER]);
    const exportedIds = rows.map((row) => row.at(-1));
    // A can see B's taxi (same group) but took no part in it; D's villa is in another group.
    // Her dinner, her direct snacks, and the rent the recurring schedule added.
    expect(exportedIds).toHaveLength(3);
    expect(exportedIds).toEqual(expect.arrayContaining([ids.dinner, ids.snacks]));
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining([`Rent ${tag}`]));
    expect(exportedIds).not.toContain(ids.taxi);
    expect(exportedIds).not.toContain(ids.villa);
    const dinner = rows.find((row) => row[1] === `Dinner ${tag}`);
    expect(dinner).toEqual([TODAY, `Dinner ${tag}`, "Food and drink", `Goa ${tag}`, "INR", "900.00", "900.00", "300.00", "600.00", "No", ids.dinner]);
    const rent = rows.find((row) => row[1] === `Rent ${tag}`);
    expect(rent?.slice(5, 10)).toEqual(["2000.00", "0.00", "1000.00", "-1000.00", "Yes"]);
    const snacks = rows.find((row) => row[1] === `Snacks ${tag}`);
    expect(snacks?.slice(3, 9)).toEqual(["Direct", "USD", "45.00", "0.00", "22.50", "-22.50"]);

    // D's file has D's expense only.
    const asDRows = csvRows((await buildExpensesCsv(asD, YEAR)).body).slice(1);
    expect(asDRows.map((row) => row.at(-1))).toEqual([ids.villa]);
  });

  it("the repayments export contains only repayments the viewer made or received", async () => {
    const asARows = csvRows((await buildSettlementsCsv(asA, a.id, YEAR)).body).slice(1);
    expect(asARows).toHaveLength(1);
    expect(asARows[0]?.slice(1, 8)).toEqual(["You received", `Bina ${tag}`, `Goa ${tag}`, "INR", "100.00", "Cash", "Completed"]);
    // C is in the group but in neither repayment; D sees only the one with E.
    expect(csvRows((await buildSettlementsCsv(asC, c.id, YEAR)).body)).toHaveLength(1);
    const asDRows = csvRows((await buildSettlementsCsv(asD, d.id, YEAR)).body).slice(1);
    expect(asDRows.map((row) => row[2])).toEqual([`Esha ${tag}`]);
  });

  it("a forged viewer ID cannot widen the export: RLS still applies", async () => {
    // A's client asking for D's repayments gets nothing; the filter is not the guard.
    const forged = await loadSettlements(asA, d.id, YEAR, { completedOnly: false });
    expect(forged).toEqual([]);
  });

  it("search finds only what the viewer can access", async () => {
    const results = await loadSearch(asA, a.id, tag, 1);
    expect(results.friends.map((friend) => friend.displayName).sort()).toEqual([`Bina ${tag}`, `Chitra ${tag}`]);
    expect(results.groups).toEqual([{ id: groupId, name: `Goa ${tag}`, former: false }]);
    const found = results.expenses.map((item) => item.description).sort();
    // A sees the group's taxi (member) and the cancelled one, but never D's villa.
    expect(found).toEqual([`Dinner ${tag}`, `Mistake ${tag}`, `Rent ${tag}`, `Snacks ${tag}`, `Taxi ${tag}`]);
    expect(results.expenses.find((item) => item.description === `Taxi ${tag}`)).toMatchObject({ myNet: null });

    const forD = await loadSearch(asD, d.id, tag, 1);
    expect(forD.expenses.map((item) => item.description)).toEqual([`Villa ${tag}`]);
    expect(forD.groups.map((group) => group.name)).toEqual([`Pune ${tag}`]);
    expect(forD.friends.map((friend) => friend.displayName)).toEqual([`Esha ${tag}`]);

    // Category labels: "transport" is found by its label.
    const byLabel = await loadSearch(asC, c.id, "transport", 1);
    expect(byLabel.expenses.map((item) => item.id)).toContain(ids.taxi);
  });

  it("notifications are read and marked per person", async () => {
    const page = await loadNotifications(asB, 1);
    expect(page.items.map((item) => item.title)).toContain(`Asha ${tag} added “Dinner ${tag}” (₹900.00) in Goa ${tag}`);
    const unread = await countUnread(asB);
    expect(unread).toBeGreaterThan(0);

    // A cannot mark B's notifications.
    const first = page.items[0]?.id ?? "";
    expect((await asA.rpc("mark_notifications_read", { p_ids: [first] })).data).toBe(0);
    expect(await countUnread(asB)).toBe(unread);

    expect((await asB.rpc("mark_notifications_read", { p_ids: [first] })).data).toBe(1);
    expect(await countUnread(asB)).toBe(unread - 1);
    expect((await asB.rpc("mark_notifications_read", {})).data).toBe(unread - 1);
    expect(await countUnread(asB)).toBe(0);
  });
});
