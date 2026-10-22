import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import { suggestedTransfers } from "@/lib/settlements/suggestions";
import type { Database } from "@/types/database.types";

import { adminClient, anonClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

// SPEC §17 E2E steps 4–6 and 9 at the API level: balances from the ledger,
// a payer-recorded settlement confirmed by the receiver, simplified
// suggestions, friend-level "settle up everything", and an outsider denied.
describe("balances and settlements against local Supabase", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let d: TestUser;
  let asA: SupabaseClient<Database>;
  let asB: SupabaseClient<Database>;
  let asD: SupabaseClient<Database>;
  let groupId: string;

  async function addExpense(client: SupabaseClient<Database>, values: Partial<ExpenseFormValues>, group: string | null) {
    const people = group ? [a.id, b.id, c.id] : [a.id, b.id];
    const form: ExpenseFormValues = {
      ...blankExpenseValues({
        splitWith: group ? `group:${group}` : `friend:${b.id}`,
        userIds: people,
        paidBy: a.id,
        currency: "INR",
        date: "2026-10-21",
      }),
      description: "Expense",
      amount: "900",
      ...values,
    };
    const result = resolveExpense(form);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    // Equal splits have no items.
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    const { error } = await client.rpc("create_expense", {
      ...payload,
      p_description: form.description,
      p_expense_date: form.date,
      p_idempotency_key: randomUUID(),
      p_group_id: group ?? (null as unknown as string),
    });
    if (error) throw error;
  }

  async function nets() {
    const { data, error } = await asA.rpc("group_balances", { p_group_id: groupId });
    if (error) throw error;
    return Object.fromEntries(data.map((row) => [row.user_id, row.amount]));
  }

  beforeAll(async () => {
    const created = await Promise.all(["A", "B", "C", "D"].map((name) => createTestUser(admin, { displayName: name })));
    [a, b, c, d] = created as [TestUser, TestUser, TestUser, TestUser];
    users.push(a, b, c, d);
    [asA, asB, asD] = await Promise.all([signedInClient(a), signedInClient(b), signedInClient(d)]);

    const group = await asA.rpc("create_group", { p_name: `IT ${randomUUID().slice(0, 8)}` });
    if (group.error) throw group.error;
    groupId = group.data;
    const invite = await asA.rpc("create_invitation", { p_group_id: groupId, p_max_uses: 2 });
    if (invite.error) throw invite.error;
    const token = invite.data[0]?.token ?? "";
    for (const user of [b, c]) {
      const joined = await (await signedInClient(user)).rpc("accept_invitation", { p_token: token });
      if (joined.error) throw joined.error;
    }
    await addExpense(asA, {}, groupId);
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("dashboard balances, a confirmed repayment and simplified suggestions (E2E steps 4–6)", async () => {
    expect(await nets()).toEqual({ [a.id]: 60000, [b.id]: -30000, [c.id]: -30000 });
    const mine = await asA.rpc("my_group_balances");
    expect(mine.data).toEqual([{ group_id: groupId, currency: "INR", amount: 60000 }]);

    // B records ₹100 paid to A: pending, no effect until A confirms.
    const recorded = await asB.rpc("create_settlement", {
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
      p_payer_id: b.id,
      p_receiver_id: a.id,
      p_amount: 10000,
      p_currency: "INR",
      p_method: "upi",
      p_upi_reference: "UPI-IT-1",
    });
    expect(recorded.error).toBeNull();
    const settlementId = recorded.data ?? "";
    expect(await nets()).toEqual({ [a.id]: 60000, [b.id]: -30000, [c.id]: -30000 });

    expect((await asB.rpc("confirm_settlement", { p_settlement_id: settlementId })).error?.code).toBe("SM403");
    expect((await asA.rpc("confirm_settlement", { p_settlement_id: settlementId })).error).toBeNull();
    expect(await nets()).toEqual({ [a.id]: 50000, [b.id]: -20000, [c.id]: -30000 });

    // Suggestions: the same numbers either way here, since only A is owed.
    const balances = (await asA.rpc("group_balances", { p_group_id: groupId })).data ?? [];
    const pairwise = (await asA.rpc("group_pairwise_balances", { p_group_id: groupId })).data ?? [];
    const simplified = suggestedTransfers({
      simplify: true,
      nets: balances.map((row) => ({ userId: row.user_id, currency: row.currency, amount: row.amount })),
      pairwise: [],
    });
    const raw = suggestedTransfers({
      simplify: false,
      nets: [],
      pairwise: pairwise.map((row) => ({
        debtorId: row.debtor_id,
        creditorId: row.creditor_id,
        currency: row.currency,
        amount: row.amount,
      })),
    });
    const expected = [
      { fromUserId: c.id, toUserId: a.id, amount: 30000, currency: "INR" },
      { fromUserId: b.id, toUserId: a.id, amount: 20000, currency: "INR" },
    ];
    expect(simplified).toEqual(expected);
    expect(raw).toEqual(expected);
  });

  it("settles up everything with a friend: one settlement per group and currency", async () => {
    // A direct expense: B paid ₹500 for both, split equally → A owes B ₹250 directly.
    await addExpense(asB, { amount: "500", paidBy: b.id }, null);
    const before = await asA.rpc("friend_group_balances", { p_friend_id: b.id });
    expect(before.data).toEqual([
      { group_id: null, currency: "INR", amount: -25000 },
      { group_id: groupId, currency: "INR", amount: 20000 },
    ]);

    const key = randomUUID();
    const settled = await asA.rpc("settle_up_with_friend", { p_idempotency_key: key, p_friend_id: b.id, p_method: "cash" });
    expect(settled.error).toBeNull();
    expect(settled.data).toHaveLength(2);
    // A retry returns the same settlements.
    expect((await asA.rpc("settle_up_with_friend", { p_idempotency_key: key, p_friend_id: b.id })).data).toEqual(settled.data);

    const { data: rows } = await asA.from("settlements").select("group_id, payer_id, status").in("id", settled.data ?? []);
    expect(rows).toEqual(
      expect.arrayContaining([
        { group_id: groupId, payer_id: b.id, status: "completed" },
        { group_id: null, payer_id: a.id, status: "pending" },
      ]),
    );
    // The group part is cleared; the direct part waits for B.
    expect((await asA.rpc("friend_group_balances", { p_friend_id: b.id })).data).toEqual([
      { group_id: null, currency: "INR", amount: -25000 },
    ]);
    expect(await nets()).toEqual({ [a.id]: 30000, [c.id]: -30000 });
  });

  it("an outsider (D) is denied through the API and RPCs (E2E step 9)", async () => {
    expect((await asD.from("groups").select("id").eq("id", groupId)).data).toEqual([]);
    for (const table of ["group_members", "expenses", "ledger_entries", "settlements", "audit_events"] as const) {
      const { data, error } = await asD.from(table).select("*").eq("group_id", groupId);
      expect(error).toBeNull();
      expect(data, table).toEqual([]);
    }
    expect((await asD.rpc("group_balances", { p_group_id: groupId })).data).toEqual([]);
    expect((await asD.rpc("group_pairwise_balances", { p_group_id: groupId })).data).toEqual([]);
    expect((await asD.rpc("friend_group_balances", { p_friend_id: a.id })).data).toEqual([]);

    const settle = await asD.rpc("create_settlement", {
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
      p_payer_id: d.id,
      p_receiver_id: a.id,
      p_amount: 100,
      p_currency: "INR",
    });
    expect(settle.error?.code).toBe("SM403");
    const everything = await asD.rpc("settle_up_with_friend", { p_idempotency_key: randomUUID(), p_friend_id: a.id });
    expect(everything.error?.code).toBe("SM403");

    const { data: someSettlement } = await asA.from("settlements").select("id").eq("group_id", groupId).limit(1).single();
    const cancel = await asD.rpc("cancel_settlement", { p_settlement_id: someSettlement?.id ?? "" });
    expect(cancel.error?.code).toBe("SM404");

    // Anonymous callers cannot run the functions at all.
    const anon = await anonClient().rpc("settle_up_with_friend", { p_idempotency_key: randomUUID(), p_friend_id: a.id });
    expect(anon.error).not.toBeNull();
  });
});
