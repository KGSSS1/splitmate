"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";

import { type ChartTable, DataTable } from "@/components/analytics/data-table";
import { Button } from "@/components/ui/button";
import { formatMoney, formatMoneyCompact } from "@/lib/money/format";
import { cn } from "@/lib/utils";

/** One bar: `value` is in minor units of the card's currency. */
export interface ChartDatum {
  key: string;
  /** Full label (tooltip, table). */
  label: string;
  /** Axis label; defaults to `label`. */
  tick?: string;
  value: number;
}

type View = "chart" | "table";

const BAR_THICKNESS = 24;
const ROW_HEIGHT = 36;

/**
 * A chart with its table view (SPEC §14). The table is always in the page, for
 * the toggle, screen readers that prefer tables, and printing (the print
 * stylesheet shows tables and hides charts). The chart's SVG has a title and a
 * one-sentence summary; Recharts' accessibility layer lets keyboard users step
 * through the bars.
 */
export function ChartCard({
  title,
  description,
  summary,
  currency,
  data,
  table,
  layout,
  empty,
}: {
  title: string;
  description: ReactNode;
  /** One sentence a screen reader hears for the chart: the headline numbers. */
  summary: string;
  currency: string;
  data: readonly ChartDatum[];
  table: ChartTable;
  /** "bars": horizontal bars for categories; "columns": vertical bars over time. */
  layout: "bars" | "columns";
  empty?: string;
}) {
  const [view, setView] = useState<View>("chart");
  const headingId = useId();
  const hasData = data.some((datum) => datum.value > 0);

  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded-xl border p-4 break-inside-avoid md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 id={headingId} className="text-base font-semibold">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {hasData ? (
          <div role="group" aria-label={`${title}: view as`} className="flex gap-1 print:hidden">
            <ViewButton current={view} value="chart" onSelect={setView} icon={<ChartColumn aria-hidden />}>
              Chart
            </ViewButton>
            <ViewButton current={view} value="table" onSelect={setView} icon={<Table2 aria-hidden />}>
              Table
            </ViewButton>
          </div>
        ) : null}
      </div>

      {!hasData ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{empty ?? "Nothing in this period."}</p>
      ) : (
        <>
          <figure className={cn("m-0 print:hidden", view === "table" && "hidden")} data-chart>
            <figcaption className="sr-only">{summary}</figcaption>
            {layout === "bars" ? (
              <HorizontalBars data={data} currency={currency} title={title} summary={summary} />
            ) : (
              <Columns data={data} currency={currency} title={title} summary={summary} />
            )}
          </figure>
          <div className={cn("overflow-x-auto print:block", view === "chart" && "hidden")} data-table>
            <DataTable table={table} />
          </div>
        </>
      )}
    </section>
  );
}

function ViewButton({
  current,
  value,
  onSelect,
  icon,
  children,
}: {
  current: View;
  value: View;
  onSelect: (view: View) => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  const active = current === value;
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      className="h-11 md:h-8"
      onClick={() => onSelect(value)}
    >
      {icon}
      {children}
    </Button>
  );
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

function MoneyTooltip({ currency }: { currency: string }) {
  return (
    <Tooltip
      cursor={{ fill: "var(--muted)", opacity: 0.6 }}
      formatter={(value) => [formatMoney(Number(value), currency), "Your share"]}
      labelFormatter={(_label, payload) => {
        const datum = payload?.[0]?.payload as ChartDatum | undefined;
        return datum?.label ?? "";
      }}
      contentStyle={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        color: "var(--popover-foreground)",
        fontSize: 13,
      }}
      labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
      itemStyle={{ color: "var(--popover-foreground)" }}
    />
  );
}

function HorizontalBars({
  data,
  currency,
  title,
  summary,
}: {
  data: readonly ChartDatum[];
  currency: string;
  title: string;
  summary: string;
}) {
  const height = data.length * ROW_HEIGHT + 32;
  return (
    <BarChart
      responsive
      layout="vertical"
      data={[...data]}
      title={title}
      desc={summary}
      style={{ width: "100%", height }}
      margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
    >
      <CartesianGrid horizontal={false} stroke="var(--border)" />
      <XAxis
        type="number"
        tick={AXIS_TICK}
        tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        type="category"
        dataKey="label"
        width={120}
        tick={AXIS_TICK}
        axisLine={{ stroke: "var(--border)" }}
        tickLine={false}
      />
      <MoneyTooltip currency={currency} />
      <Bar dataKey="value" name="Your share" fill="var(--primary)" barSize={BAR_THICKNESS} radius={[0, 4, 4, 0]}>
        <LabelList
          dataKey="value"
          position="right"
          formatter={(value) => formatMoneyCompact(Number(value), currency)}
          style={{ fill: "var(--foreground)", fontSize: 12 }}
        />
      </Bar>
    </BarChart>
  );
}

function Columns({
  data,
  currency,
  title,
  summary,
}: {
  data: readonly ChartDatum[];
  currency: string;
  title: string;
  summary: string;
}) {
  return (
    <BarChart
      responsive
      data={[...data]}
      title={title}
      desc={summary}
      style={{ width: "100%", height: 260 }}
      margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
    >
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="tick"
        tick={AXIS_TICK}
        axisLine={{ stroke: "var(--border)" }}
        tickLine={false}
        interval="preserveStartEnd"
        minTickGap={8}
      />
      <YAxis
        width={64}
        tick={AXIS_TICK}
        tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
        axisLine={false}
        tickLine={false}
      />
      <MoneyTooltip currency={currency} />
      <Bar dataKey="value" name="Your share" fill="var(--primary)" maxBarSize={BAR_THICKNESS} radius={[4, 4, 0, 0]} />
    </BarChart>
  );
}
