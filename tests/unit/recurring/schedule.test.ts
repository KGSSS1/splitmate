import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addDays,
  describeSchedule,
  FREQUENCIES,
  nextOccurrence,
  occurrenceDate,
  upcomingDates,
} from "@/lib/recurring/schedule";

// The same cases as supabase/tests/160_recurring_receipts.test.sql, so the
// preview and the generator agree.
describe("occurrenceDate", () => {
  it("keeps a month-end day where the month has it and clamps otherwise", () => {
    expect(occurrenceDate("2024-01-31", "monthly", 1)).toBe("2024-02-29");
    expect(occurrenceDate("2023-01-31", "monthly", 1)).toBe("2023-02-28");
    expect(occurrenceDate("2024-01-31", "monthly", 2)).toBe("2024-03-31");
    expect(occurrenceDate("2024-01-31", "monthly", 3)).toBe("2024-04-30");
    expect(occurrenceDate("2024-11-30", "monthly", 3)).toBe("2025-02-28");
  });

  it("puts 29 February on 28 February in common years", () => {
    expect(occurrenceDate("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(occurrenceDate("2024-02-29", "yearly", 4)).toBe("2028-02-29");
    expect(occurrenceDate("2024-02-29", "yearly", 100)).toBe("2124-02-29");
    expect(occurrenceDate("2096-02-29", "yearly", 4)).toBe("2100-02-28");
  });

  it("adds days and weeks across month and year ends", () => {
    expect(occurrenceDate("2024-12-31", "daily", 1)).toBe("2025-01-01");
    expect(occurrenceDate("2024-01-01", "weekly", 2)).toBe("2024-01-15");
    expect(occurrenceDate("2024-02-26", "weekly", 1)).toBe("2024-03-04");
  });
});

describe("nextOccurrence", () => {
  it("finds the next scheduled date", () => {
    expect(nextOccurrence("2024-01-31", "monthly", "2024-03-01")).toBe("2024-03-31");
    expect(nextOccurrence("2024-01-31", "monthly", "2024-02-29")).toBe("2024-02-29");
    expect(nextOccurrence("2024-01-01", "weekly", "2024-01-09")).toBe("2024-01-15");
    expect(nextOccurrence("2024-03-10", "daily", "2024-01-01")).toBe("2024-03-10");
    expect(nextOccurrence("2023-03-15", "yearly", "2025-03-16")).toBe("2026-03-15");
  });

  it("is always a scheduled date on or after the given day, with none skipped", () => {
    const day = fc.integer({ min: 0, max: 3000 }).map((n) => addDays("2020-01-01", n));
    fc.assert(
      fc.property(day, fc.constantFrom(...FREQUENCIES), fc.integer({ min: 0, max: 2000 }), (start, frequency, offset) => {
        const after = addDays(start, offset);
        const next = nextOccurrence(start, frequency, after);
        expect(next >= after).toBe(true);
        // It is the n-th date for some n, and the (n−1)-th is before `after`.
        let index = 0;
        while (occurrenceDate(start, frequency, index) < next) index += 1;
        expect(occurrenceDate(start, frequency, index)).toBe(next);
        if (index > 0) expect(occurrenceDate(start, frequency, index - 1) < after).toBe(true);
      }),
    );
  });
});

describe("upcomingDates", () => {
  it("lists the next dates up to the end date", () => {
    expect(upcomingDates("2024-01-31", "monthly", { count: 4 })).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ]);
    expect(upcomingDates("2024-02-29", "yearly", { count: 10, endDate: "2027-12-31" })).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
    ]);
    expect(upcomingDates("2024-01-01", "weekly", { from: "2024-01-02", count: 2 })).toEqual(["2024-01-08", "2024-01-15"]);
  });

  it("is empty when the end date comes first", () => {
    expect(upcomingDates("2024-05-10", "monthly", { from: "2024-05-11", count: 3, endDate: "2024-06-01" })).toEqual([]);
  });
});

describe("describeSchedule", () => {
  it("says how month ends and leap days are handled", () => {
    expect(describeSchedule("2024-01-31", "monthly")).toBe("Every month on the 31st (the last day in shorter months)");
    expect(describeSchedule("2024-01-05", "monthly")).toBe("Every month on the 5th");
    expect(describeSchedule("2024-01-12", "monthly")).toBe("Every month on the 12th");
    expect(describeSchedule("2024-02-29", "yearly")).toBe("Every year on 29 February (28 February in common years)");
    expect(describeSchedule("2024-03-15", "yearly")).toBe("Every year on 15 March");
    expect(describeSchedule("2026-10-24", "weekly")).toBe("Every week on Saturday");
    expect(describeSchedule("2026-10-24", "daily")).toBe("Every day");
  });
});
