import {
  daysBetween,
  DEFAULT_PRESET,
  type DateRange,
  type Granularity,
  isIsoDate,
  MAX_RANGE_DAYS,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
} from "@/lib/analytics/periods";
import { isCurrencyCode } from "@/lib/money/currencies";

/** Search parameters as Next passes them to a page or route. */
export type RawParams = Record<string, string | string[] | undefined>;

export interface ReportFilters {
  preset: RangePreset;
  range: DateRange;
  /** Requested trend granularity; undefined = choose from the range. */
  granularity: Granularity | undefined;
  /** Requested currency; undefined = the busiest one in the data. */
  currency: string | undefined;
}

export interface ParsedFilters {
  filters: ReportFilters;
  /** Why custom dates were not used (shown above the report), or null. */
  error: string | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPreset(value: unknown): value is RangePreset {
  return typeof value === "string" && (RANGE_PRESETS as readonly string[]).includes(value);
}

function checkCustom(from: string | undefined, to: string | undefined): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "Choose both a start and an end date.";
  if (from < "2000-01-01" || to > "2100-12-31") return "Choose dates between 2000 and 2100.";
  if (from > to) return "The start date must be on or before the end date.";
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return "Choose a range of three years or less.";
  return null;
}

/**
 * Report filters from the URL (analytics page and CSV export share them). Bad
 * values never fail the page: an unknown preset becomes the default, bad custom
 * dates fall back to the default range with a message, and an unknown currency
 * or granularity is ignored.
 */
export function parseReportFilters(params: RawParams, today: string): ParsedFilters {
  const requested = first(params.range);
  const granularityParam = first(params.by);
  const currencyParam = first(params.currency)?.toUpperCase();
  const granularity: Granularity | undefined =
    granularityParam === "week" || granularityParam === "month" ? granularityParam : undefined;
  const currency = currencyParam && isCurrencyCode(currencyParam) ? currencyParam : undefined;

  if (requested === "custom") {
    const from = first(params.from);
    const to = first(params.to);
    const error = checkCustom(from, to);
    if (!error && from && to) {
      return { filters: { preset: "custom", range: { from, to }, granularity, currency }, error: null };
    }
    return {
      filters: { preset: DEFAULT_PRESET, range: presetRange(DEFAULT_PRESET, today), granularity, currency },
      error,
    };
  }

  const preset = isPreset(requested) && requested !== "custom" ? requested : DEFAULT_PRESET;
  return { filters: { preset, range: presetRange(preset, today), granularity, currency }, error: null };
}

/** The query string that reproduces these filters (for links and the export URL). */
export function filtersToParams(filters: ReportFilters, extra: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("range", filters.preset);
  if (filters.preset === "custom") {
    params.set("from", filters.range.from);
    params.set("to", filters.range.to);
  }
  if (filters.granularity) params.set("by", filters.granularity);
  if (filters.currency) params.set("currency", filters.currency);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params;
}
