import { categoryLabel } from "@/lib/expenses/options";
import { addMinor } from "@/lib/money/amount";
import type { Frequency } from "@/lib/recurring/schedule";

import { bucketLabel, bucketOf, bucketStarts, type DateRange, type Granularity } from "./periods";

/**
 * The viewer's part in one active expense (from `my_expense_shares`). SPEC §14:
 * `share` is what they consumed ("spending"); `paid` is what they put in.
 */
export interface ExpenseShare {
  expenseId: string;
  date: string;
  description: string;
  category: string | null;
  groupId: string | null;
  currency: string;
  amount: number;
  paid: number;
  share: number;
  recurringId: string | null;
}

/** A completed repayment the viewer made or received. */
export interface SettlementShare {
  id: string;
  date: string;
  payerId: string;
  receiverId: string;
  amount: number;
  currency: string;
}

/** Totals for one currency. Amounts are never added across currencies. */
export interface CurrencyTotals {
  currency: string;
  /** Money you put in for expenses. */
  paid: number;
  /** Your share of those expenses: your spending. */
  share: number;
  /** paid − share: positive = you lent overall on these expenses, negative = you borrowed. */
  net: number;
  /** Repayments you made and received (completed only). */
  settlementsPaid: number;
  settlementsReceived: number;
  expenseCount: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  share: number;
  paid: number;
  count: number;
}

export interface TrendPoint {
  start: string;
  label: string;
  share: number;
  paid: number;
}

export interface RecurringTemplateSummary {
  id: string;
  description: string;
  currency: string;
  frequency: Frequency;
  /** Your share of each occurrence. */
  myShare: number;
}

export interface FrequencyTotal {
  frequency: Frequency;
  currency: string;
  perOccurrence: number;
  templates: number;
  /** Rough yearly cost (365 days, 52 weeks, 12 months), labelled as approximate. */
  perYear: number;
}

const DIRECT_KEY = "direct";
const UNCATEGORISED_KEY = "uncategorised";
const OCCURRENCES_PER_YEAR: Record<Frequency, number> = { daily: 365, weekly: 52, monthly: 12, yearly: 1 };

function multiplyMinor(amount: number, factor: number): number {
  const result = amount * factor;
  if (!Number.isSafeInteger(result)) throw new RangeError("Amount exceeds the maximum supported value");
  return result;
}

/** Currencies that appear anywhere in the data, the busiest first, then by code. */
export function currenciesIn(expenses: readonly ExpenseShare[], settlements: readonly SettlementShare[]): string[] {
  const counts = new Map<string, number>();
  for (const row of [...expenses, ...settlements]) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([currency]) => currency);
}

/** Totals for one currency: paid, share, net, and repayments in each direction. */
export function totalsFor(
  currency: string,
  expenses: readonly ExpenseShare[],
  settlements: readonly SettlementShare[],
  viewerId: string,
): CurrencyTotals {
  const totals: CurrencyTotals = {
    currency,
    paid: 0,
    share: 0,
    net: 0,
    settlementsPaid: 0,
    settlementsReceived: 0,
    expenseCount: 0,
  };
  for (const row of expenses) {
    if (row.currency !== currency) continue;
    totals.paid = addMinor(totals.paid, row.paid);
    totals.share = addMinor(totals.share, row.share);
    totals.expenseCount += 1;
  }
  totals.net = addMinor(totals.paid, -totals.share);
  for (const row of settlements) {
    if (row.currency !== currency) continue;
    if (row.payerId === viewerId) totals.settlementsPaid = addMinor(totals.settlementsPaid, row.amount);
    if (row.receiverId === viewerId) totals.settlementsReceived = addMinor(totals.settlementsReceived, row.amount);
  }
  return totals;
}

function breakdown(
  rows: readonly ExpenseShare[],
  currency: string,
  keyOf: (row: ExpenseShare) => string,
  labelOf: (key: string, row: ExpenseShare) => string,
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const key = keyOf(row);
    const entry = map.get(key) ?? { key, label: labelOf(key, row), share: 0, paid: 0, count: 0 };
    entry.share = addMinor(entry.share, row.share);
    entry.paid = addMinor(entry.paid, row.paid);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));
}

/** Your spending (share) per category, largest first. */
export function byCategory(rows: readonly ExpenseShare[], currency: string): BreakdownRow[] {
  return breakdown(
    rows,
    currency,
    (row) => row.category ?? UNCATEGORISED_KEY,
    (key) => (key === UNCATEGORISED_KEY ? "Uncategorised" : (categoryLabel(key) ?? key)),
  );
}

/** Your spending (share) per group, with direct expenses as one row; largest first. */
export function byGroup(
  rows: readonly ExpenseShare[],
  currency: string,
  groupName: (groupId: string) => string,
): BreakdownRow[] {
  return breakdown(
    rows,
    currency,
    (row) => row.groupId ?? DIRECT_KEY,
    (key) => (key === DIRECT_KEY ? "Direct with friends" : groupName(key)),
  );
}

/** Spending (and paid) per week or month across the whole range, empty buckets included. */
export function trend(
  rows: readonly ExpenseShare[],
  currency: string,
  range: DateRange,
  granularity: Granularity,
): TrendPoint[] {
  const points = new Map(
    bucketStarts(range, granularity).map((start) => [
      start,
      { start, label: bucketLabel(start, granularity), share: 0, paid: 0 },
    ]),
  );
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const point = points.get(bucketOf(row.date, granularity));
    if (!point) continue; // outside the range: the query already excludes these
    point.share = addMinor(point.share, row.share);
    point.paid = addMinor(point.paid, row.paid);
  }
  return [...points.values()];
}

/** Your largest expenses by your share (ties: newer first). */
export function largestExpenses(rows: readonly ExpenseShare[], currency: string, limit = 10): ExpenseShare[] {
  return rows
    .filter((row) => row.currency === currency && row.share > 0)
    .sort((a, b) => b.share - a.share || b.date.localeCompare(a.date) || a.expenseId.localeCompare(b.expenseId))
    .slice(0, limit);
}

/** Your spending in the range on expenses a recurring schedule added, per schedule. */
export function recurringInRange(rows: readonly ExpenseShare[], currency: string): { share: number; count: number; templates: BreakdownRow[] } {
  const generated = rows.filter((row) => row.recurringId !== null);
  const templates = breakdown(
    generated,
    currency,
    (row) => row.recurringId ?? "",
    (_key, row) => row.description,
  );
  return {
    share: templates.reduce((sum, row) => addMinor(sum, row.share), 0),
    count: templates.reduce((sum, row) => sum + row.count, 0),
    templates,
  };
}

/** Active schedules you take part in, totalled per frequency and currency. */
export function recurringCommitments(templates: readonly RecurringTemplateSummary[]): FrequencyTotal[] {
  const order: Frequency[] = ["daily", "weekly", "monthly", "yearly"];
  const map = new Map<string, FrequencyTotal>();
  for (const template of templates) {
    if (template.myShare <= 0) continue;
    const key = `${template.frequency}:${template.currency}`;
    const entry = map.get(key) ?? {
      frequency: template.frequency,
      currency: template.currency,
      perOccurrence: 0,
      templates: 0,
      perYear: 0,
    };
    entry.perOccurrence = addMinor(entry.perOccurrence, template.myShare);
    entry.templates += 1;
    entry.perYear = multiplyMinor(entry.perOccurrence, OCCURRENCES_PER_YEAR[template.frequency]);
    map.set(key, entry);
  }
  return [...map.values()].sort(
    (a, b) => order.indexOf(a.frequency) - order.indexOf(b.frequency) || a.currency.localeCompare(b.currency),
  );
}

/** Sum of a breakdown's shares: equal to the currency's total share by construction. */
export function sumShares(rows: readonly { share: number }[]): number {
  return rows.reduce((sum, row) => addMinor(sum, row.share), 0);
}

/**
 * At most `max` rows for a chart: the largest `max − 1`, then one row adding up
 * the rest, so the bars still total the full amount. The table shows every row.
 */
export function foldTail(rows: readonly BreakdownRow[], max: number, label = "Everything else"): BreakdownRow[] {
  if (rows.length <= max) return [...rows];
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  return [
    ...head,
    {
      key: "everything-else",
      label,
      share: sumShares(tail),
      paid: tail.reduce((sum, row) => addMinor(sum, row.paid), 0),
      count: tail.reduce((sum, row) => sum + row.count, 0),
    },
  ];
}
