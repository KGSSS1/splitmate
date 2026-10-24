"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { buildExpensePayload, parseTags } from "@/lib/expenses/payload";
import { type ExpenseFormValues, resolveExpense } from "@/lib/expenses/resolve";
import { createClient } from "@/lib/supabase/server";
import {
  addCommentSchema,
  cancelExpenseSchema,
  commentIdSchema,
  createExpenseSchema,
  parseSplitWith,
  updateExpenseSchema,
} from "@/lib/validation/expenses";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireOnboardedProfile } from "@/server/auth";

const EXPENSES = "/expenses";

/**
 * Re-resolves the split on the server from what the user entered (never from
 * amounts computed in the browser) and builds the RPC arguments shared by
 * create and update. The schema has already resolved it once, so this cannot fail.
 */
function rpcArguments(values: ExpenseFormValues) {
  const result = resolveExpense(values);
  if (!result.ok) throw new Error("A validated expense failed to resolve.");
  const { p_items, ...payload } = buildExpensePayload(result.expense);
  return {
    ...payload,
    // Left out for non-itemized splits (the SQL default is null).
    ...(p_items ? { p_items } : {}),
    p_description: values.description.trim(),
    p_expense_date: values.date,
    p_category: values.category.trim(),
    p_notes: values.notes.trim(),
    p_tags: parseTags(values.tags),
  };
}

/**
 * Creates a group or direct expense. The idempotency key comes from the form
 * and stays the same across retries, so a double submit creates one expense.
 */
export async function createExpense(input: unknown): Promise<ActionResult> {
  const parsed = createExpenseSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { values, idempotencyKey } = parsed.data;
  const where = parseSplitWith(values.splitWith);
  if (!where) return { ok: false, error: "Choose a group or a friend." };

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: expenseId, error } = await supabase.rpc("create_expense", {
    ...rpcArguments(values),
    p_idempotency_key: idempotencyKey,
    // A direct expense has no group; the generated type does not allow null here.
    p_group_id: where.kind === "group" ? where.id : (null as unknown as string),
  });
  if (error) return rpcFailure(error);

  redirect(`${EXPENSES}/${expenseId}?saved=created`);
}

/** Writes the next version; the database rejects a stale `expectedVersion` (SM409). */
export async function updateExpense(input: unknown): Promise<ActionResult> {
  const parsed = updateExpenseSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { values, expenseId, expectedVersion } = parsed.data;

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("update_expense", {
    ...rpcArguments(values),
    p_expense_id: expenseId,
    p_expected_version: expectedVersion,
  });
  if (error) return rpcFailure(error);

  // The database keeps the version when nothing changed (SPEC §10).
  redirect(`${EXPENSES}/${expenseId}?saved=${version === expectedVersion ? "unchanged" : "updated"}`);
}

/** Reversing ledger entries only; the expense and its history stay. */
export async function cancelExpense(input: unknown): Promise<ActionResult> {
  const parsed = cancelExpenseSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_expense", {
    p_expense_id: parsed.data.expenseId,
    p_expected_version: parsed.data.expectedVersion,
  });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "Expense cancelled. Its effect on balances has been reversed." };
}

/** RLS allows comments from people who can still change the expense. */
export async function addComment(input: unknown): Promise<ActionResult> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const profile = await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .insert({ expense_id: parsed.data.expenseId, author_id: profile.id, body: parsed.data.body });
  if (error) {
    return error.code === "42501"
      ? { ok: false, error: "You can't comment on this expense." }
      : { ok: false, error: "Couldn't post your comment. Please try again." };
  }

  refresh();
  return { ok: true };
}

/** Soft-deletes the caller's own comment (RLS: own, not yet deleted). */
export async function deleteComment(input: unknown): Promise<ActionResult> {
  const parsed = commentIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.commentId)
    .select("id");
  if (error || data.length !== 1) return { ok: false, error: "Couldn't delete that comment." };

  refresh();
  return { ok: true };
}
