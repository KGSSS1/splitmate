import "server-only";

import { type CsvValue, toCsv } from "@/lib/export/csv";
import { isCurrencyCode } from "@/lib/money/currencies";
import { minorToDecimalString } from "@/lib/money/format";
import type { createClient } from "@/lib/supabase/server";
import { getGroupNames, getPersonCards } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

/** The Data API returns at most this many rows per call (supabase/config.toml `max_rows`). */
const PAGE_SIZE = 1000;
/** More than this in one dataset means something is off; the export stops instead of growing without bound. */
export const MAX_EXPORT_ROWS = 50_000;

export class ExportTooLargeError extends Error {
  constructor(dataset: string) {
    super(`Too many rows in ${dataset}.`);
    this.name = "ExportTooLargeError";
  }
}

/**
 * Every table a person can see something of, read through their own session:
 * RLS decides the rows, exactly as in the app. Group invitations are left out
 * (their token hashes are never readable, and their addresses are others' data).
 */
export const EXPORT_DATASETS = {
  profile: { table: "profiles", order: "id", label: "Your profile" },
  friendships: { table: "friendships", order: "id", label: "Friendships and friend requests" },
  sent_friend_requests: { table: "friend_email_requests", order: "id", label: "Friend requests you sent by email" },
  group_memberships: { table: "group_members", order: "id", label: "Group memberships (yours and your groups' members)" },
  groups: { table: "groups", order: "id", label: "Groups" },
  expenses: { table: "expenses", order: "id", label: "Expenses" },
  expense_payers: { table: "expense_payers", order: "id", label: "Who paid, per expense version" },
  expense_participants: { table: "expense_participants", order: "id", label: "Shares, per expense version" },
  expense_items: { table: "expense_items", order: "id", label: "Itemized lines" },
  expense_item_assignments: { table: "expense_item_assignments", order: "id", label: "Who shared each item" },
  comments: { table: "comments", order: "id", label: "Comments" },
  receipts: { table: "attachments", order: "id", label: "Receipts (file details, not the files)" },
  settlements: { table: "settlements", order: "id", label: "Repayments" },
  ledger_entries: { table: "ledger_entries", order: "id", label: "Ledger (who owes whom, entry by entry)" },
  recurring_expenses: { table: "recurring_expenses", order: "id", label: "Recurring expenses" },
  recurring_occurrences: { table: "recurring_occurrences", order: "id", label: "Recurring expense dates" },
  notifications: { table: "notifications", order: "id", label: "Notifications" },
  notification_preferences: { table: "notification_preferences", order: "type", label: "Notification settings" },
  history: { table: "audit_events", order: "id", label: "History of changes" },
} as const;

export type ExportDataset = keyof typeof EXPORT_DATASETS;

export function isExportDataset(value: unknown): value is ExportDataset {
  return typeof value === "string" && Object.hasOwn(EXPORT_DATASETS, value);
}

/** Every row of one dataset the viewer can see, page by page in a stable order. */
export async function loadDataset(supabase: Client, dataset: ExportDataset): Promise<Row[]> {
  const { table, order } = EXPORT_DATASETS[dataset];
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(order)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not export ${dataset}.`);
    rows.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) return rows;
    if (rows.length >= MAX_EXPORT_ROWS) throw new ExportTooLargeError(dataset);
  }
}

const PERSON_COLUMNS = [
  "user_id",
  "user_low",
  "user_high",
  "requested_by",
  "created_by",
  "updated_by",
  "cancelled_by",
  "removed_by",
  "payer_id",
  "receiver_id",
  "debtor_id",
  "creditor_id",
  "author_id",
  "uploaded_by",
  "actor_id",
] as const;

export interface AccountExport {
  format: "splitmate-export";
  version: 1;
  exportedAt: string;
  notes: string[];
  /** Names of the people and groups mentioned, as the viewer can see them. */
  people: Record<string, string>;
  groupNames: Record<string, string>;
  data: Record<ExportDataset, Row[]>;
}

/** Everything the viewer can see, as one JSON document. */
export async function buildAccountExport(supabase: Client, now = new Date()): Promise<AccountExport> {
  const datasets = Object.keys(EXPORT_DATASETS) as ExportDataset[];
  const loaded = await Promise.all(datasets.map(async (dataset) => [dataset, await loadDataset(supabase, dataset)] as const));
  const data = Object.fromEntries(loaded) as Record<ExportDataset, Row[]>;

  const personIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const rows of Object.values(data)) {
    for (const row of rows) {
      for (const column of PERSON_COLUMNS) if (typeof row[column] === "string") personIds.add(row[column]);
      if (typeof row.group_id === "string") groupIds.add(row.group_id);
    }
  }
  const [cards, groupNames] = await Promise.all([getPersonCards(supabase, [...personIds]), getGroupNames(supabase, [...groupIds])]);

  return {
    format: "splitmate-export",
    version: 1,
    exportedAt: now.toISOString(),
    notes: [
      "Amounts are integers in the currency's minor unit (paise for INR, cents for USD, yen for JPY).",
      "Rows are everything your account can see: your own records and those of the groups you are in.",
      "Expense payers, shares and items are kept per version; the expense's `version` is the current one.",
      "Receipt files are not included; open them in the app.",
    ],
    people: Object.fromEntries([...cards.values()].map((card) => [card.id, card.displayName])),
    groupNames: Object.fromEntries(groupNames),
    data,
  };
}

function cell(value: unknown): CsvValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * One dataset as CSV: every column as stored, plus `amount_decimal` next to an
 * `amount` with a currency, so spreadsheets show 900.00 rather than 90000.
 */
export async function buildDatasetCsv(supabase: Client, dataset: ExportDataset): Promise<string> {
  const rows = await loadDataset(supabase, dataset);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const withDecimal = columns.includes("amount") && columns.includes("currency");
  const header = withDecimal ? [...columns, "amount_decimal"] : columns;
  return toCsv(
    header,
    rows.map((row) => {
      const cells = columns.map((column) => cell(row[column]));
      if (!withDecimal) return cells;
      const { amount, currency } = row;
      const decimal =
        Number.isSafeInteger(amount) && typeof currency === "string" && isCurrencyCode(currency)
          ? minorToDecimalString(amount as number, currency)
          : null;
      return [...cells, decimal];
    }),
  );
}
