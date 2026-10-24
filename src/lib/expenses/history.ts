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
  /**
   * Recorded since review M4. `undefined` means an older snapshot that didn't
   * record the field, so no change is reported for it.
   */
  notes?: string | null;
  tags?: string[];
  items?: SnapshotItem[];
}

export interface SnapshotItem {
  kind: string;
  name: string;
  amount: number;
  allocation: string | null;
  assignees: string[];
}

function snapshotItems(value: unknown): SnapshotItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((row) =>
    isRecord(row) && typeof row.name === "string" && typeof row.kind === "string" && Number.isSafeInteger(row.amount)
      ? [
          {
            kind: row.kind,
            name: row.name,
            amount: row.amount as number,
            allocation: typeof row.allocation === "string" ? row.allocation : null,
            assignees: Array.isArray(row.assignees)
              ? row.assignees.filter((id): id is string => typeof id === "string")
              : [],
          },
        ]
      : [],
  );
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
    ...("notes" in value ? { notes: typeof value.notes === "string" ? value.notes : null } : {}),
    ...(Array.isArray(value.tags) ? { tags: value.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
    ...(Array.isArray(value.items) ? { items: snapshotItems(value.items) } : {}),
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
  // Recorded since review M4: compared only when both versions have them.
  if (before.notes !== undefined && after.notes !== undefined) {
    add("Notes", before.notes ?? "None", after.notes ?? "None");
  }
  if (before.tags && after.tags) add("Tags", before.tags.join(", ") || "None", after.tags.join(", ") || "None");
  if (before.items && after.items) {
    add("Items", items(before.items, before.currency, nameOf), items(after.items, after.currency, nameOf));
  }
  return changes;
}

function items(rows: SnapshotItem[], currency: string, nameOf: (id: string) => string): string {
  return (
    rows
      .map((row) => {
        const who =
          row.kind === "item"
            ? row.assignees.map(nameOf).join(", ")
            : row.allocation === "equal"
              ? "split equally"
              : "split by items";
        return `${row.name} ${formatMoney(row.amount, currency)} (${who})`;
      })
      .join("; ") || "None"
  );
}

/** Every user ID mentioned in a snapshot. */
export function snapshotUsers(snapshot: ExpenseSnapshot | null): string[] {
  if (!snapshot) return [];
  return [
    ...[...snapshot.payers, ...snapshot.participants].map((row) => row.userId),
    ...(snapshot.items ?? []).flatMap((item) => item.assignees),
  ];
}
