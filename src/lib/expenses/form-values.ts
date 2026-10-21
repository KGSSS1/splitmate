import { minorToDecimalString } from "@/lib/money/format";

import { type AdjustmentKind, isSplitMethod } from "./options";
import { formatBasisPoints } from "./percent";
import type { ExpenseFormValues, ExpensePersonValues } from "./resolve";
import { MULTIPLE_PAYERS } from "./resolve";

/** A row per person, everyone included in an equal split. */
export function blankPeople(userIds: readonly string[]): ExpensePersonValues[] {
  return userIds.map((userId) => ({ userId, included: true, paid: "", exact: "", percent: "", shares: "1" }));
}

export function blankExpenseValues({
  splitWith,
  userIds,
  paidBy,
  currency,
  date,
}: {
  splitWith: string;
  userIds: readonly string[];
  paidBy: string;
  currency: string;
  date: string;
}): ExpenseFormValues & { splitWith: string } {
  return {
    splitWith,
    description: "",
    amount: "",
    currency,
    date,
    category: "",
    notes: "",
    tags: "",
    paidBy,
    splitMethod: "equal",
    people: blankPeople(userIds),
    items: [],
    adjustments: [],
  };
}

/** One stored version of an expense, as read from the database. */
export interface StoredExpense {
  description: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string | null;
  notes: string | null;
  tags: string[];
  splitMethod: string;
  payers: { userId: string; amount: number }[];
  participants: { userId: string; amount: number; basisPoints: number | null; weight: number | null }[];
  items: {
    kind: string;
    name: string;
    amount: number;
    allocation: string | null;
    assignees: string[];
  }[];
}

/**
 * Form values that reproduce a stored expense (to edit or duplicate it).
 * `userIds` is everyone who can take part now, in entry order; anyone in the
 * expense who is missing from it is added at the end.
 */
export function storedToFormValues(
  stored: StoredExpense,
  { splitWith, userIds }: { splitWith: string; userIds: readonly string[] },
): ExpenseFormValues & { splitWith: string } {
  const decimal = (amount: number) => minorToDecimalString(amount, stored.currency);
  const involved = [...stored.payers.map((p) => p.userId), ...stored.participants.map((p) => p.userId)];
  const order = [...new Set([...userIds, ...involved])];
  const participant = new Map(stored.participants.map((p) => [p.userId, p]));
  const paid = new Map(stored.payers.map((p) => [p.userId, p.amount]));
  const method = isSplitMethod(stored.splitMethod) ? stored.splitMethod : "exact";
  const singlePayer = stored.payers.length === 1 ? stored.payers[0]?.userId : undefined;

  return {
    splitWith,
    description: stored.description,
    amount: method === "itemized" ? "" : decimal(stored.amount),
    currency: stored.currency,
    date: stored.expenseDate,
    category: stored.category ?? "",
    notes: stored.notes ?? "",
    tags: stored.tags.join(", "),
    paidBy: singlePayer ?? MULTIPLE_PAYERS,
    splitMethod: method,
    people: order.map((userId) => {
      const share = participant.get(userId);
      const paidAmount = paid.get(userId);
      return {
        userId,
        included: share !== undefined,
        paid: singlePayer || paidAmount === undefined ? "" : decimal(paidAmount),
        exact: share ? decimal(share.amount) : "",
        percent: share?.basisPoints != null ? formatBasisPoints(share.basisPoints) : "",
        shares: String(share?.weight ?? 1),
      };
    }),
    items: stored.items
      .filter((item) => item.kind === "item")
      .map((item) => ({ name: item.name, amount: decimal(item.amount), assignees: item.assignees })),
    adjustments: stored.items
      .filter((item) => item.kind !== "item")
      .map((item) => ({
        kind: item.kind as AdjustmentKind,
        amount: decimal(item.amount),
        allocation: item.allocation === "equal" ? "equal" : "proportional",
      })),
  };
}
