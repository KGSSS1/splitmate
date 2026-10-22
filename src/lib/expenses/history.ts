import { isCurrencyCode } from "@/lib/money/currencies";
import { formatMoney } from "@/lib/money/format";

import { categoryLabel, isSplitMethod, SPLIT_METHOD_LABELS } from "./options";

/**
 * The expense snapshot written to `audit_events.before/after` by the database
 * (`private.expense_snapshot`). Parsed defensively: audit rows are JSON.
 */
export interface ExpenseSnapshot {
  version: number;
  status: string;
  description: string;
  amount: number;
  currency: string;
  expenseDate: string;
  splitMethod: string;
  category: string | null;
  payers: { userId: string; amount: number }[];
  participants: { userId: string; amount: number }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function userAmounts(value: unknown): { userId: string; amount: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) =>
    isRecord(row) && typeof row.user_id === "string" && Number.isSafeInteger(row.amount)
      ? [{ userId: row.user_id, amount: row.amount as number }]
      : [],
  );
}

export function parseSnapshot(value: unknown): ExpenseSnapshot | null {
  if (!isRecord(value)) return null;
  const { version, status, description, amount, currency, expense_date, split_method, category } = value;
  if (
    typeof description !== "string" ||
    !Number.isSafeInteger(amount) ||
    typeof currency !== "string" ||
    !isCurrencyCode(currency)
  ) {
    return null;
  }
  return {
    version: Number.isSafeInteger(version) ? (version as number) : 1,
    status: typeof status === "string" ? status : "active",
    description,
    amount: amount as number,
    currency,
    expenseDate: typeof expense_date === "string" ? expense_date : "",
    splitMethod: typeof split_method === "string" ? split_method : "",
    category: typeof category === "string" ? category : null,
    payers: userAmounts(value.payers),
    participants: userAmounts(value.participants),
  };
}

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

function amounts(rows: { userId: string; amount: number }[], currency: string, nameOf: (id: string) => string) {
  return (
    [...rows]
      .sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId)))
      .map((row) => `${nameOf(row.userId)} ${formatMoney(row.amount, currency)}`)
      .join(", ") || "—"
  );
}

/** What changed between two versions, in words, for the history view (SPEC §10: before/after amounts). */
export function describeChanges(
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
  nameOf: (id: string) => string,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const add = (label: string, a: string, b: string) => {
    if (a !== b) changes.push({ label, before: a, after: b });
  };
  const method = (value: string) => (isSplitMethod(value) ? SPLIT_METHOD_LABELS[value] : value);

  add("Description", before.description, after.description);
  add("Amount", formatMoney(before.amount, before.currency), formatMoney(after.amount, after.currency));
  add("Date", before.expenseDate, after.expenseDate);
  add("Category", categoryLabel(before.category) ?? "None", categoryLabel(after.category) ?? "None");
  add("Split", method(before.splitMethod), method(after.splitMethod));
  add("Paid by", amounts(before.payers, before.currency, nameOf), amounts(after.payers, after.currency, nameOf));
  add(
    "Shares",
    amounts(before.participants, before.currency, nameOf),
    amounts(after.participants, after.currency, nameOf),
  );
  return changes;
}

/** Every user ID mentioned in a snapshot. */
export function snapshotUsers(snapshot: ExpenseSnapshot | null): string[] {
  if (!snapshot) return [];
  return [...snapshot.payers, ...snapshot.participants].map((row) => row.userId);
}
