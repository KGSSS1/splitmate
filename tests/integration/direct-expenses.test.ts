import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { EXPENSES_PAGE_SIZE } from "@/lib/expenses/options";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import { loadDirectExpenses } from "@/server/expenses";
import type { Database } from "@/types/database.types";

import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

// src/server/expenses.ts is server-only; here it runs with signed-in test clients.
vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;

// Review M6, M6: the friend page used to load the caller's latest 100 direct
// expenses with anyone and then keep the ones with this friend, so older
// expenses with a friend silently disappeared once there were 100 newer ones
// with other friends. It now lists exactly the expenses with that friend, paged.
describe("direct expenses with one friend (review M6)", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let asA: Client;
  let withB: string;

  async function addDirect(client: Client, payer: TestUser, other: TestUser, description: string, date: string) {
    const values: ExpenseFormValues = {
      ...blankExpenseValues({ splitWith: `friend:${other.id}`, userIds: [payer.id, other.id], paidBy: payer.id, currency: "INR", date }),
      description,
      amount: "100",
    };
    const result = resolveExpense(values);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...payload } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    const { data, error } = await client.rpc("create_expense", {
      ...payload,
      p_description: description,
      p_expense_date: date,
      p_idempotency_key: randomUUID(),
      p_group_id: null as unknown as string,
    });
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    [a, b, c] = (await Promise.all(["A", "B", "C"].map((name) => createTestUser(admin, { displayName: name })))) as [
      TestUser,
      TestUser,
      TestUser,
    ];
    users.push(a, b, c);
    asA = await signedInClient(a);
    // Joining one group makes all three friends.
    const group = await asA.rpc("create_group", { p_name: `IT direct ${randomUUID().slice(0, 8)}` });
    if (group.error) throw group.error;
    const invite = await asA.rpc("create_invitation", { p_group_id: group.data, p_max_uses: 2 });
    if (invite.error) throw invite.error;
    for (const user of [b, c]) {
      const joined = await (await signedInClient(user)).rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
      if (joined.error) throw joined.error;
    }
    // One older expense with B, then 101 newer ones with C.
    withB = await addDirect(asA, a, b, "With B", "2026-01-01");
    for (let i = 0; i < 101; i += 1) await addDirect(asA, a, c, `With C ${i}`, "2026-10-20");
  }, 120_000);

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("lists an older expense with one friend, however many newer ones exist with others", async () => {
    const page = await loadDirectExpenses(asA, a.id, b.id, 1);
    expect(page.items.map((item) => item.id)).toEqual([withB]);
    expect(page.total).toBe(1);
  });

  it("pages through all the expenses with a friend", async () => {
    const first = await loadDirectExpenses(asA, a.id, c.id, 1);
    expect(first.total).toBe(101);
    expect(first.pageCount).toBe(Math.ceil(101 / EXPENSES_PAGE_SIZE));
    expect(first.items).toHaveLength(EXPENSES_PAGE_SIZE);
    const last = await loadDirectExpenses(asA, a.id, c.id, first.pageCount);
    expect(last.items).toHaveLength(101 - EXPENSES_PAGE_SIZE * (first.pageCount - 1));
    expect(first.items.every((item) => item.description.startsWith("With C"))).toBe(true);
  });
});
