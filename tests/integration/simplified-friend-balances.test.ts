import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import { settleableWith } from "@/lib/settlements/friend-view";
import { suggestedTransfers } from "@/lib/settlements/suggestions";
import { loadContextBalances } from "@/server/balances";
import type { Database } from "@/types/database.types";

import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

type Client = SupabaseClient<Database>;

// src/server/balances.ts is server-only; here it runs with signed-in test clients.
vi.mock("server-only", () => ({}));

// Review M6 (H3/D-F1). Friend balances used to come from raw pairwise entries
// while a simplify-on group's suggestions came from nets. After everyone
// followed the simplified plan, the group was settled but a pairwise cycle
// (A→B, B→C, C→A) stayed on dashboards and friend pages, and "settle up
// everything" then moved money nobody owed.
//
// Fixed by basing friend-level views on the group's simplified plan
// (SPEC §2, §7, §11; src/lib/settlements/friend-view.ts).
describe("simplified groups vs raw pairwise friend balances", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let asA: Client;
  let asB: Client;
  let asC: Client;
  let groupId: string;

  async function addExpense(client: Client, paidBy: string, amount: string, people: string[]) {
    const values: ExpenseFormValues = {
      ...blankExpenseValues({
        splitWith: `group:${groupId}`,
        userIds: [a.id, b.id, c.id],
        paidBy,
        currency: "INR",
        date: "2026-10-21",
      }),
      description: "Expense",
      amount,
    };
    for (const person of values.people) person.included = people.includes(person.userId);
    const result = resolveExpense(values);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    const { error } = await client.rpc("create_expense", {
      ...payload,
      p_description: values.description,
      p_expense_date: values.date,
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
    });
    if (error) throw error;
  }

  async function nets() {
    const { data, error } = await asA.rpc("group_balances", { p_group_id: groupId });
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    const created = await Promise.all(["A", "B", "C"].map((name) => createTestUser(admin, { displayName: name })));
    [a, b, c] = created as [TestUser, TestUser, TestUser];
    users.push(a, b, c);
    [asA, asB, asC] = await Promise.all([signedInClient(a), signedInClient(b), signedInClient(c)]);
    const group = await asA.rpc("create_group", { p_name: `IT simplify ${randomUUID().slice(0, 8)}` });
    if (group.error) throw group.error;
    groupId = group.data;
    const invite = await asA.rpc("create_invitation", { p_group_id: groupId, p_max_uses: 2 });
    if (invite.error) throw invite.error;
    for (const client of [asB, asC]) {
      const joined = await client.rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
      if (joined.error) throw joined.error;
    }

    // A pays ₹300 for A, B, C; C pays ₹600 for B and C. Nets: A +200, B −400, C +200.
    await addExpense(asA, a.id, "300", [a.id, b.id, c.id]);
    await addExpense(asC, c.id, "600", [b.id, c.id]);

  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  /** What a person's friend view offers to settle with someone (both still in the group). */
  async function settleable(viewer: TestUser, client: Client, friend: TestUser) {
    return settleableWith(await loadContextBalances(client, viewer.id), friend.id, new Set([groupId])).map((row) => ({
      group_id: row.groupId,
      currency: row.currency,
      amount: row.amount,
    }));
  }

  it("before settling, friend balances follow the group's simplified plan, not raw pairwise rows", async () => {
    // Raw pairwise: B owes A ₹100, C owes A ₹100, B owes C ₹300. Plan: B pays A ₹200 and C ₹200.
    const plan = suggestedTransfers({
      simplify: true,
      nets: (await nets()).map((row) => ({ userId: row.user_id, currency: row.currency, amount: row.amount })),
      pairwise: [],
    });
    expect(plan.map((t) => [t.fromUserId, t.toUserId, t.amount]).sort()).toEqual(
      [
        [b.id, a.id, 20000],
        [b.id, c.id, 20000],
      ].sort(),
    );
    const view = (rows: Awaited<ReturnType<typeof loadContextBalances>>) =>
      rows.map((row) => [row.counterpartyId, row.groupId, row.amount, row.simplified]);
    expect(view(await loadContextBalances(asA, a.id))).toEqual([[b.id, groupId, 20000, true]]);
    expect(view(await loadContextBalances(asC, c.id))).toEqual([[b.id, groupId, 20000, true]]);
    expect(view(await loadContextBalances(asB, b.id)).sort()).toEqual(
      [
        [a.id, groupId, -20000, true],
        [c.id, groupId, -20000, true],
      ].sort(),
    );
    // A and C have nothing to settle with each other, although raw rows say C owes A ₹100.
    expect(await settleable(a, asA, c)).toEqual([]);
  });

  it("settling up everything follows the plan and leaves the group settled", async () => {
    // A and C each settle up everything with B (receivers record → completed).
    for (const [viewer, client] of [
      [a, asA],
      [c, asC],
    ] as const) {
      const items = await settleable(viewer, client, b);
      expect(items).toEqual([{ group_id: groupId, currency: "INR", amount: 20000 }]);
      const { error } = await client.rpc("settle_up_with_friend", {
        p_idempotency_key: randomUUID(),
        p_friend_id: b.id,
        p_items: items,
      });
      expect(error).toBeNull();
    }
    expect(await nets()).toEqual([]);
  });

  it("once the plan is followed, nobody's friend view shows anything owed", async () => {
    for (const [viewer, client] of [
      [a, asA],
      [b, asB],
      [c, asC],
    ] as const) {
      expect(await loadContextBalances(client, viewer.id)).toEqual([]);
    }
    // The raw ledger view still has the leftover cycle; the app no longer shows it.
    const { data: raw } = await asA.rpc("friend_balances");
    expect(raw?.length).toBe(2);
  });

  it("settle up everything can't unbalance a settled group", async () => {
    expect(await settleable(a, asA, c)).toEqual([]);
    // Even sent by hand, the raw leftover isn't accepted for a simplifying group.
    const { error } = await asA.rpc("settle_up_with_friend", {
      p_idempotency_key: randomUUID(),
      p_friend_id: c.id,
      p_items: [{ group_id: groupId, currency: "INR", amount: 10000 }],
    });
    expect(error?.code).toBe("SM409");
    expect(await nets()).toEqual([]);
  });
});
