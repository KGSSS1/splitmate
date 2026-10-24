import type { ResolvedExpense } from "./resolve";

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
