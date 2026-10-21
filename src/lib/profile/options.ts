import { CURRENCIES } from "@/lib/money/currencies";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/validation/profile";

/** Currency choices for selects, e.g. "INR — Indian Rupee", sorted by code. */
export const CURRENCY_OPTIONS: readonly { value: string; label: string }[] = Object.values(CURRENCIES)
  .map(({ code, name }) => ({ value: code, label: `${code} — ${name}` }))
  .sort((a, b) => (a.value < b.value ? -1 : 1));

/**
 * IANA time zones the runtime knows, always including `current` (some
 * runtimes leave aliases such as "UTC" out of `supportedValuesOf`).
 */
export function timeZoneOptions(current: string): { value: string; label: string }[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  if (isValidTimeZone(current)) zones.add(current);
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}

/** The browser's time zone, or the app default if it is unknown. */
export function detectTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
