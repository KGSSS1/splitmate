import "server-only";

import {
  byCategory,
  byGroup,
  type BreakdownRow,
  type CurrencyTotals,
  currenciesIn,
  type ExpenseShare,
  type FrequencyTotal,
  largestExpenses,
  recurringCommitments,
  recurringInRange,
  type RecurringTemplateSummary,
  type SettlementShare,
  totalsFor,
  trend,
  type TrendPoint,
} from "@/lib/analytics/aggregate";
import { type DateRange, effectiveGranularity, type Granularity } from "@/lib/analytics/periods";
import { balancesByPerson } from "@/lib/accounting/person-balances";
import { type CurrencySummary, summarizeBalances } from "@/lib/accounting/summary";
import { isMinorAmount } from "@/lib/money/amount";
import { isFrequency } from "@/lib/recurring/schedule";
import type { createClient } from "@/lib/supabase/server";
import type { ReportFilters } from "@/lib/validation/analytics";
import { loadContextBalances } from "@/server/balances";
import { getGroupNames } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The Data API returns at most this many rows per call (supabase/config.toml `max_rows`). */
const PAGE_SIZE = 1000;
/** A report reads at most this many rows; more means the range is too wide to show in one page. */
export const MAX_REPORT_ROWS = 20_000;

/** The range holds more rows than one report reads; the page asks for a shorter range. */
export class TooManyRowsError extends Error {
  constructor() {
    super("Too many records in this range.");
    this.name = "TooManyRowsError";
  }
}

function amount(value: number): number {
  if (!isMinorAmount(value)) throw new Error("Unexpected amount from the database.");
  return value;
}

/**
 * Every active expense the viewer took part in, dated within the range: their
 * paid amount and share of the current version (`my_expense_shares`, RLS
 * applies). Reads page by page so the Data API's row cap never drops rows.
 */
export async function loadExpenseShares(supabase: Client, range: DateRange): Promise<ExpenseShare[]> {
  const rows: ExpenseShare[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.rpc("my_expense_shares", {
      p_from: range.from,
      p_to: range.to,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) throw new Error("Could not load your expenses.");
    for (const row of data) {
      rows.push({
        expenseId: row.expense_id,
        date: row.expense_date,
        description: row.description,
        category: row.category ?? null,
        groupId: row.group_id ?? null,
        currency: row.currency,
        amount: amount(row.amount),
        paid: amount(row.paid),
        share: amount(row.share),
        recurringId: row.recurring_expense_id ?? null,
      });
    }
    if (data.length < PAGE_SIZE) return rows;
    if (rows.length >= MAX_REPORT_ROWS) throw new TooManyRowsError();
  }
}

export interface SettlementRecord extends SettlementShare {
  groupId: string | null;
  status: string;
  method: string;
}

/**
 * Repayments the viewer made or received, by the date they were made. Only
 * `completed` ones count towards totals; the export lists every status.
 */
export async function loadSettlements(
  supabase: Client,
  viewerId: string,
  range: DateRange,
  { completedOnly }: { completedOnly: boolean },
): Promise<SettlementRecord[]> {
  const rows: SettlementRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("settlements")
      .select("id, settled_on, payer_id, receiver_id, amount, currency, group_id, status, method")
      .or(`payer_id.eq.${viewerId},receiver_id.eq.${viewerId}`)
      .gte("settled_on", range.from)
      .lte("settled_on", range.to);
    if (completedOnly) query = query.eq("status", "completed");
    const { data, error } = await query
      .order("settled_on")
      .order("created_at")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Could not load your repayments.");
    for (const row of data) {
      rows.push({
        id: row.id,
        date: row.settled_on,
        payerId: row.payer_id,
        receiverId: row.receiver_id,
        amount: amount(row.amount),
        currency: row.currency,
        groupId: row.group_id,
        status: row.status,
        method: row.method,
      });
    }
    if (data.length < PAGE_SIZE) return rows;
    if (rows.length >= MAX_REPORT_ROWS) throw new TooManyRowsError();
  }
}

/** Active recurring schedules the viewer has a share in (RLS: ones they can see). */
async function loadRecurringTemplates(supabase: Client, viewerId: string): Promise<RecurringTemplateSummary[]> {
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select("id, description, currency, frequency, shares")
    .eq("status", "active")
    .order("created_at")
    .limit(PAGE_SIZE);
  if (error) throw new Error("Could not load recurring expenses.");
  return data.flatMap((row) => {
    const shares = Array.isArray(row.shares) ? row.shares : [];
    const mine = shares.find(
      (share): share is { user_id: string; amount: number } =>
        typeof share === "object" && share !== null && !Array.isArray(share) && share.user_id === viewerId,
    );
    if (!mine || !isMinorAmount(mine.amount) || !isFrequency(row.frequency)) return [];
    return [{ id: row.id, description: row.description, currency: row.currency, frequency: row.frequency, myShare: mine.amount }];
  });
}

export interface LargestExpense extends ExpenseShare {
  groupName: string | null;
}

export interface AnalyticsReport {
  range: DateRange;
  granularity: Granularity;
  /** Currencies with data, busiest first. */
  currencies: string[];
  /** The currency the breakdowns are in; null when the range is empty. */
  currency: string | null;
  /** Paid / share / net / repayments for every currency. */
  totals: CurrencyTotals[];
  byCategory: BreakdownRow[];
  byGroup: BreakdownRow[];
  trend: TrendPoint[];
  largest: LargestExpense[];
  recurring: {
    inRange: ReturnType<typeof recurringInRange>;
    commitments: FrequencyTotal[];
  };
  /** Outstanding balances now (all time, from the ledger): what "owed" means. */
  balances: CurrencySummary[];
}

/**
 * The analytics report for the viewer. Every figure comes from the rows above
 * (or the ledger for balances), so chart totals equal the database's sums.
 * Takes the client so integration tests can run it as any user.
 */
export async function loadAnalytics(
  supabase: Client,
  viewerId: string,
  filters: ReportFilters,
  preferredCurrency: string,
): Promise<AnalyticsReport> {
  const [expenses, settlements, templates, contextBalances] = await Promise.all([
    loadExpenseShares(supabase, filters.range),
    loadSettlements(supabase, viewerId, filters.range, { completedOnly: true }),
    loadRecurringTemplates(supabase, viewerId),
    loadContextBalances(supabase, viewerId),
  ]);

  const currencies = currenciesIn(expenses, settlements);
  const currency =
    filters.currency && currencies.includes(filters.currency)
      ? filters.currency
      : currencies.includes(preferredCurrency)
        ? preferredCurrency
        : (currencies[0] ?? null);

  const groupIds = [...new Set(expenses.flatMap((row) => (row.groupId ? [row.groupId] : [])))];
  const groupNames = await getGroupNames(supabase, groupIds);
  const groupName = (id: string) => groupNames.get(id) ?? "A group";
  const granularity = effectiveGranularity(filters.range, filters.granularity);

  return {
    range: filters.range,
    granularity,
    currencies,
    currency,
    totals: currencies.map((code) => totalsFor(code, expenses, settlements, viewerId)),
    byCategory: currency ? byCategory(expenses, currency) : [],
    byGroup: currency ? byGroup(expenses, currency, groupName) : [],
    trend: currency ? trend(expenses, currency, filters.range, granularity) : [],
    largest: currency
      ? largestExpenses(expenses, currency).map((row) => ({
          ...row,
          groupName: row.groupId ? groupName(row.groupId) : null,
        }))
      : [],
    recurring: {
      inRange: currency ? recurringInRange(expenses, currency) : { share: 0, count: 0, templates: [] },
      commitments: recurringCommitments(templates),
    },
    balances: summarizeBalances(
      [
        ...balancesByPerson(
          contextBalances.map(({ counterpartyId, currency: code, amount: value }) => ({
            personId: counterpartyId,
            currency: code,
            amount: value,
          })),
        ).values(),
      ].flat(),
    ),
  };
}
