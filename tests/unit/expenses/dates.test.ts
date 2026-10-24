import { describe, expect, it } from "vitest";

import { formatTimestamp } from "@/lib/expenses/dates";

// Review M9: event times were formatted in the server's time zone (UTC on Vercel),
// so someone in India saw times 5 h 30 off and sometimes the wrong day.
describe("formatTimestamp", () => {
  const evening = "2026-10-21T20:00:00Z";

  it("shows an instant in the viewer's own time zone", () => {
    expect(formatTimestamp(evening, "Asia/Kolkata")).toBe("22 Oct 2026, 1:30 am");
    expect(formatTimestamp(evening, "America/New_York")).toBe("21 Oct 2026, 4:00 pm");
  });

  it("can show the date only, also in the viewer's time zone", () => {
    expect(formatTimestamp(evening, "Asia/Kolkata", { dateOnly: true })).toBe("22 Oct 2026");
  });

  it("falls back to UTC for an unknown time zone instead of crashing", () => {
    expect(formatTimestamp(evening, "Not/AZone")).toBe("21 Oct 2026, 8:00 pm");
  });
});
