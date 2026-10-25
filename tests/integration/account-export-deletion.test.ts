import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { todayIn } from "@/lib/expenses/dates";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { resolveExpense } from "@/lib/expenses/resolve";
import { buildAccountExport, buildDatasetCsv } from "@/server/data-export";
import type { Database } from "@/types/database.types";

import { adminClient, anonClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

// The server modules are server-only; here they run with signed-in test clients.
vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
const TODAY = todayIn("UTC");

// M9: the data export holds only what the viewer can see, and account deletion
// (one RPC) anonymizes the profile, removes the auth user and every session,
// and leaves other people's history and balances intact.
describe("data export and account deletion against local Supabase", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  const tag = randomUUID().slice(0, 6);
  let a: TestUser;
  let b: TestUser;
  let d: TestUser;
  let asA: Client;
  let asB: Client;
  let asD: Client;
  let groupId: string;
  let otherGroupId: string;
  let expenseId: string;

  async function equalExpense(client: Client, group: string, people: string[], payer: string, description: string) {
    const result = resolveExpense({
      ...blankExpenseValues({ splitWith: `group:${group}`, userIds: people, paidBy: payer, currency: "INR", date: TODAY }),
      description,
      amount: "900",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    const created = await client.rpc("create_expense", {
      ...payload,
      p_idempotency_key: randomUUID(),
      p_group_id: group,
      p_description: description,
      p_expense_date: TODAY,
    });
    if (created.error) throw created.error;
    return created.data;
  }

  beforeAll(async () => {
    const created = await Promise.all(["Asha", "Bina", "Dev"].map((name) => createTestUser(admin, { displayName: `${name} ${tag}` })));
    [a, b, d] = created as [TestUser, TestUser, TestUser];
    users.push(a, b, d);
    [asA, asB, asD] = (await Promise.all([a, b, d].map((user) => signedInClient(user)))) as [Client, Client, Client];

    const group = await asA.rpc("create_group", { p_name: `Home ${tag}` });
    if (group.error) throw group.error;
    groupId = group.data;
    const invite = await asA.rpc("create_invitation", { p_group_id: groupId });
    if (invite.error) throw invite.error;
    const joined = await asB.rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
    if (joined.error) throw joined.error;
    expenseId = await equalExpense(asA, groupId, [a.id, b.id], a.id, `Dinner ${tag}`);

    const other = await asD.rpc("create_group", { p_name: `Away ${tag}` });
    if (other.error) throw other.error;
    otherGroupId = other.data;
    await equalExpense(asD, otherGroupId, [d.id], d.id, `Solo ${tag}`);
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("the JSON export holds what the viewer can see and nothing from other groups", async () => {
    const exported = await buildAccountExport(asA);
    expect(exported.data.profile).toEqual([expect.objectContaining({ id: a.id, display_name: `Asha ${tag}` })]);
    expect(exported.data.groups.map((row) => row.id)).toEqual([groupId]);
    expect(exported.data.expenses.map((row) => row.description)).toContain(`Dinner ${tag}`);
    const everything = JSON.stringify(exported);
    expect(everything).not.toContain(otherGroupId);
    expect(everything).not.toContain(`Solo ${tag}`);
    expect(everything).not.toContain(d.id);
    // Never anyone's email but your own, never invitation tokens.
    expect(everything).not.toContain(b.email.toLowerCase());
    expect(everything).not.toMatch(/token_hash/);
    expect(exported.people[b.id]).toBe(`Bina ${tag}`);
    expect(exported.data.ledger_entries.length).toBeGreaterThan(0);
  });

  it("CSV files are per table, with decimal amounts", async () => {
    const csv = await buildDatasetCsv(asA, "expense_participants");
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toMatch(/,amount_decimal$/);
    expect(lines.slice(1).filter((line) => line.includes(expenseId))).toHaveLength(2);
    expect(lines.slice(1).every((line) => line.endsWith(",450.00"))).toBe(true);
  });

  it("refuses to delete while a balance is open, then deletes once settled", async () => {
    const refused = await asB.rpc("delete_my_account", { p_confirmation: "DELETE" });
    expect(refused.error).toMatchObject({ code: "SM409", message: "Settle up first: you still have a balance in a group" });

    // Asha records Bina's ₹450 repayment: completed, both are at zero.
    const settled = await asA.rpc("create_settlement", {
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
      p_payer_id: b.id,
      p_receiver_id: a.id,
      p_amount: 45000,
      p_currency: "INR",
    });
    expect(settled.error).toBeNull();
    const { data: session } = await asB.auth.getSession();
    const refreshToken = session.session?.refresh_token ?? "";

    const deleted = await asB.rpc("delete_my_account", { p_confirmation: "DELETE" });
    expect(deleted.error).toBeNull();

    // The auth user is gone: no login, and the old refresh token is dead.
    expect((await admin.auth.admin.getUserById(b.id)).data.user).toBeNull();
    const login = await anonClient().auth.signInWithPassword({ email: b.email, password: b.password });
    expect(login.error).not.toBeNull();
    const refresh = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
    expect(refresh.error).not.toBeNull();

    // History stays, under "Deleted user"; Asha's group view is unchanged.
    const { data: profile } = await admin.from("profiles").select("display_name, email, deleted_at").eq("id", b.id).single();
    expect(profile).toMatchObject({ display_name: "Deleted user", email: null });
    expect(profile?.deleted_at).not.toBeNull();
    const cards = await asA.rpc("profile_cards", { p_user_ids: [b.id] });
    expect(cards.data?.[0]?.display_name).toBe("Deleted user");
    const expense = await asA.from("expenses").select("description, status").eq("id", expenseId).single();
    expect(expense.data).toEqual({ description: `Dinner ${tag}`, status: "active" });
    const nets = await asA.rpc("group_balances", { p_group_id: groupId });
    expect((nets.data ?? []).every((row) => row.amount === 0)).toBe(true);

    // The same email can sign up again as a new person.
    const again = await admin.auth.admin.createUser({ email: b.email, password: b.password, email_confirm: true });
    expect(again.error).toBeNull();
    users.push({ id: again.data.user?.id ?? "", email: b.email, password: b.password });
  });
});
