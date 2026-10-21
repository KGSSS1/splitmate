import { describe, expect, it } from "vitest";

import { groupBalances, netBalances, pairBalance, pairBalances } from "@/lib/accounting/balances";
import { AccountingError } from "@/lib/accounting/errors";
import { buildExpenseEntries, buildSettlementEntries } from "@/lib/accounting/ledger";
import { splitEqual } from "@/lib/accounting/splits";
import type { LedgerEntry } from "@/lib/accounting/types";

const A = "a";
const B = "b";
const C = "c";

function expense(id: string, groupId: string | null, currency: string, payer: string, total: number, users: string[]) {
  return buildExpenseEntries({
    expenseId: id,
    version: 1,
    groupId,
    currency,
    total,
    payers: [{ userId: payer, amount: total }],
    shares: splitEqual(total, users),
  });
}

const entries: LedgerEntry[] = [
  ...expense("e1", "trip", "INR", A, 90000, [A, B, C]), // B→A 300, C→A 300
  ...expense("e2", "flat", "INR", B, 20000, [A, B]), // A→B 100
  ...expense("e3", null, "INR", A, 5000, [A, B]), // direct: B→A 25
  ...expense("e4", "trip", "USD", C, 3000, [A, C]), // A→C $15
];

describe("balances", () => {
  it("computes per-user nets per currency (positive = owed to them)", () => {
    expect(netBalances(entries)).toEqual([
      { userId: A, currency: "INR", amount: 30000 + 30000 - 10000 + 2500 },
      { userId: B, currency: "INR", amount: -30000 + 10000 - 2500 },
      { userId: C, currency: "INR", amount: -30000 },
      { userId: A, currency: "USD", amount: -1500 },
      { userId: C, currency: "USD", amount: 1500 },
    ]);
  });

  it("never mixes currencies and every currency sums to zero", () => {
    const balances = netBalances(entries);
    for (const currency of ["INR", "USD"]) {
      expect(balances.filter((b) => b.currency === currency).reduce((sum, b) => sum + b.amount, 0)).toBe(0);
    }
  });

  it("filters a group's balances, and direct expenses as group null", () => {
    expect(groupBalances(entries, "flat")).toEqual([
      { userId: A, currency: "INR", amount: -10000 },
      { userId: B, currency: "INR", amount: 10000 },
    ]);
    expect(groupBalances(entries, null)).toEqual([
      { userId: A, currency: "INR", amount: 2500 },
      { userId: B, currency: "INR", amount: -2500 },
    ]);
    const trip = groupBalances(entries, "trip");
    expect(trip.filter((b) => b.currency === "INR").reduce((s, b) => s + b.amount, 0)).toBe(0);
  });

  it("sums a friend balance across all shared groups and direct expenses, per currency", () => {
    // A vs B: trip +300, flat −100, direct +25 → B owes A ₹225.
    expect(pairBalance(entries, A, B)).toEqual([{ currency: "INR", amount: 22500 }]);
    expect(pairBalance(entries, B, A)).toEqual([{ currency: "INR", amount: -22500 }]);
    expect(pairBalance(entries, A, C)).toEqual([
      { currency: "INR", amount: 30000 },
      { currency: "USD", amount: -1500 },
    ]);
  });

  it("lists all counterparties for a user", () => {
    expect(pairBalances(entries, A)).toEqual([
      { counterpartyId: B, currency: "INR", amount: 22500 },
      { counterpartyId: C, currency: "INR", amount: 30000 },
      { counterpartyId: C, currency: "USD", amount: -1500 },
    ]);
  });

  it("drops pairs that net to zero after settlement", () => {
    const settled = [
      ...entries,
      ...buildSettlementEntries({
        settlementId: "s1",
        payerId: B,
        receiverId: A,
        amount: 22500,
        currency: "INR",
        groupId: null,
        status: "completed",
      }),
    ];
    expect(pairBalance(settled, A, B)).toEqual([]);
  });

  it("returns empty results for an empty ledger", () => {
    expect(netBalances([])).toEqual([]);
    expect(pairBalances([], A)).toEqual([]);
  });

  it("throws instead of overflowing", () => {
    const huge = expense("big", "g", "INR", A, Number.MAX_SAFE_INTEGER, [B]);
    expect(() => netBalances([...huge, ...huge])).toThrow(AccountingError);
    expect(() => pairBalances([...huge, ...huge], A)).toThrow(AccountingError);
  });

  // Review finding 5: intermediate sums used to be range-checked, so the same set of entries
  // succeeded or threw depending on their order.
  it("gives the same result regardless of entry order, even near the limit", () => {
    const entry = (debtorId: string, creditorId: string, amount: number): LedgerEntry => ({
      debtorId,
      creditorId,
      amount,
      currency: "INR",
      groupId: "g",
      source: { kind: "expense", id: "e", version: 1 },
      entryType: "charge",
    });
    const max = Number.MAX_SAFE_INTEGER;
    const first = [entry("y", "x", max), entry("x", "z", 1), entry("z", "x", 1)];
    const second = [entry("y", "x", max), entry("z", "x", 1), entry("x", "z", 1)];
    expect(netBalances(second)).toEqual(netBalances(first));
    expect(netBalances(first)).toEqual([
      { userId: "x", currency: "INR", amount: max },
      { userId: "y", currency: "INR", amount: -max },
    ]);
    expect(pairBalances(second, "x")).toEqual(pairBalances(first, "x"));
  });

  // Review finding 4: a negative amount silently flipped the debt's direction, and a fractional
  // amount surfaced as a misleading overflow error.
  it("rejects malformed ledger entries", () => {
    const [valid] = expense("e9", "g", "INR", A, 200, [A, B]);
    for (const [bad, code] of [
      [{ ...valid!, amount: -100 }, "INVALID_AMOUNT"],
      [{ ...valid!, amount: 0 }, "INVALID_AMOUNT"],
      [{ ...valid!, amount: 0.5 }, "INVALID_AMOUNT"],
      [{ ...valid!, currency: "inr" }, "UNKNOWN_CURRENCY"],
      [{ ...valid!, debtorId: valid!.creditorId }, "SAME_USER"],
    ] as const) {
      for (const fn of [() => netBalances([bad]), () => pairBalances([bad], A)]) {
        try {
          fn();
          throw new Error("expected an error");
        } catch (error) {
          expect(error).toBeInstanceOf(AccountingError);
          expect((error as AccountingError).code).toBe(code);
        }
      }
    }
  });
});
