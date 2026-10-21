import { describe, expect, it } from "vitest";

import { summarizeBalances } from "@/lib/accounting/summary";

describe("summarizeBalances", () => {
  it("is empty when there are no balances", () => {
    expect(summarizeBalances([])).toEqual([]);
  });

  it("sums owed and owing separately and nets them", () => {
    expect(
      summarizeBalances([
        { currency: "INR", amount: 30_000 },
        { currency: "INR", amount: 30_000 },
        { currency: "INR", amount: -10_000 },
      ]),
    ).toEqual([{ currency: "INR", owedToYou: 60_000, youOwe: 10_000, net: 50_000 }]);
  });

  it("never mixes currencies and sorts them by code", () => {
    expect(
      summarizeBalances([
        { currency: "USD", amount: -500 },
        { currency: "JPY", amount: 1_200 },
        { currency: "INR", amount: 100 },
      ]).map((summary) => [summary.currency, summary.net]),
    ).toEqual([
      ["INR", 100],
      ["JPY", 1_200],
      ["USD", -500],
    ]);
  });

  it("drops currencies with only zero balances", () => {
    expect(summarizeBalances([{ currency: "KWD", amount: 0 }])).toEqual([]);
  });

  it("rejects unsafe amounts, overflow and unknown currencies", () => {
    expect(() => summarizeBalances([{ currency: "INR", amount: 2 ** 53 }])).toThrow();
    expect(() => summarizeBalances([{ currency: "INR", amount: 1.5 }])).toThrow();
    expect(() =>
      summarizeBalances([
        { currency: "INR", amount: Number.MAX_SAFE_INTEGER },
        { currency: "INR", amount: 1 },
      ]),
    ).toThrow(/maximum/);
    expect(() => summarizeBalances([{ currency: "XXX", amount: 1 }])).toThrow(/Unsupported currency/);
  });
});
