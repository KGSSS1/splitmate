import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { approximateTotal, convertMinor, type ExchangeRate, parseRate, rateTable } from "@/lib/money/convert";

const rows = (rates: Record<string, string>, rateDate = "2026-10-23"): ExchangeRate[] =>
  Object.entries(rates).map(([quote, rate]) => ({ provider: "frankfurter", base: "EUR", quote, rate, rateDate }));

// ECB reference rates of 23 Oct 2026, as Frankfurter served them.
const TABLE = rateTable(
  rows({ INR: "106.2720000000", USD: "1.1193000000", JPY: "175.5100000000", GBP: "0.8372800000" }),
)!;

describe("parseRate", () => {
  it("reads positive plain decimals exactly", () => {
    expect(parseRate("106.2720000000")).toEqual({ units: 1062720000000n, scale: 10 });
    expect(parseRate("2")).toEqual({ units: 2n, scale: 0 });
  });

  it("rejects zero, negatives, exponents and junk", () => {
    for (const bad of ["0", "0.000", "-1.2", "1e3", "", "abc", "1.2.3"]) expect(parseRate(bad), bad).toBeNull();
  });
});

describe("convertMinor", () => {
  it("converts through the base currency, rounding once", () => {
    // $10.00 → ₹ (10 × 106.272 / 1.1193 = 949.4505…)
    expect(convertMinor(1000, "USD", "INR", TABLE)).toBe(94945);
    // ₹1,000.00 → $10.53 (1000 × 1.1193 / 106.272 = 10.5324…)
    expect(convertMinor(100000, "INR", "USD", TABLE)).toBe(1053);
    // €1.00 is the base itself.
    expect(convertMinor(100, "EUR", "INR", TABLE)).toBe(10627);
  });

  it("respects each currency's exponent (JPY has none)", () => {
    // ¥1,000 → ₹605.50 (1000 × 106.272 / 175.51 = 605.4994…)
    expect(convertMinor(1000, "JPY", "INR", TABLE)).toBe(60550);
    // ₹605.50 → ¥1,000
    expect(convertMinor(60550, "INR", "JPY", TABLE)).toBe(1000);
  });

  it("rounds half away from zero, for negative amounts too", () => {
    const even = rateTable(rows({ USD: "2" }))!;
    expect(convertMinor(1, "USD", "EUR", even)).toBe(1); // 0.5 → 1
    expect(convertMinor(-1, "USD", "EUR", even)).toBe(-1); // -0.5 → -1
    expect(convertMinor(3, "USD", "EUR", even)).toBe(2); // 1.5 → 2
  });

  it("returns the amount unchanged for the same currency, and null without a rate", () => {
    expect(convertMinor(12345, "INR", "INR", TABLE)).toBe(12345);
    expect(convertMinor(12345, "AED", "INR", TABLE)).toBeNull();
    expect(convertMinor(Number.MAX_SAFE_INTEGER, "JPY", "INR", TABLE)).toBeNull(); // would overflow
    expect(() => convertMinor(1.5, "INR", "USD", TABLE)).toThrow(RangeError);
  });

  it("round-trips within one minor unit of rounding (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (amount) => {
        const there = convertMinor(amount, "INR", "GBP", TABLE)!;
        const back = convertMinor(there, "GBP", "INR", TABLE)!;
        // One GBP penny is worth about 127 paise, so that's the most a round trip can drift.
        expect(Math.abs(back - amount)).toBeLessThanOrEqual(127);
      }),
    );
  });
});

describe("rateTable", () => {
  it("skips malformed rates, unknown currencies and other bases, and keeps the oldest date", () => {
    const table = rateTable([
      ...rows({ INR: "106.272" }, "2026-10-23"),
      ...rows({ USD: "1.1193" }, "2026-10-22"),
      ...rows({ GBP: "nope", XYZ: "1.5" }),
      { provider: "frankfurter", base: "USD", quote: "JPY", rate: "150", rateDate: "2026-10-23" },
    ])!;
    expect([...table.rates.keys()].sort()).toEqual(["EUR", "INR", "USD"]);
    expect(table.rateDate).toBe("2026-10-22");
    expect(rateTable([])).toBeNull();
  });
});

describe("approximateTotal", () => {
  const summaries = [
    { currency: "INR", owedToYou: 50000, youOwe: 120000 },
    { currency: "USD", owedToYou: 1000, youOwe: 0 },
    { currency: "AED", owedToYou: 500, youOwe: 0 },
  ];

  it("converts owed and owing separately, then nets them, and lists what it left out", () => {
    expect(approximateTotal(summaries, "INR", TABLE)).toEqual({
      currency: "INR",
      owedToYou: 50000 + 94945,
      youOwe: 120000,
      net: 50000 + 94945 - 120000,
      included: ["INR", "USD"],
      missing: ["AED"],
      rateDate: "2026-10-23",
      provider: "frankfurter",
    });
  });

  it("without rates, still adds up the target currency itself", () => {
    expect(approximateTotal(summaries, "INR", null)).toMatchObject({ net: -70000, included: ["INR"], missing: ["USD", "AED"] });
  });
});
