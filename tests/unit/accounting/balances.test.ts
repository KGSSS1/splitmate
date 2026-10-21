import { describe, expect, it } from "vitest";

import { groupBalances, netBalances, pairBalance, pairBalances } from "@/lib/accounting/balances";
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
    expect(() => netBalances([...huge, ...huge])).toThrow();
  });
});
