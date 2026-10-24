import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import type { Database } from "@/types/database.types";

import { psqlAs } from "./support/psql";
import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

type Client = SupabaseClient<Database>;

// Review M6, M1: while an expense edit or cancel is in flight, someone it affects
// must not be able to leave the group at a zero balance that the change is about
// to break. They would be left with a balance nobody can settle.
describe("leaving a group races with expense changes (review M1)", () => {
  const admin = adminClient();
  const users: TestUser[] = [];

  async function setup() {
    const [a, b] = (await Promise.all(["A", "B"].map((name) => createTestUser(admin, { displayName: name })))) as [
      TestUser,
      TestUser,
    ];
    users.push(a, b);
    const [asA, asB] = await Promise.all([signedInClient(a), signedInClient(b)]);
    const group = await asA.rpc("create_group", { p_name: `IT race ${randomUUID().slice(0, 8)}` });
    if (group.error) throw group.error;
    const invite = await asA.rpc("create_invitation", { p_group_id: group.data, p_max_uses: 1 });
    if (invite.error) throw invite.error;
    const joined = await asB.rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
    if (joined.error) throw joined.error;
    // A pays ₹100 for both, B pays ₹100 for both: everyone is at zero.
    const e1 = await addExpense(asA, group.data, a.id, [a.id, b.id]);
    await addExpense(asB, group.data, b.id, [a.id, b.id]);
    return { a, b, asA, asB, groupId: group.data, e1 };
  }

  async function addExpense(client: Client, groupId: string, paidBy: string, people: string[]) {
    const values: ExpenseFormValues = {
      ...blankExpenseValues({ splitWith: `group:${groupId}`, userIds: people, paidBy, currency: "INR", date: "2026-10-22" }),
      description: "Race",
      amount: "100",
    };
    const result = resolveExpense(values);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    const { data, error } = await client.rpc("create_expense", {
      ...payload,
      p_description: values.description,
      p_expense_date: values.date,
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
    });
    if (error) throw error;
    return data;
  }

  async function membershipAndNet(asA: Client, a: TestUser, groupId: string) {
    const { data: row } = await admin.from("group_members").select("left_at").eq("group_id", groupId).eq("user_id", a.id).single();
    const { data: ledger } = await admin.from("ledger_entries").select("debtor_id, creditor_id, amount").eq("group_id", groupId);
    const net = (ledger ?? []).reduce((sum, l) => sum + (l.creditor_id === a.id ? l.amount : 0) - (l.debtor_id === a.id ? l.amount : 0), 0);
    void asA;
    return { left: row?.left_at !== null, net };
  }

  beforeAll(() => {
    users.length = 0;
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("a cancel in flight blocks the leave, which then sees the new balance", async () => {
    const { a, b, asA, groupId, e1 } = await setup();
    const slowCancel = psqlAs(b.id, `select public.cancel_expense('${e1}', 1);\nselect pg_sleep(3);`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const leave = await asA.rpc("leave_group", { p_group_id: groupId });
    const cancel = await slowCancel;
    expect(cancel.code, cancel.output).toBe(0);

    // With the cancel committed, A owes B ₹50, so A must not have left.
    expect(leave.error?.code).toBe("SM409");
    expect(await membershipAndNet(asA, a, groupId)).toEqual({ left: false, net: -5000 });
  });

  it("an edit in flight that drops a member blocks that member's leave", async () => {
    const { a, b, asA, groupId, e1 } = await setup();
    // B rewrites A's expense as B's own, for B alone: A no longer takes part in it.
    const values: ExpenseFormValues = {
      ...blankExpenseValues({ splitWith: `group:${groupId}`, userIds: [b.id], paidBy: b.id, currency: "INR", date: "2026-10-22" }),
      description: "Race",
      amount: "100",
    };
    const result = resolveExpense(values);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const payload = buildExpensePayload(result.expense);
    const args = `p_expense_id => '${e1}', p_expected_version => 1, p_description => 'Race', p_amount => ${payload.p_amount},
      p_currency => 'INR', p_expense_date => '2026-10-22', p_split_method => '${payload.p_split_method}',
      p_payers => '${JSON.stringify(payload.p_payers)}', p_participants => '${JSON.stringify(payload.p_participants)}',
      p_ledger_entries => '${JSON.stringify(payload.p_ledger_entries)}'`;
    const slowEdit = psqlAs(b.id, `select public.update_expense(${args});\nselect pg_sleep(3);`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const leave = await asA.rpc("leave_group", { p_group_id: groupId });
    const edit = await slowEdit;
    expect(edit.code, edit.output).toBe(0);

    expect(leave.error?.code).toBe("SM409");
    expect(await membershipAndNet(asA, a, groupId)).toEqual({ left: false, net: -5000 });
  });
});
