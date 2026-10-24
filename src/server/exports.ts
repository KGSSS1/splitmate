import "server-only";

import type { DateRange } from "@/lib/analytics/periods";
import { categoryLabel } from "@/lib/expenses/options";
import { toCsv } from "@/lib/export/csv";
import { addMinor } from "@/lib/money/amount";
import { minorToDecimalString } from "@/lib/money/format";
import { isSettlementStatus, SETTLEMENT_STATUS_LABELS, settlementMethodLabel } from "@/lib/settlements/options";
import type { createClient } from "@/lib/supabase/server";
import { loadExpenseShares, loadSettlements } from "@/server/analytics";
import { getGroupNames, getPersonCards, nameOf } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

export const EXPORT_KINDS = ["expenses", "settlements"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && (EXPORT_KINDS as readonly string[]).includes(value);
}

export const EXPENSE_CSV_HEADER = [
  "Date",
  "Description",
  "Category",
  "Group",
  "Currency",
  "Total",
  "You paid",
  "Your share",
  "Your net (paid minus share)",
  "From a recurring expense",
  "Expense ID",
] as const;

export const SETTLEMENT_CSV_HEADER = [
  "Date",
  "Direction",
  "Other person",
  "Group",
  "Currency",
  "Amount",
  "Method",
  "Status",
  "Settlement ID",
] as const;

export interface CsvFile {
  fileName: string;
  body: string;
  rows: number;
}

/**
 * The viewer's active expenses in the range as CSV: one row per expense they
 * paid for or share in, with their own paid / share / net. Reads through the
 * viewer's own client, so RLS decides what can appear.
 */
export async function buildExpensesCsv(supabase: Client, range: DateRange): Promise<CsvFile> {
  const rows = await loadExpenseShares(supabase, range);
  const groupNames = await getGroupNames(supabase, rows.flatMap((row) => (row.groupId ? [row.groupId] : [])));
  const body = toCsv(
    EXPENSE_CSV_HEADER,
    rows.map((row) => [
      row.date,
      row.description,
      row.category ? categoryLabel(row.category) : null,
      row.groupId ? (groupNames.get(row.groupId) ?? "A group") : "Direct",
      row.currency,
      minorToDecimalString(row.amount, row.currency),
      minorToDecimalString(row.paid, row.currency),
      minorToDecimalString(row.share, row.currency),
      minorToDecimalString(addMinor(row.paid, -row.share), row.currency),
      row.recurringId ? "Yes" : "No",
      row.expenseId,
    ]),
  );
  return { fileName: `splitmate-expenses-${range.from}-to-${range.to}.csv`, body, rows: rows.length };
}

/** Every repayment the viewer made or received in the range, in any status, as CSV. */
export async function buildSettlementsCsv(supabase: Client, viewerId: string, range: DateRange): Promise<CsvFile> {
  const rows = await loadSettlements(supabase, viewerId, range, { completedOnly: false });
  const [cards, groupNames] = await Promise.all([
    getPersonCards(supabase, rows.map((row) => (row.payerId === viewerId ? row.receiverId : row.payerId))),
    getGroupNames(supabase, rows.flatMap((row) => (row.groupId ? [row.groupId] : []))),
  ]);
  const body = toCsv(
    SETTLEMENT_CSV_HEADER,
    rows.map((row) => {
      const youPaid = row.payerId === viewerId;
      return [
        row.date,
        youPaid ? "You paid" : "You received",
        nameOf(cards, youPaid ? row.receiverId : row.payerId),
        row.groupId ? (groupNames.get(row.groupId) ?? "A group") : "Direct",
        row.currency,
        minorToDecimalString(row.amount, row.currency),
        settlementMethodLabel(row.method),
        isSettlementStatus(row.status) ? SETTLEMENT_STATUS_LABELS[row.status] : row.status,
        row.id,
      ];
    }),
  );
  return { fileName: `splitmate-repayments-${range.from}-to-${range.to}.csv`, body, rows: rows.length };
}
