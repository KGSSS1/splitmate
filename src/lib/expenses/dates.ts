/** Today's date (YYYY-MM-DD) in an IANA time zone, e.g. the user's profile zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** "2026-10-21" → "21 Oct 2026" (a calendar date: no time zone conversion). */
export function formatExpenseDate(date: string, locale = "en-IN"): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}
