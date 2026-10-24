import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "@/lib/export/csv";
import { formatMoneyCompact } from "@/lib/money/format";
import { matchesTerms, matchingCategories, searchTerms } from "@/lib/search/match";
import { filtersToParams, parseReportFilters } from "@/lib/validation/analytics";

describe("CSV", () => {
  it("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("Dinner, drinks")).toBe('"Dinner, drinks"');
    expect(csvCell('The "good" one')).toBe('"The ""good"" one"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
  });

  it("defuses text a spreadsheet would run as a formula, but not negative amounts", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("1500")).toBe("1500");
  });

  it("starts with a byte-order mark and ends rows with CRLF", () => {
    expect(toCsv(["A", "B"], [["1", "x,y"]])).toBe('﻿A,B\r\n1,"x,y"\r\n');
  });
});

describe("search terms", () => {
  it("need every word, in any order and case", () => {
    const terms = searchTerms("  Goa   TRIP ");
    expect(terms).toEqual(["goa", "trip"]);
    expect(matchesTerms(terms, "Trip to Goa")).toBe(true);
    expect(matchesTerms(terms, "Goa")).toBe(false);
    expect(matchesTerms([], "anything")).toBe(false);
  });

  it("find categories by their label", () => {
    expect(matchingCategories(searchTerms("drink"))).toEqual(["food"]);
    expect(matchingCategories(searchTerms("travel stays"))).toEqual(["travel"]);
  });
});

describe("report filters", () => {
  const today = "2026-10-25";

  it("default to the last six months", () => {
    expect(parseReportFilters({}, today)).toEqual({
      filters: { preset: "6-months", range: { from: "2026-05-01", to: today }, granularity: undefined, currency: undefined },
      error: null,
    });
    expect(parseReportFilters({ range: "nonsense" }, today).filters.preset).toBe("6-months");
  });

  it("accept valid custom dates, granularity and currency", () => {
    const { filters, error } = parseReportFilters(
      { range: "custom", from: "2026-01-01", to: "2026-03-31", by: "week", currency: "usd" },
      today,
    );
    expect(error).toBeNull();
    expect(filters).toEqual({ preset: "custom", range: { from: "2026-01-01", to: "2026-03-31" }, granularity: "week", currency: "USD" });
    expect(filtersToParams(filters, { kind: "expenses" }).toString()).toBe(
      "range=custom&from=2026-01-01&to=2026-03-31&by=week&currency=USD&kind=expenses",
    );
  });

  it("fall back with a message for bad custom dates", () => {
    expect(parseReportFilters({ range: "custom", from: "2026-03-31", to: "2026-01-01" }, today).error).toMatch(/on or before/);
    expect(parseReportFilters({ range: "custom", from: "2020-01-01", to: "2026-01-01" }, today).error).toMatch(/three years/);
    expect(parseReportFilters({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, today).error).toMatch(/both/);
    expect(parseReportFilters({ range: "custom", from: "1999-12-31", to: "2000-01-01" }, today).error).toMatch(/2000/);
    const fallback = parseReportFilters({ range: "custom" }, today);
    expect(fallback.filters.range).toEqual({ from: "2026-05-01", to: today });
  });

  it("ignore unknown currencies and granularities, and take the first of repeated values", () => {
    const { filters } = parseReportFilters({ range: ["this-month", "custom"], by: "day", currency: "XYZ" }, today);
    expect(filters).toMatchObject({ preset: "this-month", granularity: undefined, currency: undefined });
  });
});

describe("compact money", () => {
  it("shortens axis labels without touching exact amounts", () => {
    expect(formatMoneyCompact(123456789, "INR")).toBe("₹12.3L");
    expect(formatMoneyCompact(150000, "JPY", "en-US")).toBe("¥150K");
    expect(formatMoneyCompact(0, "USD", "en-US")).toBe("$0");
  });
});
