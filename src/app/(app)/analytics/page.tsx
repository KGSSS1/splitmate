import { ChartColumn, Download, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { type ChartDatum, ChartCard } from "@/components/analytics/chart-card";
import { type ChartTable, DataTable } from "@/components/analytics/data-table";
import { PrintButton, ReportFilters } from "@/components/analytics/report-filters";
import { FormStatus } from "@/components/forms/form-status";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { type BreakdownRow, type CurrencyTotals, foldTail, sumShares } from "@/lib/analytics/aggregate";
import { bucketTick } from "@/lib/analytics/periods";
import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate, formatTimestamp, todayIn } from "@/lib/expenses/dates";
import { addMinor } from "@/lib/money/amount";
import { formatMoney } from "@/lib/money/format";
import { FREQUENCY_LABELS } from "@/lib/recurring/schedule";
import { cn } from "@/lib/utils";
import { filtersToParams, parseReportFilters } from "@/lib/validation/analytics";
import { type AnalyticsReport, loadAnalytics, TooManyRowsError } from "@/server/analytics";
import { requireOnboardedProfile } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analytics" };

/** Bars shown per breakdown chart; the table lists every row. */
const CHART_ROWS = 8;

/**
 * Spending analytics (SPEC §14). "Spending" is the viewer's share of expenses;
 * what they paid, what is owed now and repayments are shown separately and
 * labelled. Charts and tables read the same rows from the database.
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const [params, profile] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const today = todayIn(profile.timezone);
  const { filters, error } = parseReportFilters(params, today);

  let report: AnalyticsReport | null = null;
  let tooMany = false;
  try {
    report = await loadAnalytics(await createClient(), profile.id, filters, profile.default_currency);
  } catch (cause) {
    if (!(cause instanceof TooManyRowsError)) throw cause;
    tooMany = true;
  }

  const period = `${formatExpenseDate(filters.range.from)} – ${formatExpenseDate(filters.range.to)}`;
  const exportHref = (kind: "expenses" | "settlements") =>
    `${ROUTES.analytics}/export?${filtersToParams(filters, { kind }).toString()}`;

  return (
    <div className="grid gap-6" data-report>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Analytics</h1>
          <p className="text-muted-foreground">
            {period}
            <span className="hidden print:inline"> · {profile.display_name} · printed {formatTimestamp(new Date().toISOString(), profile.timezone)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <a href={exportHref("expenses")} download className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-8")}>
            <Download aria-hidden />
            Expenses CSV
          </a>
          <a
            href={exportHref("settlements")}
            download
            className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-8")}
          >
            <Download aria-hidden />
            Repayments CSV
          </a>
        </div>
      </header>

      <ReportFilters
        preset={filters.preset}
        from={filters.range.from}
        to={filters.range.to}
        granularity={filters.granularity ?? ""}
        currency={report?.currency ?? null}
        currencies={report?.currencies ?? []}
      />
      {error ? <FormStatus error={`${error} Showing the last 6 months instead.`} /> : null}

      {tooMany ? (
        <FormStatus error="There are too many records in this period to show at once. Choose a shorter period." />
      ) : report === null || report.currencies.length === 0 ? (
        <EmptyState icon={ChartColumn} title="Nothing in this period">
          <p>Expenses you take part in and repayments you make or receive will show up here.</p>
        </EmptyState>
      ) : (
        <Report report={report} period={period} />
      )}
    </div>
  );
}

function Report({ report, period }: { report: AnalyticsReport; period: string }) {
  const currency = report.currency;
  return (
    <>
      <Definitions />
      <section aria-labelledby="summary-heading" className="grid gap-4">
        <h2 id="summary-heading" className="text-lg font-semibold">
          Summary for this period
        </h2>
        {report.totals.map((totals) => (
          <TotalsRow key={totals.currency} totals={totals} showCurrency={report.totals.length > 1} />
        ))}
        <OutstandingNow report={report} />
      </section>

      {currency ? (
        <section aria-labelledby="breakdowns-heading" className="grid gap-4">
          <h2 id="breakdowns-heading" className="text-lg font-semibold">
            Your spending{report.currencies.length > 1 ? ` in ${currency}` : ""}
          </h2>
          {report.currencies.length > 1 ? (
            <p className="-mt-2 text-sm text-muted-foreground print:hidden">
              Charts show one currency at a time; choose another with the Currency filter. Amounts are never added
              across currencies.
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              title="By category"
              description="Your share of expenses in each category."
              rows={report.byCategory}
              currency={currency}
              period={period}
              rowHeading="Category"
              noun={["category", "categories"]}
            />
            <BreakdownCard
              title="By group"
              description="Your share in each group, and direct expenses with friends."
              rows={report.byGroup}
              currency={currency}
              period={period}
              rowHeading="Group"
              noun={["group", "groups"]}
            />
          </div>
          <TrendCard report={report} currency={currency} period={period} />
          <LargestExpenses report={report} currency={currency} />
          <RecurringSummary report={report} currency={currency} />
        </section>
      ) : null}
    </>
  );
}

/** What each word means, so spending, paid, owed and repayments are never confused (SPEC §14). */
function Definitions() {
  const terms = [
    ["Your spending (your share)", "What you consumed: your part of each expense, whoever paid."],
    ["You paid", "Money you put in when an expense was paid."],
    ["Owed", "What people owe each other now, after every expense and repayment so far."],
    ["Repayments", "Money you paid back or were paid back (completed repayments only)."],
  ] as const;
  return (
    <details className="rounded-xl border px-4 py-1 text-sm md:py-2" open>
      <summary className="cursor-pointer py-3 font-medium md:py-1">What these numbers mean</summary>
      <dl className="mt-1 grid gap-2 pb-3 sm:grid-cols-2 md:pb-2">
        {terms.map(([term, meaning]) => (
          <div key={term}>
            <dt className="font-medium">{term}</dt>
            <dd className="text-muted-foreground">{meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function TotalsRow({ totals, showCurrency }: { totals: CurrencyTotals; showCurrency: boolean }) {
  const { currency } = totals;
  const net =
    totals.net > 0
      ? `You paid ${formatMoney(totals.net, currency)} more than your share`
      : totals.net < 0
        ? `Others paid ${formatMoney(-totals.net, currency)} of your share`
        : "You paid exactly your share";
  return (
    <div className="grid gap-2">
      {showCurrency ? <h3 className="text-sm font-medium text-muted-foreground">{currency}</h3> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Your spending (your share)" value={formatMoney(totals.share, currency)}>
          {totals.expenseCount} {totals.expenseCount === 1 ? "expense" : "expenses"}
        </Stat>
        <Stat label="You paid" value={formatMoney(totals.paid, currency)}>
          {net}
        </Stat>
        <Stat label="Repayments you made" value={formatMoney(totals.settlementsPaid, currency)}>
          Completed, in this period
        </Stat>
        <Stat label="Repayments you received" value={formatMoney(totals.settlementsReceived, currency)}>
          Completed, in this period
        </Stat>
      </div>
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid gap-1 rounded-xl border p-4 break-inside-avoid">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

/** "Owed" is a balance now, not a total for the period: shown apart and labelled so. */
function OutstandingNow({ report }: { report: AnalyticsReport }) {
  return (
    <div className="grid gap-2 rounded-xl border border-dashed p-4 text-sm break-inside-avoid">
      <h3 className="font-medium">Owed now (all time, not just this period)</h3>
      {report.balances.length === 0 ? (
        <p className="text-muted-foreground">You&apos;re all settled up.</p>
      ) : (
        <ul className="grid gap-1">
          {report.balances.map((balance) => (
            <li key={balance.currency} className="tabular-nums">
              {balance.currency}: you are owed {formatMoney(balance.owedToYou, balance.currency)}, you owe{" "}
              {formatMoney(balance.youOwe, balance.currency)} (net{" "}
              {formatMoney(balance.net, balance.currency, { signDisplay: "exceptZero" })})
            </li>
          ))}
        </ul>
      )}
      <Link
        href={ROUTES.dashboard}
        className="inline-flex min-h-11 items-center justify-self-start text-primary-emphasis underline-offset-4 hover:underline md:min-h-0 print:hidden"
      >
        See who owes whom
      </Link>
    </div>
  );
}

function breakdownTable(rows: readonly BreakdownRow[], currency: string, caption: string, rowHeading: string): ChartTable {
  return {
    caption,
    columns: [rowHeading, "Your share", "You paid", "Expenses"],
    rows: rows.map((row) => ({
      key: row.key,
      cells: [row.label, formatMoney(row.share, currency), formatMoney(row.paid, currency), String(row.count)],
    })),
    total: [
      "Total",
      formatMoney(sumShares(rows), currency),
      formatMoney(
        rows.reduce((sum, row) => addMinor(sum, row.paid), 0),
        currency,
      ),
      String(rows.reduce((sum, row) => sum + row.count, 0)),
    ],
  };
}

function BreakdownCard({
  title,
  description,
  rows,
  currency,
  period,
  rowHeading,
  noun,
}: {
  title: string;
  description: string;
  rows: readonly BreakdownRow[];
  currency: string;
  period: string;
  rowHeading: string;
  /** Singular and plural, for the chart's summary sentence. */
  noun: readonly [string, string];
}) {
  const total = sumShares(rows);
  const top = rows[0];
  const data: ChartDatum[] = foldTail(rows, CHART_ROWS).map((row) => ({ key: row.key, label: row.label, value: row.share }));
  const summary = top
    ? `Your spending ${title.toLowerCase()}, ${period}: ${formatMoney(total, currency)} in total across ${rows.length} ${rows.length === 1 ? noun[0] : noun[1]}; the largest is ${top.label} at ${formatMoney(top.share, currency)}.`
    : `No spending ${title.toLowerCase()} in ${period}.`;
  return (
    <ChartCard
      title={`Spending ${title.toLowerCase()}`}
      description={description}
      summary={summary}
      currency={currency}
      data={data}
      layout="bars"
      table={breakdownTable(rows, currency, `Your spending ${title.toLowerCase()}, ${period}`, rowHeading)}
    />
  );
}

function TrendCard({ report, currency, period }: { report: AnalyticsReport; currency: string; period: string }) {
  const unit = report.granularity === "week" ? "week" : "month";
  const peak = report.trend.reduce<(typeof report.trend)[number] | null>(
    (best, point) => (best === null || point.share > best.share ? point : best),
    null,
  );
  const total = sumShares(report.trend);
  const summary = peak
    ? `Your spending by ${unit}, ${period}: ${formatMoney(total, currency)} in total over ${report.trend.length} ${unit}s; the highest was ${peak.label} at ${formatMoney(peak.share, currency)}.`
    : `No spending in ${period}.`;
  return (
    <ChartCard
      title={`Spending by ${unit}`}
      description={`Your share of expenses dated in each ${unit}.`}
      summary={summary}
      currency={currency}
      layout="columns"
      data={report.trend.map((point) => ({
        key: point.start,
        label: point.label,
        tick: bucketTick(point.start, report.granularity),
        value: point.share,
      }))}
      table={{
        caption: `Your spending by ${unit}, ${period}`,
        columns: [unit === "week" ? "Week" : "Month", "Your share", "You paid"],
        rows: report.trend.map((point) => ({
          key: point.start,
          cells: [point.label, formatMoney(point.share, currency), formatMoney(point.paid, currency)],
        })),
        total: [
          "Total",
          formatMoney(total, currency),
          formatMoney(
            report.trend.reduce((sum, point) => addMinor(sum, point.paid), 0),
            currency,
          ),
        ],
      }}
    />
  );
}

function LargestExpenses({ report, currency }: { report: AnalyticsReport; currency: string }) {
  return (
    <section aria-labelledby="largest-heading" className="grid gap-3 rounded-xl border p-4 break-inside-avoid md:p-5">
      <div className="grid gap-1">
        <h3 id="largest-heading" className="text-base font-semibold">
          Largest expenses
        </h3>
        <p className="text-sm text-muted-foreground">By your share.</p>
      </div>
      {report.largest.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Your largest expenses by your share</caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Expense
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Your share
                </th>
              </tr>
            </thead>
            <tbody>
              {report.largest.map((row) => (
                <tr key={row.expenseId} className="border-b last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <Link
                      href={`${ROUTES.expenses}/${row.expenseId}`}
                      className="inline-flex min-h-11 min-w-11 items-center font-medium underline-offset-4 hover:underline md:min-h-0 md:min-w-0"
                    >
                      {row.description}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{row.groupName ?? "Direct"}</span>
                  </th>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{formatExpenseDate(row.date)}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                    {formatMoney(row.amount, currency)}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {formatMoney(row.share, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecurringSummary({ report, currency }: { report: AnalyticsReport; currency: string }) {
  const { inRange, commitments } = report.recurring;
  return (
    <section aria-labelledby="recurring-heading" className="grid gap-4 rounded-xl border p-4 break-inside-avoid md:p-5">
      <div className="grid gap-1">
        <h3 id="recurring-heading" className="flex items-center gap-2 text-base font-semibold">
          <Repeat aria-hidden className="size-4 text-muted-foreground" />
          Recurring costs
        </h3>
        <p className="text-sm text-muted-foreground">
          {inRange.count === 0
            ? "No expenses in this period came from a recurring schedule."
            : `${formatMoney(inRange.share, currency)} of your spending in this period (${inRange.count} ${
                inRange.count === 1 ? "expense" : "expenses"
              }) was added by a recurring schedule.`}
        </p>
      </div>
      {inRange.templates.length > 0 ? (
        <DataTable
          table={{
            caption: "Your spending from each recurring schedule in this period",
            columns: ["Schedule", "Your share", "Expenses"],
            rows: inRange.templates.map((row) => ({
              key: row.key,
              cells: [row.label, formatMoney(row.share, currency), String(row.count)],
            })),
          }}
        />
      ) : null}
      <div className="grid gap-2">
        <h4 className="text-sm font-medium">Active schedules you share in</h4>
        {commitments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None. <Link href={ROUTES.recurring} className="text-primary-emphasis underline-offset-4 hover:underline">Set one up</Link>
          </p>
        ) : (
          <DataTable
            table={{
              caption: "Your share of active recurring schedules, by how often they repeat",
              columns: ["Repeats", "Your share each time", "Schedules", "About per year"],
              rows: commitments.map((row) => ({
                key: `${row.frequency}-${row.currency}`,
                cells: [
                  `${FREQUENCY_LABELS[row.frequency]} (${row.currency})`,
                  formatMoney(row.perOccurrence, row.currency),
                  String(row.templates),
                  `≈ ${formatMoney(row.perYear, row.currency)}`,
                ],
              })),
            }}
          />
        )}
      </div>
    </section>
  );
}
