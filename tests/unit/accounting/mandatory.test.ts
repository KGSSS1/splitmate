/**
 * The mandatory cases from SPEC §7. Amounts are INR paise.
 */
import { describe, expect, it } from "vitest";

import { netBalances } from "@/lib/accounting/balances";
import { buildExpenseEntries } from "@/lib/accounting/ledger";
import { allocatePairwise } from "@/lib/accounting/pairwise";
import { splitEqual } from "@/lib/accounting/splits";

const A = "user-a";
const B = "user-b";
const C = "user-c";

describe("SPEC §7 mandatory cases", () => {
  it("A pays ₹900 split equally among A, B, C → A +60000, B −30000, C −30000", () => {
    const shares = splitEqual(90000, [A, B, C]);
    expect(shares.map((s) => s.amount)).toEqual([30000, 30000, 30000]);

    const entries = buildExpenseEntries({
      expenseId: "exp-1",
      version: 1,
      groupId: "group-1",
      currency: "INR",
      total: 90000,
      payers: [{ userId: A, amount: 90000 }],
      shares,
    });

    expect(entries.map(({ debtorId, creditorId, amount }) => ({ debtorId, creditorId, amount }))).toEqual([
      { debtorId: B, creditorId: A, amount: 30000 },
      { debtorId: C, creditorId: A, amount: 30000 },
    ]);
    expect(netBalances(entries)).toEqual([
      { userId: A, currency: "INR", amount: 60000 },
      { userId: B, currency: "INR", amount: -30000 },
      { userId: C, currency: "INR", amount: -30000 },
    ]);
  });

  it("₹100 split three ways gives 3334/3333/3333 deterministically", () => {
    const first = splitEqual(10000, [A, B, C]);
    expect(first.map((s) => s.amount)).toEqual([3334, 3333, 3333]);
    expect(first.map((s) => s.roundingUnit)).toEqual([1, 0, 0]);

    for (let run = 0; run < 20; run += 1) {
      expect(splitEqual(10000, [A, B, C])).toEqual(first);
    }
  });

  it("A pays ₹600 and B pays ₹300 for ₹900 split equally → only C → A ₹300", () => {
    const shares = splitEqual(90000, [A, B, C]);
    const debts = allocatePairwise(
      [
        { userId: A, amount: 60000 },
        { userId: B, amount: 30000 },
      ],
      shares,
    );

    expect(debts).toEqual([{ debtorId: C, creditorId: A, amount: 30000 }]);
  });
});
