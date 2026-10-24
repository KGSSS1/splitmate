import { addDays } from "@/lib/recurring/schedule";

/** Calendar dates as YYYY-MM-DD; no time zone (expense dates are `date`). */
export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS = ["this-month", "3-months", "6-months", "12-months", "this-year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "this-month": "This month",
  "3-months": "Last 3 months",
  "6-months": "Last 6 months",
  "12-months": "Last 12 months",
  "this-year": "This year",
  custom: "Custom dates",
};

export const DEFAULT_PRESET: Exclude<RangePreset, "custom"> = "6-months";

/** Longest range a report covers (about three years), so one page never reads unbounded history. */
export const MAX_RANGE_DAYS = 1096;
/** Weekly buckets only up to a year; longer ranges are shown by month. */
export const MAX_WEEKLY_DAYS = 371;

export type Granularity = "week" | "month";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Whole days from `from` to `to` (0 when equal). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** The first day of the month `months` before (negative) or after the one containing `date`. */
export function monthStart(date: string, months = 0): string {
  const parsed = utc(date);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
}

/** The Monday on or before `date` (ISO weeks start on Monday). */
export function weekStart(date: string): string {
  const day = utc(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

/** The date range for a preset, ending today (in the viewer's time zone). */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): DateRange {
  switch (preset) {
    case "this-month":
      return { from: monthStart(today), to: today };
    case "3-months":
      return { from: monthStart(today, -2), to: today };
    case "6-months":
      return { from: monthStart(today, -5), to: today };
    case "12-months":
      return { from: monthStart(today, -11), to: today };
    case "this-year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Weekly for up to about three months, monthly beyond. */
export function defaultGranularity(range: DateRange): Granularity {
  return daysBetween(range.from, range.to) <= 92 ? "week" : "month";
}

/** The granularity to use: weeks are refused for ranges longer than a year. */
export function effectiveGranularity(range: DateRange, requested: Granularity | undefined): Granularity {
  const wanted = requested ?? defaultGranularity(range);
  return wanted === "week" && daysBetween(range.from, range.to) > MAX_WEEKLY_DAYS ? "month" : wanted;
}

/** The start date of the bucket holding `date`. */
export function bucketOf(date: string, granularity: Granularity): string {
  return granularity === "week" ? weekStart(date) : monthStart(date);
}

/** Every bucket start that overlaps the range, in order (empty buckets included). */
export function bucketStarts(range: DateRange, granularity: Granularity): string[] {
  const starts: string[] = [];
  let current = bucketOf(range.from, granularity);
  while (current <= range.to) {
    starts.push(current);
    current = granularity === "week" ? addDays(current, 7) : monthStart(current, 1);
  }
  return starts;
}

/** "Oct 2026" for a month bucket, "w/c 12 Oct" (week commencing) for a week bucket. */
export function bucketLabel(start: string, granularity: Granularity, locale = "en-IN"): string {
  const options: Intl.DateTimeFormatOptions =
    granularity === "month" ? { month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" };
  const label = new Intl.DateTimeFormat(locale, options).format(utc(start));
  return granularity === "week" ? `w/c ${label}` : label;
}

/** Short tick label for a chart axis: "Oct" / "12 Oct". */
export function bucketTick(start: string, granularity: Granularity, locale = "en-IN"): string {
  const options: Intl.DateTimeFormatOptions =
    granularity === "month" ? { month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, options).format(utc(start));
}
