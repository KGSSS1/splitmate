import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import { suggestedTransfers } from "@/lib/settlements/suggestions";
import type { Database } from "@/types/database.types";

import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

type Client = SupabaseClient<Database>;

// Review M6 (D-F1), reproduced. SPEC §7 says friend balances come from raw
// pairwise entries while a simplify-on group's suggestions come from nets. After
// everyone follows the simplified plan, the group is settled but a pairwise
// cycle (A→B, B→C, C→A) stays on dashboards and friend pages, and "settle up
// everything" then moves money nobody owes.
//
// These are `it.fails`: they pass while the behaviour is as described and will
// start failing once it is fixed, at which point they become normal tests. The
// fix needs a SPEC decision (docs/reviews/review-M6.md).
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

    // Everyone follows the simplified plan: B pays A ₹200 and C ₹200, recorded by the receivers.
    const plan = suggestedTransfers({
      simplify: true,
      nets: (await nets()).map((row) => ({ userId: row.user_id, currency: row.currency, amount: row.amount })),
      pairwise: [],
    });
    expect(plan).toEqual([
      { fromUserId: b.id, toUserId: [a.id, c.id].sort()[0], amount: 20000, currency: "INR" },
      { fromUserId: b.id, toUserId: [a.id, c.id].sort()[1], amount: 20000, currency: "INR" },
    ]);
    for (const transfer of plan) {
      const receiver = transfer.toUserId === a.id ? asA : asC;
      const { error } = await receiver.rpc("create_settlement", {
        p_idempotency_key: randomUUID(),
        p_group_id: groupId,
        p_payer_id: transfer.fromUserId,
        p_receiver_id: transfer.toUserId,
        p_amount: transfer.amount,
        p_currency: "INR",
      });
      if (error) throw error;
    }
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("the group is settled once the simplified plan is followed", async () => {
    expect(await nets()).toEqual([]);
  });

  it.fails("A's friend balances (dashboard, friend pages) show nothing owed either", async () => {
    const { data } = await asA.rpc("friend_balances");
    // Today: B +? / C −? cycle remains, e.g. A owes B ₹100 and C owes A ₹100.
    expect(data).toEqual([]);
  });

  it.fails("settle up everything doesn't unbalance a settled group", async () => {
    const { error } = await asA.rpc("settle_up_with_friend", { p_idempotency_key: randomUUID(), p_friend_id: c.id });
    expect(error).toBeNull();
    expect(await nets()).toEqual([]);
  });
});
