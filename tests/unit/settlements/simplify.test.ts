import { describe, expect, it } from "vitest";

import { netBalances } from "@/lib/accounting/balances";
import { AccountingError } from "@/lib/accounting/errors";
import { buildExpenseEntries, buildSettlementEntries } from "@/lib/accounting/ledger";
import { splitEqual } from "@/lib/accounting/splits";
import type { Balance } from "@/lib/accounting/types";
import { simplifyDebts, type Transfer } from "@/lib/settlements/simplify";

const inr = (userId: string, amount: number): Balance => ({ userId, currency: "INR", amount });

/** Applies transfers to balances; every resulting net must be zero. */
function remaining(balances: Balance[], transfers: Transfer[]) {
  const map = new Map(balances.map((b) => [`${b.currency}:${b.userId}`, b.amount]));
  for (const t of transfers) {
    map.set(`${t.currency}:${t.fromUserId}`, (map.get(`${t.currency}:${t.fromUserId}`) ?? 0) + t.amount);
    map.set(`${t.currency}:${t.toUserId}`, (map.get(`${t.currency}:${t.toUserId}`) ?? 0) - t.amount);
  }
  return [...map.values()].filter((v) => v !== 0);
}

describe("simplifyDebts", () => {
  it("one creditor, many debtors", () => {
    expect(simplifyDebts([inr("a", 60000), inr("b", -30000), inr("c", -30000)])).toEqual([
      { fromUserId: "b", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "c", toUserId: "a", amount: 30000, currency: "INR" },
    ]);
  });

  it("matches the largest creditor with the largest debtor first", () => {
    const balances = [inr("a", 500), inr("b", 300), inr("c", -600), inr("d", -200)];
    // c(600)→a(500); then the largest debtor is d(200) vs c(100), so d→b before c→b.
    expect(simplifyDebts(balances)).toEqual([
      { fromUserId: "c", toUserId: "a", amount: 500, currency: "INR" },
      { fromUserId: "d", toUserId: "b", amount: 200, currency: "INR" },
      { fromUserId: "c", toUserId: "b", amount: 100, currency: "INR" },
    ]);
    expect(remaining(balances, simplifyDebts(balances))).toEqual([]);
  });

  it("breaks ties by user ID, so equivalent solutions always come out the same", () => {
    const balances = [inr("d", -100), inr("c", -100), inr("b", 100), inr("a", 100)];
    const expected = [
      { fromUserId: "c", toUserId: "a", amount: 100, currency: "INR" },
      { fromUserId: "d", toUserId: "b", amount: 100, currency: "INR" },
    ];
    expect(simplifyDebts(balances)).toEqual(expected);
    expect(simplifyDebts([...balances].reverse())).toEqual(expected);
  });

  it("returns nothing when all balances are zero", () => {
    expect(simplifyDebts([])).toEqual([]);
    expect(simplifyDebts([inr("a", 0), inr("b", 0)])).toEqual([]);
  });

  it("handles unequal balances with at most n−1 transfers", () => {
    const balances = [inr("a", 7), inr("b", 13), inr("c", 1), inr("d", -11), inr("e", -9), inr("f", -1)];
    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1);
    expect(remaining(balances, transfers)).toEqual([]);
  });

  it("simplifies a 50-member group", () => {
    const balances: Balance[] = [];
    let sum = 0;
    for (let i = 0; i < 49; i += 1) {
      const amount = ((i * 7919) % 20001) - 10000;
      balances.push(inr(`user-${String(i).padStart(2, "0")}`, amount));
      sum += amount;
    }
    balances.push(inr("user-49", -sum));
    const nonZero = balances.filter((b) => b.amount !== 0).length;

    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(nonZero - 1);
    expect(remaining(balances, transfers)).toEqual([]);
    expect(transfers.every((t) => t.amount > 0)).toBe(true);
  });

  it("keeps currencies separate", () => {
    const transfers = simplifyDebts([
      inr("a", 100),
      inr("b", -100),
      { userId: "a", currency: "USD", amount: -5 },
      { userId: "b", currency: "USD", amount: 5 },
    ]);
    expect(transfers).toEqual([
      { fromUserId: "b", toUserId: "a", amount: 100, currency: "INR" },
      { fromUserId: "a", toUserId: "b", amount: 5, currency: "USD" },
    ]);
  });

  it("works on balances after a partial settlement", () => {
    const entries = [
      ...buildExpenseEntries({
        expenseId: "e1",
        version: 1,
        groupId: "g",
        currency: "INR",
        total: 90000,
        payers: [{ userId: "a", amount: 90000 }],
        shares: splitEqual(90000, ["a", "b", "c"]),
      }),
      ...buildSettlementEntries({
        settlementId: "s1",
        payerId: "b",
        receiverId: "a",
        amount: 10000,
        currency: "INR",
        groupId: "g",
        status: "completed",
      }),
    ];
    expect(simplifyDebts(netBalances(entries))).toEqual([
      { fromUserId: "c", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "b", toUserId: "a", amount: 20000, currency: "INR" },
    ]);
  });

  it("rejects balances that do not sum to zero, duplicates and unsafe amounts", () => {
    expect(() => simplifyDebts([inr("a", 100), inr("b", -99)])).toThrow(AccountingError);
    expect(() => simplifyDebts([inr("a", 100), inr("a", -100)])).toThrow(AccountingError);
    expect(() => simplifyDebts([inr("a", 0.5), inr("b", -0.5)])).toThrow(AccountingError);
  });

  // Review finding 6: "inr" and "INR" became separate buckets, and unknown codes passed through.
  it("rejects unknown or mis-cased currency codes", () => {
    for (const currency of ["inr", "XYZ"]) {
      expect(() =>
        simplifyDebts([
          { userId: "a", currency, amount: 5 },
          { userId: "b", currency, amount: -5 },
        ]),
      ).toThrow(expect.objectContaining({ code: "UNKNOWN_CURRENCY" }));
    }
  });

  it("handles JPY and KWD balances in their own minor units", () => {
    expect(
      simplifyDebts([
        { userId: "a", currency: "JPY", amount: 67 },
        { userId: "b", currency: "JPY", amount: -67 },
        { userId: "a", currency: "KWD", amount: -1234 },
        { userId: "b", currency: "KWD", amount: 1234 },
      ]),
    ).toEqual([
      { fromUserId: "b", toUserId: "a", amount: 67, currency: "JPY" },
      { fromUserId: "a", toUserId: "b", amount: 1234, currency: "KWD" },
    ]);
  });

  it("settles balances near the safe-integer limit exactly", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(simplifyDebts([inr("a", max), inr("b", -max + 1), inr("c", -1)])).toEqual([
      { fromUserId: "b", toUserId: "a", amount: max - 1, currency: "INR" },
      { fromUserId: "c", toUserId: "a", amount: 1, currency: "INR" },
    ]);
  });
});
