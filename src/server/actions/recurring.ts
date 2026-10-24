"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { expenseRpcArguments } from "@/lib/expenses/payload";
import { createClient } from "@/lib/supabase/server";
import { parseSplitWith } from "@/lib/validation/expenses";
import {
  createRecurringSchema,
  firstDateProblem,
  type recurringFormSchema,
  recurringStatusSchema,
  updateRecurringSchema,
} from "@/lib/validation/recurring";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireOnboardedProfile } from "@/server/auth";

const RECURRING = "/recurring";

/** The template's RPC arguments: the expense's, with the date as the first date and the schedule added. */
function templateArguments(values: z.output<typeof recurringFormSchema>) {
  const { p_expense_date, ...expense } = expenseRpcArguments(values);
  return {
    ...expense,
    p_start_date: p_expense_date,
    p_frequency: values.repeat.frequency,
    p_timezone: values.repeat.timezone,
    // Left out for "no end date" (the SQL default is null).
    ...(values.repeat.endDate ? { p_end_date: values.repeat.endDate } : {}),
  };
}

/**
 * Sets up a recurring expense. Anything already due (a first date today or in
 * the last 31 days) is created straight away by the database.
 */
export async function createRecurringExpense(input: unknown): Promise<ActionResult> {
  const parsed = createRecurringSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { values, idempotencyKey } = parsed.data;
  const where = parseSplitWith(values.splitWith);
  if (!where) return { ok: false, error: "Choose a group or a friend." };
  const dateProblem = firstDateProblem(values.date, values.repeat.timezone);
  if (dateProblem) return { ok: false, error: dateProblem, fieldErrors: { date: dateProblem } };

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: recurringId, error } = await supabase.rpc("create_recurring_expense", {
    ...templateArguments(values),
    p_idempotency_key: idempotencyKey,
    // A direct template has no group; the generated type does not allow null here.
    p_group_id: where.kind === "group" ? where.id : (null as unknown as string),
  });
  if (error) return rpcFailure(error);

  redirect(`${RECURRING}/${recurringId}?saved=created`);
}

/** Changes future occurrences only; the database rejects a stale `expectedVersion` (SM409). */
export async function updateRecurringExpense(input: unknown): Promise<ActionResult> {
  const parsed = updateRecurringSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { values, recurringId, expectedVersion } = parsed.data;

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("update_recurring_expense", {
    ...templateArguments(values),
    p_recurring_id: recurringId,
    p_expected_version: expectedVersion,
  });
  if (error) return rpcFailure(error);

  redirect(`${RECURRING}/${recurringId}?saved=${version === expectedVersion ? "unchanged" : "updated"}`);
}

const STATUS_MESSAGES = {
  paused: "Paused. No expenses are added until you resume it.",
  active: "Resumed. Dates that passed while it was paused are skipped.",
  cancelled: "Cancelled. Expenses it already added stay.",
} as const;

/** Pause, resume or cancel. */
export async function setRecurringStatus(input: unknown): Promise<ActionResult> {
  const parsed = recurringStatusSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_recurring_expense_status", {
    p_recurring_id: parsed.data.recurringId,
    p_status: parsed.data.status,
  });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: STATUS_MESSAGES[parsed.data.status] };
}
