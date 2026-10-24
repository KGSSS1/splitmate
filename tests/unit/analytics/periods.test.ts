import { describe, expect, it } from "vitest";

import {
  bucketLabel,
  bucketOf,
  bucketStarts,
  daysBetween,
  defaultGranularity,
  effectiveGranularity,
  isIsoDate,
  monthStart,
  presetRange,
  weekStart,
} from "@/lib/analytics/periods";

describe("calendar helpers", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-2-1")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it("finds Monday-based weeks across month and year ends", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  it("moves between months", () => {
    expect(monthStart("2026-10-25")).toBe("2026-10-01");
    expect(monthStart("2026-03-31", -1)).toBe("2026-02-01");
    expect(monthStart("2026-01-15", -1)).toBe("2025-12-01");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });
});

describe("presets", () => {
  const today = "2026-10-25";
  it("end today and start on a month (or year) boundary", () => {
    expect(presetRange("this-month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("3-months", today)).toEqual({ from: "2026-08-01", to: today });
    expect(presetRange("6-months", today)).toEqual({ from: "2026-05-01", to: today });
    expect(presetRange("12-months", today)).toEqual({ from: "2025-11-01", to: today });
    expect(presetRange("this-year", today)).toEqual({ from: "2026-01-01", to: today });
  });
});

describe("buckets", () => {
  it("cover the whole range, empty ones included", () => {
    expect(bucketStarts({ from: "2026-08-15", to: "2026-10-02" }, "month")).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    expect(bucketStarts({ from: "2026-10-01", to: "2026-10-25" }, "week")).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
  });

  it("place a date in its bucket and label it", () => {
    expect(bucketOf("2026-10-25", "month")).toBe("2026-10-01");
    expect(bucketOf("2026-10-25", "week")).toBe("2026-10-19");
    expect(bucketLabel("2026-10-01", "month")).toMatch(/Oct.*2026/);
    expect(bucketLabel("2026-10-19", "week")).toMatch(/^w\/c 19 Oct/);
  });

  it("pick weeks for short ranges and refuse them for ranges over a year", () => {
    expect(defaultGranularity({ from: "2026-08-01", to: "2026-10-25" })).toBe("week");
    expect(defaultGranularity({ from: "2026-05-01", to: "2026-10-25" })).toBe("month");
    expect(effectiveGranularity({ from: "2026-05-01", to: "2026-10-25" }, "week")).toBe("week");
    expect(effectiveGranularity({ from: "2024-01-01", to: "2026-10-25" }, "week")).toBe("month");
  });
});
