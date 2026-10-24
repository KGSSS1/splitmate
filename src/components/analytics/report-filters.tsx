"use client";

import { Filter, Printer } from "lucide-react";
import { useRef } from "react";

import { NativeSelect } from "@/components/forms/native-select";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { RANGE_PRESET_LABELS, RANGE_PRESETS, type RangePreset } from "@/lib/analytics/periods";
import { ROUTES } from "@/lib/auth/routes";

const GRANULARITY_OPTIONS = [
  { value: "", label: "Automatic" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

/**
 * One filter row for the whole report (date range, trend step, currency). A
 * plain GET form: the URL holds the filters, so the CSV export and printing use
 * the same ones. Editing a date switches the range to "Custom dates".
 */
export function ReportFilters({
  preset,
  from,
  to,
  granularity,
  currency,
  currencies,
}: {
  preset: RangePreset;
  from: string;
  to: string;
  granularity: string;
  currency: string | null;
  currencies: readonly string[];
}) {
  const rangeRef = useRef<HTMLSelectElement>(null);
  const toCustom = () => {
    if (rangeRef.current) rangeRef.current.value = "custom";
  };

  return (
    <form
      action={ROUTES.analytics}
      aria-label="Report filters"
      className="flex flex-wrap items-end gap-3 rounded-xl border p-4 print:hidden [&>*:not(button)]:min-w-36 [&>*:not(button)]:flex-1"
    >
      <NativeSelect
        ref={rangeRef}
        label="Period"
        name="range"
        defaultValue={preset}
        options={RANGE_PRESETS.map((value) => ({ value, label: RANGE_PRESET_LABELS[value] }))}
      />
      <TextField label="From" name="from" type="date" defaultValue={from} onChange={toCustom} />
      <TextField label="To" name="to" type="date" defaultValue={to} onChange={toCustom} />
      <NativeSelect label="Trend" name="by" defaultValue={granularity} options={GRANULARITY_OPTIONS} />
      {currencies.length > 1 ? (
        <NativeSelect
          label="Currency"
          name="currency"
          defaultValue={currency ?? undefined}
          options={currencies.map((code) => ({ value: code, label: code }))}
        />
      ) : null}
      <Button type="submit" className="h-11 md:h-9">
        <Filter aria-hidden />
        Apply
      </Button>
    </form>
  );
}

/** Opens the browser's print dialog ("Save as PDF"); the print stylesheet shapes the report. */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" className="h-11 md:h-8 print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print or save as PDF
    </Button>
  );
}
