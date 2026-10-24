/**
 * Recurring schedules (SPEC §12). The database generator owns the real dates
 * (`private.recurring_date` / `private.recurring_next_date`); this mirrors the
 * same rule for the form's preview and the template pages. Both are tested
 * against the same month-end cases.
 *
 * The n-th date is the start date plus n days, weeks, months or years, counted
 * from the start and never chained: a monthly schedule from 31 Jan falls on
 * 29 Feb (leap years) or 28 Feb, then 31 Mar again; 29 Feb yearly falls on
 * 28 Feb in common years.
 */

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};

export const RECURRING_STATUSES = ["active", "paused", "cancelled", "ended"] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  ended: "Ended",
};

/** How far back a first date may be; the generator catches those dates up. */
export const MAX_CATCH_UP_DAYS = 31;

export function isFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value);
}

export function isRecurringStatus(value: unknown): value is RecurringStatus {
  return typeof value === "string" && (RECURRING_STATUSES as readonly string[]).includes(value);
}

function parse(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `date` plus a number of days (calendar dates, no time zone). */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parse(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Months added like Postgres `date + interval 'n months'`: the day is clamped to the month's end. */
function addMonths(date: string, months: number): string {
  const { year, month, day } = parse(date);
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return format(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

/** The n-th date of a schedule; n = 0 is the start date. */
export function occurrenceDate(start: string, frequency: Frequency, index: number): string {
  switch (frequency) {
    case "daily":
      return addDays(start, index);
    case "weekly":
      return addDays(start, 7 * index);
    case "monthly":
      return addMonths(start, index);
    case "yearly":
      return addMonths(start, 12 * index);
  }
}

/** The first scheduled date on or after `onOrAfter`. */
export function nextOccurrence(start: string, frequency: Frequency, onOrAfter: string): string {
  if (onOrAfter <= start) return start;
  const from = parse(start);
  const to = parse(onOrAfter);
  const dayMs = 86_400_000;
  const days = Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / dayMs);
  let index =
    frequency === "daily"
      ? days
      : frequency === "weekly"
        ? Math.floor(days / 7)
        : frequency === "monthly"
          ? Math.max(0, (to.year - from.year) * 12 + to.month - from.month - 1)
          : Math.max(0, to.year - from.year - 1);
  while (occurrenceDate(start, frequency, index) < onOrAfter) index += 1;
  return occurrenceDate(start, frequency, index);
}

/**
 * Up to `count` scheduled dates on or after `from`, stopping at `endDate`.
 * Used for the "next dates" preview.
 */
export function upcomingDates(
  start: string,
  frequency: Frequency,
  { from = start, count, endDate }: { from?: string; count: number; endDate?: string | null },
): string[] {
  const dates: string[] = [];
  let next = nextOccurrence(start, frequency, from);
  while (dates.length < count && (!endDate || next <= endDate)) {
    dates.push(next);
    next = nextOccurrence(start, frequency, addDays(next, 1));
  }
  return dates;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th"}`;
}

/** "Every month on the 31st (the last day in shorter months)". */
export function describeSchedule(start: string, frequency: Frequency): string {
  const { year, month, day } = parse(start);
  switch (frequency) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Every week on ${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`;
    case "monthly":
      return day > 28
        ? `Every month on the ${ordinal(day)} (the last day in shorter months)`
        : `Every month on the ${ordinal(day)}`;
    case "yearly":
      return month === 2 && day === 29
        ? "Every year on 29 February (28 February in common years)"
        : `Every year on ${day} ${MONTHS[month - 1]}`;
  }
}
