import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  byCategory,
  byGroup,
  currenciesIn,
  type ExpenseShare,
  foldTail,
  largestExpenses,
  recurringCommitments,
  recurringInRange,
  type SettlementShare,
  sumShares,
  totalsFor,
  trend,
} from "@/lib/analytics/aggregate";
import { addDays } from "@/lib/recurring/schedule";

const ME = "me";
const RANGE = { from: "2026-05-01", to: "2026-10-25" };

function expense(overrides: Partial<ExpenseShare>): ExpenseShare {
  return {
    expenseId: "e1",
    date: "2026-10-01",
    description: "Dinner",
    category: "food",
    groupId: "g1",
    currency: "INR",
    amount: 90000,
    paid: 90000,
    share: 30000,
    recurringId: null,
    ...overrides,
  };
}

const EXPENSES: ExpenseShare[] = [
  expense({ expenseId: "a", category: "rent", share: 1000000, paid: 0, amount: 3000000, date: "2026-09-19" }),
  expense({ expenseId: "b", category: "food", share: 80000, paid: 120000, amount: 240000, date: "2026-08-20" }),
  expense({ expenseId: "c", category: null, groupId: null, share: 30000, paid: 0, amount: 60000, date: "2026-10-14" }),
  expense({ expenseId: "d", currency: "USD", share: 2250, paid: 4500, amount: 4500, date: "2026-08-05" }),
  expense({ expenseId: "e", category: "rent", share: 1000000, paid: 0, amount: 3000000, date: "2026-10-19", recurringId: "r1", description: "Rent" }),
];

const SETTLEMENTS: SettlementShare[] = [
  { id: "s1", date: "2026-10-01", payerId: ME, receiverId: "bob", amount: 50000, currency: "INR" },
  { id: "s2", date: "2026-10-02", payerId: "carol", receiverId: ME, amount: 20000, currency: "INR" },
  { id: "s3", date: "2026-10-03", payerId: "carol", receiverId: ME, amount: 100, currency: "USD" },
];

describe("totals", () => {
  it("keep paid, share, net and repayments apart, per currency", () => {
    expect(totalsFor("INR", EXPENSES, SETTLEMENTS, ME)).toEqual({
      currency: "INR",
      paid: 120000,
      share: 2110000,
      net: -1990000,
      settlementsPaid: 50000,
      settlementsReceived: 20000,
      expenseCount: 4,
    });
    expect(totalsFor("USD", EXPENSES, SETTLEMENTS, ME)).toMatchObject({ paid: 4500, share: 2250, net: 2250, settlementsReceived: 100 });
  });

  it("list currencies busiest first", () => {
    expect(currenciesIn(EXPENSES, SETTLEMENTS)).toEqual(["INR", "USD"]);
    expect(currenciesIn([], [])).toEqual([]);
  });
});

describe("breakdowns", () => {
  it("by category, largest first, with uncategorised expenses labelled", () => {
    expect(byCategory(EXPENSES, "INR").map((row) => [row.label, row.share, row.count])).toEqual([
      ["Rent", 2000000, 2],
      ["Food and drink", 80000, 1],
      ["Uncategorised", 30000, 1],
    ]);
  });

  it("by group, with direct expenses as one row", () => {
    expect(byGroup(EXPENSES, "INR", () => "Flat 4B").map((row) => [row.key, row.label, row.share])).toEqual([
      ["g1", "Flat 4B", 2080000],
      ["direct", "Direct with friends", 30000],
    ]);
  });

  it("over time, with empty months as zero", () => {
    expect(trend(EXPENSES, "INR", RANGE, "month").map((point) => [point.start, point.share, point.paid])).toEqual([
      ["2026-05-01", 0, 0],
      ["2026-06-01", 0, 0],
      ["2026-07-01", 0, 0],
      ["2026-08-01", 80000, 120000],
      ["2026-09-01", 1000000, 0],
      ["2026-10-01", 1030000, 0],
    ]);
  });

  it("largest expenses by share, newer first on ties, one currency only", () => {
    expect(largestExpenses(EXPENSES, "INR", 3).map((row) => row.expenseId)).toEqual(["e", "a", "b"]);
    expect(largestExpenses(EXPENSES, "USD").map((row) => row.expenseId)).toEqual(["d"]);
  });

  it("fold the tail into one bar without changing the total", () => {
    const rows = byCategory(EXPENSES, "INR");
    const folded = foldTail(rows, 2);
    expect(folded.map((row) => row.label)).toEqual(["Rent", "Everything else"]);
    expect(sumShares(folded)).toBe(sumShares(rows));
    expect(foldTail(rows, 5)).toEqual(rows);
  });
});

describe("recurring", () => {
  it("sums spending from recurring schedules in the range", () => {
    expect(recurringInRange(EXPENSES, "INR")).toMatchObject({
      share: 1000000,
      count: 1,
      templates: [{ key: "r1", label: "Rent", share: 1000000, count: 1 }],
    });
  });

  it("totals active schedules per frequency and currency, with an approximate yearly cost", () => {
    expect(
      recurringCommitments([
        { id: "1", description: "Rent", currency: "INR", frequency: "monthly", myShare: 1000000 },
        { id: "2", description: "Wifi", currency: "INR", frequency: "monthly", myShare: 33300 },
        { id: "3", description: "Milk", currency: "INR", frequency: "daily", myShare: 3000 },
        { id: "4", description: "Excluded", currency: "INR", frequency: "weekly", myShare: 0 },
      ]),
    ).toEqual([
      { frequency: "daily", currency: "INR", perOccurrence: 3000, templates: 1, perYear: 1095000 },
      { frequency: "monthly", currency: "INR", perOccurrence: 1033300, templates: 2, perYear: 12399600 },
    ]);
  });
});

describe("chart totals equal the currency total (property)", () => {
  const rowArbitrary = fc.record({
    expenseId: fc.uuid(),
    date: fc.integer({ min: 0, max: daysInRange() }).map((offset) => addDays(RANGE.from, offset)),
    description: fc.string({ maxLength: 10 }),
    category: fc.constantFrom("food", "rent", "travel", null, "custom"),
    groupId: fc.constantFrom("g1", "g2", null),
    currency: fc.constantFrom("INR", "USD", "JPY", "KWD"),
    amount: fc.integer({ min: 1, max: 10_000_000_000 }),
    paid: fc.integer({ min: 0, max: 10_000_000_000 }),
    share: fc.integer({ min: 0, max: 10_000_000_000 }),
    recurringId: fc.constantFrom("r1", null),
  });

  function daysInRange() {
    return 177; // 2026-05-01 .. 2026-10-25
  }

  it("for every breakdown, in every currency, without mixing currencies", () => {
    fc.assert(
      fc.property(fc.array(rowArbitrary, { maxLength: 60 }), fc.constantFrom<"week" | "month">("week", "month"), (rows, step) => {
        for (const currency of currenciesIn(rows, [])) {
          const total = totalsFor(currency, rows, [], ME).share;
          const expected = rows.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.share, 0);
          expect(total).toBe(expected);
          expect(sumShares(byCategory(rows, currency))).toBe(total);
          expect(sumShares(byGroup(rows, currency, (id) => id))).toBe(total);
          expect(sumShares(trend(rows, currency, RANGE, step))).toBe(total);
          expect(sumShares(foldTail(byCategory(rows, currency), 3))).toBe(total);
        }
      }),
    );
  });
});
