import { type ExpenseFormValues, type ResolvedExpense, resolveExpense } from "./resolve";

/**
 * The jsonb payloads of `create_expense` / `update_expense`, in the shape the
 * M2 functions validate (see the comment at the top of
 * supabase/migrations/20261021130700_rpc_expenses.sql). Everything here comes
 * from the accounting module; SQL only checks the invariants.
 */
export interface ExpensePayload {
  p_amount: number;
  p_currency: string;
  p_split_method: string;
  p_payers: { user_id: string; amount: number }[];
  p_participants: {
    user_id: string;
    amount: number;
    basis_points?: number;
    weight?: number;
    received_rounding_unit: boolean;
  }[];
  p_ledger_entries: { debtor_id: string; creditor_id: string; amount: number }[];
  p_items: {
    name: string;
    kind: string;
    amount: number;
    allocation?: string;
    assignments?: { user_id: string; weight: number }[];
  }[] | null;
}

export function buildExpensePayload(expense: ResolvedExpense): ExpensePayload {
  return {
    p_amount: expense.total,
    p_currency: expense.currency,
    p_split_method: expense.splitMethod,
    p_payers: expense.payers.map((payer) => ({ user_id: payer.userId, amount: payer.amount })),
    p_participants: expense.shares.map((share) => {
      const basisPoints = expense.basisPoints.get(share.userId);
      const weight = expense.weights.get(share.userId);
      return {
        user_id: share.userId,
        amount: share.amount,
        ...(basisPoints === undefined ? {} : { basis_points: basisPoints }),
        ...(weight === undefined ? {} : { weight }),
        received_rounding_unit: share.roundingUnit === 1,
      };
    }),
    p_ledger_entries: expense.debts.map((debt) => ({
      debtor_id: debt.debtorId,
      creditor_id: debt.creditorId,
      amount: debt.amount,
    })),
    p_items:
      expense.splitMethod === "itemized"
        ? expense.items.map((item) =>
            item.kind === "item"
              ? {
                  name: item.name,
                  kind: "item",
                  amount: item.amount,
                  assignments: (item.assignees ?? []).map((userId) => ({ user_id: userId, weight: 1 })),
                }
              : { name: item.name, kind: item.kind, amount: item.amount, allocation: item.allocation ?? "proportional" },
          )
        : null,
  };
}

/** "goa, beach , ,trip" → ["goa", "beach", "trip"] (unique, each 1–40 characters, at most 20). */
export function parseTags(input: string): string[] {
  return [...new Set(input.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * Re-resolves the split on the server from what the user entered (never from
 * amounts computed in the browser) and builds the RPC arguments shared by
 * expenses and recurring templates. Callers validate `values` with the form
 * schema first, which has already resolved it once, so this cannot fail.
 */
export function expenseRpcArguments(values: ExpenseFormValues) {
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
