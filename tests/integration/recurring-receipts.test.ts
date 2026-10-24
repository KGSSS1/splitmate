import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayIn } from "@/lib/expenses/dates";
import { blankExpenseValues } from "@/lib/expenses/form-values";
import { buildExpensePayload } from "@/lib/expenses/payload";
import { resolveExpense } from "@/lib/expenses/resolve";
import type { Database } from "@/types/database.types";

import { psqlAdmin } from "./support/psql";
import { adminClient, anonClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

// M7 against local Supabase: a recurring expense created through the RPC, the
// generator run twice by hand, and receipts in the private bucket — uploaded
// through a signed upload URL, readable by members only.
describe("recurring expenses and receipts against local Supabase", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  let a: TestUser;
  let b: TestUser;
  let d: TestUser;
  let asA: SupabaseClient<Database>;
  let asB: SupabaseClient<Database>;
  let asD: SupabaseClient<Database>;
  let groupId: string;

  function payload(date: string) {
    const result = resolveExpense({
      ...blankExpenseValues({ splitWith: `group:${groupId}`, userIds: [a.id, b.id], paidBy: a.id, currency: "INR", date }),
      description: "Rent",
      amount: "20000",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { p_items, ...rest } = buildExpensePayload(result.expense);
    expect(p_items ?? null).toBeNull();
    return rest;
  }

  async function generate(): Promise<number> {
    const { code, output } = await psqlAdmin("select private.generate_recurring_expenses();");
    expect(code).toBe(0);
    return Number(output.trim());
  }

  beforeAll(async () => {
    const created = await Promise.all(["A", "B", "D"].map((name) => createTestUser(admin, { displayName: name })));
    [a, b, d] = created as [TestUser, TestUser, TestUser];
    users.push(a, b, d);
    [asA, asB, asD] = await Promise.all([signedInClient(a), signedInClient(b), signedInClient(d)]);

    const group = await asA.rpc("create_group", { p_name: `IT ${randomUUID().slice(0, 8)}` });
    if (group.error) throw group.error;
    groupId = group.data;
    const invite = await asA.rpc("create_invitation", { p_group_id: groupId });
    if (invite.error) throw invite.error;
    const joined = await asB.rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
    if (joined.error) throw joined.error;
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("creates today's expense on save, exactly once however often the generator runs", async () => {
    const today = todayIn("UTC");
    const key = randomUUID();
    const args = {
      ...payload(today),
      p_idempotency_key: key,
      p_group_id: groupId,
      p_description: "Rent",
      p_frequency: "monthly",
      p_start_date: today,
      p_timezone: "UTC",
    };
    const created = await asA.rpc("create_recurring_expense", args);
    expect(created.error).toBeNull();
    const recurringId = created.data ?? "";
    // A retried submission is the same template.
    expect((await asA.rpc("create_recurring_expense", args)).data).toBe(recurringId);

    const occurrences = async () =>
      (await asB.from("recurring_occurrences").select("occurrence_date, expense_id").eq("recurring_expense_id", recurringId))
        .data ?? [];
    expect(await occurrences()).toHaveLength(1);

    await generate();
    await generate();
    const after = await occurrences();
    expect(after).toEqual([{ occurrence_date: today, expense_id: expect.any(String) }]);

    // The generated expense is an ordinary one, with the stored split, in the group's balances.
    const expense = await asB.from("expenses").select("amount, created_by, expense_date").eq("id", after[0]?.expense_id ?? "").single();
    expect(expense.data).toEqual({ amount: 2000000, created_by: a.id, expense_date: today });
    const nets = await asB.rpc("group_balances", { p_group_id: groupId });
    expect(Object.fromEntries((nets.data ?? []).map((row) => [row.user_id, row.amount]))).toEqual({
      [a.id]: 1000000,
      [b.id]: -1000000,
    });

    // An outsider neither sees nor controls it.
    expect((await asD.from("recurring_expenses").select("id").eq("id", recurringId)).data).toEqual([]);
    const paused = await asD.rpc("set_recurring_expense_status", { p_recurring_id: recurringId, p_status: "paused" });
    expect(paused.error).toMatchObject({ code: "SM404", message: "Recurring expense not found" });
  });

  it("stores receipts privately: members fetch them, a non-member cannot", async () => {
    const expense = await asA.rpc("create_expense", {
      ...payload(todayIn("UTC")),
      p_idempotency_key: randomUUID(),
      p_group_id: groupId,
      p_description: "Groceries",
      p_expense_date: todayIn("UTC"),
    });
    expect(expense.error).toBeNull();
    const expenseId = expense.data ?? "";
    const path = `${expenseId}/${randomUUID()}.pdf`;
    const content = "%PDF-1.7\nSplitMate test receipt\n";

    // B (a member) gets a signed upload URL and uploads with it, as the browser does.
    const signed = await asB.storage.from("receipts").createSignedUploadUrl(path);
    expect(signed.error).toBeNull();
    const put = await fetch(signed.data?.signedUrl ?? "", {
      method: "PUT",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        "content-type": "application/pdf",
        "x-upsert": "false",
      },
      body: content,
    });
    expect(put.ok).toBe(true);
    // The object belongs to B, so B can record it (the attachments trigger checks the owner).
    const attached = await asB.from("attachments").insert({
      expense_id: expenseId,
      uploaded_by: b.id,
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: content.length,
      file_name: "receipt.pdf",
    });
    expect(attached.error).toBeNull();

    // A (a member) can open it through a short-lived signed URL.
    const link = await asA.storage.from("receipts").createSignedUrl(path, 60);
    expect(link.error).toBeNull();
    const opened = await fetch(link.data?.signedUrl ?? "");
    expect(opened.headers.get("content-type")).toBe("application/pdf");
    expect(await opened.text()).toBe(content);

    // D (not a member) gets nothing, through any route.
    expect((await asD.storage.from("receipts").download(path)).error).not.toBeNull();
    expect((await asD.storage.from("receipts").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await asD.storage.from("receipts").createSignedUploadUrl(`${expenseId}/${randomUUID()}.pdf`)).error).not.toBeNull();
    expect((await asD.storage.from("receipts").list(expenseId)).data ?? []).toEqual([]);
    expect((await asD.from("attachments").select("id").eq("expense_id", expenseId)).data).toEqual([]);
    expect((await anonClient().storage.from("receipts").download(path)).error).not.toBeNull();
  });
});
