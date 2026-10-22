import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import type { Database } from "@/types/database.types";

import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

// The Server Action path end to end against local Supabase: form values →
// src/lib/accounting → create/update/cancel_expense → ledger rows and balances.
describe("expenses against local Supabase", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let asA: SupabaseClient<Database>;
  let groupId: string;

  function form(overrides: Partial<ExpenseFormValues> = {}): ExpenseFormValues {
    return {
      ...blankExpenseValues({
        splitWith: `group:${groupId}`,
        userIds: [a.id, b.id, c.id],
        paidBy: a.id,
        currency: "INR",
        date: "2026-10-21",
      }),
      description: "Dinner",
      amount: "900",
      ...overrides,
    };
  }

  function args(values: ExpenseFormValues) {
    const result = resolveExpense(values);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    return { ...payload, ...(p_items ? { p_items } : {}), p_description: values.description, p_expense_date: values.date };
  }

  async function balances() {
    const { data, error } = await asA.rpc("group_balances", { p_group_id: groupId });
    if (error) throw error;
    return Object.fromEntries(data.map((row) => [row.user_id, row.amount]));
  }

  async function ledger(expenseId: string) {
    const { data, error } = await admin
      .from("ledger_entries")
      .select("debtor_id, creditor_id, amount, source_version, entry_type")
      .eq("expense_id", expenseId)
      .order("created_at")
      .order("entry_type");
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    a = await createTestUser(admin, { displayName: "A" });
    b = await createTestUser(admin, { displayName: "B" });
    c = await createTestUser(admin, { displayName: "C" });
    users.push(a, b, c);
    asA = await signedInClient(a);

    const created = await asA.rpc("create_group", { p_name: `IT ${randomUUID().slice(0, 8)}` });
    if (created.error) throw created.error;
    groupId = created.data;
    const invite = await asA.rpc("create_invitation", { p_group_id: groupId, p_max_uses: 2 });
    if (invite.error) throw invite.error;
    const token = invite.data[0]?.token ?? "";
    for (const user of [b, c]) {
      const joined = await (await signedInClient(user)).rpc("accept_invitation", { p_token: token });
      if (joined.error) throw joined.error;
    }
  });

  afterAll(async () => {
    // Profiles with financial history cannot be deleted (ON DELETE RESTRICT); only the auth users go.
    await deleteTestUsers(admin, users);
  });

  it("creates, edits and cancels an expense, and the ledger follows every step", async () => {
    // E2E step 3 numbers: ₹900 paid by A, split equally.
    const key = randomUUID();
    const created = await asA.rpc("create_expense", { ...args(form()), p_idempotency_key: key, p_group_id: groupId });
    expect(created.error).toBeNull();
    const expenseId = created.data ?? "";
    expect(await balances()).toEqual({ [a.id]: 60000, [b.id]: -30000, [c.id]: -30000 });

    // A retry with the same key returns the same expense and writes nothing new.
    const retried = await asA.rpc("create_expense", { ...args(form()), p_idempotency_key: key, p_group_id: groupId });
    expect(retried.data).toBe(expenseId);
    expect(await ledger(expenseId)).toHaveLength(2);

    // Edit: ₹1,200 split by percentage 50/25/25, paid by A.
    const edited = form({ amount: "1200", splitMethod: "percentage" });
    edited.people[0]!.percent = "50";
    edited.people[1]!.percent = "25";
    edited.people[2]!.percent = "25";
    const update = await asA.rpc("update_expense", { ...args(edited), p_expense_id: expenseId, p_expected_version: 1 });
    expect(update.error).toBeNull();
    expect(update.data).toBe(2);
    expect(await balances()).toEqual({ [a.id]: 60000, [b.id]: -30000, [c.id]: -30000 });

    // The old version is reversed exactly and the new charges are added.
    const rows = await ledger(expenseId);
    expect(rows.filter((row) => row.entry_type === "reversal")).toEqual(
      expect.arrayContaining([
        { debtor_id: a.id, creditor_id: b.id, amount: 30000, source_version: 1, entry_type: "reversal" },
        { debtor_id: a.id, creditor_id: c.id, amount: 30000, source_version: 1, entry_type: "reversal" },
      ]),
    );
    expect(rows.filter((row) => row.source_version === 2)).toEqual(
      expect.arrayContaining([
        { debtor_id: b.id, creditor_id: a.id, amount: 30000, source_version: 2, entry_type: "charge" },
        { debtor_id: c.id, creditor_id: a.id, amount: 30000, source_version: 2, entry_type: "charge" },
      ]),
    );

    // A second edit with different numbers changes the balances.
    const third = form({ amount: "1500" });
    const again = await asA.rpc("update_expense", { ...args(third), p_expense_id: expenseId, p_expected_version: 2 });
    expect(again.error).toBeNull();
    expect(await balances()).toEqual({ [a.id]: 100000, [b.id]: -50000, [c.id]: -50000 });

    // An edit based on an old version is refused.
    const stale = await asA.rpc("update_expense", { ...args(form()), p_expense_id: expenseId, p_expected_version: 2 });
    expect(stale.error?.code).toBe("SM409");

    // Cancel: reversals only, and everyone is settled.
    const cancelled = await asA.rpc("cancel_expense", { p_expense_id: expenseId, p_expected_version: 3 });
    expect(cancelled.error).toBeNull();
    expect(await balances()).toEqual({});
    const sums = new Map<string, number>();
    for (const row of await ledger(expenseId)) {
      sums.set(row.creditor_id, (sums.get(row.creditor_id) ?? 0) + row.amount);
      sums.set(row.debtor_id, (sums.get(row.debtor_id) ?? 0) - row.amount);
    }
    expect([...sums.values()].every((sum) => sum === 0)).toBe(true);
  });

  it("stores an itemized bill with its items, adjustments and rounding units", async () => {
    const values = form({
      splitMethod: "itemized",
      items: [
        { name: "Pizza", amount: "600", assignees: [a.id, b.id] },
        { name: "Salad", amount: "100", assignees: [c.id] },
      ],
      adjustments: [{ kind: "tip", amount: "0.01", allocation: "equal" }],
    });
    const created = await asA.rpc("create_expense", {
      ...args(values),
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
    });
    expect(created.error).toBeNull();

    const { data: items } = await asA
      .from("expense_items")
      .select("kind, name, amount, allocation, expense_item_assignments(user_id)")
      .eq("expense_id", created.data ?? "")
      .order("position");
    expect(items?.map((item) => [item.kind, item.amount, item.expense_item_assignments.length])).toEqual([
      ["item", 60000, 2],
      ["item", 10000, 1],
      ["tip", 1, 0],
    ]);
    const { data: participants } = await asA
      .from("expense_participants")
      .select("amount, received_rounding_unit")
      .eq("expense_id", created.data ?? "");
    expect(participants?.reduce((sum, p) => sum + p.amount, 0)).toBe(70001);
    expect(participants?.filter((p) => p.received_rounding_unit)).toHaveLength(1);
  });

  it("refuses a payload whose ledger rows were tampered with", async () => {
    const tampered = args(form());
    tampered.p_ledger_entries = [{ debtor_id: b.id, creditor_id: a.id, amount: 60000 }];
    const result = await asA.rpc("create_expense", {
      ...tampered,
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
    });
    expect(result.error?.code).toBe("SM422");
  });
});
