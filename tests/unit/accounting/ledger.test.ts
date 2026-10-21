import { describe, expect, it } from "vitest";

import { groupBalances, netBalances } from "@/lib/accounting/balances";
import { AccountingError } from "@/lib/accounting/errors";
import {
  amendExpenseEntries,
  buildExpenseEntries,
  buildSettlementEntries,
  cancelExpenseEntries,
  reverseEntries,
} from "@/lib/accounting/ledger";
import { splitEqual, splitPercentage } from "@/lib/accounting/splits";
import type { SettlementStatus } from "@/lib/accounting/types";

const A = "a";
const B = "b";
const C = "c";

const dinner = {
  expenseId: "exp-1",
  version: 1,
  groupId: "g1",
  currency: "INR",
  payers: [{ userId: A, amount: 90000 }],
  shares: splitEqual(90000, [A, B, C]),
};

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AccountingError);
    expect((error as AccountingError).code).toBe(code);
    return;
  }
  throw new Error(`expected AccountingError ${code}`);
}

describe("expense ledger entries", () => {
  it("writes positive pairwise charge entries linked to the expense version", () => {
    const entries = buildExpenseEntries(dinner);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.amount).toBeGreaterThan(0);
      expect(entry).toMatchObject({
        currency: "INR",
        groupId: "g1",
        entryType: "charge",
        source: { kind: "expense", id: "exp-1", version: 1 },
      });
    }
  });

  it("writes nothing when the only participant paid", () => {
    expect(
      buildExpenseEntries({ ...dinner, payers: [{ userId: A, amount: 500 }], shares: [{ userId: A, amount: 500 }] }),
    ).toEqual([]);
  });

  it("rejects mismatched payers and shares, unknown currencies and bad versions", () => {
    expectCode(() => buildExpenseEntries({ ...dinner, payers: [{ userId: A, amount: 1 }] }), "SHARES_SUM_MISMATCH");
    expectCode(() => buildExpenseEntries({ ...dinner, currency: "XYZ" }), "UNKNOWN_CURRENCY");
    expectCode(() => buildExpenseEntries({ ...dinner, version: 0 }), "INVALID_VERSION");
  });

  it("reversals swap direction and keep amounts positive", () => {
    const [entry] = buildExpenseEntries(dinner);
    const [reversal] = reverseEntries([entry!]);
    expect(reversal).toEqual({
      ...entry,
      debtorId: entry!.creditorId,
      creditorId: entry!.debtorId,
      entryType: "reversal",
    });
  });

  it("an edit fully reverses the old version and applies the new one", () => {
    const v1 = buildExpenseEntries(dinner);
    const v2Input = {
      ...dinner,
      version: 2,
      shares: splitPercentage(90000, [
        { userId: A, basisPoints: 5000 },
        { userId: B, basisPoints: 2500 },
        { userId: C, basisPoints: 2500 },
      ]),
    };
    const amendment = amendExpenseEntries(v1, v2Input);

    expect(amendment.filter((e) => e.entryType === "reversal")).toHaveLength(v1.length);
    expect(netBalances([...v1, ...amendment])).toEqual(netBalances(buildExpenseEntries(v2Input)));
    expect(netBalances([...v1, ...amendment])).toEqual([
      { userId: A, currency: "INR", amount: 45000 },
      { userId: B, currency: "INR", amount: -22500 },
      { userId: C, currency: "INR", amount: -22500 },
    ]);
  });

  it("an edit may change the currency; the old currency nets back to zero", () => {
    const v1 = buildExpenseEntries(dinner);
    const amendment = amendExpenseEntries(v1, {
      ...dinner,
      version: 2,
      currency: "USD",
      payers: [{ userId: A, amount: 300 }],
      shares: splitEqual(300, [A, B, C]),
    });
    const balances = netBalances([...v1, ...amendment]);
    expect(balances.every((b) => b.currency === "USD")).toBe(true);
  });

  it("rejects an amendment that does not move to a newer version of the same expense", () => {
    const v1 = buildExpenseEntries(dinner);
    expectCode(() => amendExpenseEntries(v1, { ...dinner, version: 1 }), "INVALID_VERSION");
    expectCode(() => amendExpenseEntries(v1, { ...dinner, expenseId: "other", version: 2 }), "SOURCE_MISMATCH");
    expectCode(() => amendExpenseEntries(reverseEntries(v1), { ...dinner, version: 2 }), "SOURCE_MISMATCH");
  });

  it("cancelling writes only reversals and restores zero balances", () => {
    const v1 = buildExpenseEntries(dinner);
    const cancellation = cancelExpenseEntries(v1);
    expect(cancellation.every((e) => e.entryType === "reversal")).toBe(true);
    expect(netBalances([...v1, ...cancellation])).toEqual([]);
  });
});

describe("settlement ledger entries", () => {
  const settlement = {
    settlementId: "set-1",
    payerId: B,
    receiverId: A,
    amount: 10000,
    currency: "INR",
    groupId: "g1",
  };

  it("only a completed settlement affects balances", () => {
    const statuses: SettlementStatus[] = ["pending", "rejected", "cancelled"];
    for (const status of statuses) {
      expect(buildSettlementEntries({ ...settlement, status })).toEqual([]);
    }
    expect(buildSettlementEntries({ ...settlement, status: "completed" })).toEqual([
      {
        debtorId: A,
        creditorId: B,
        amount: 10000,
        currency: "INR",
        groupId: "g1",
        entryType: "charge",
        source: { kind: "settlement", id: "set-1", version: 1 },
      },
    ]);
  });

  it("a partial settlement reduces the payer's debt (SPEC §17 E2E 5–6 numbers)", () => {
    const entries = [
      ...buildExpenseEntries(dinner),
      ...buildSettlementEntries({ ...settlement, status: "completed" }),
    ];
    expect(groupBalances(entries, "g1")).toEqual([
      { userId: A, currency: "INR", amount: 50000 },
      { userId: B, currency: "INR", amount: -20000 },
      { userId: C, currency: "INR", amount: -30000 },
    ]);
  });

  it("a full settlement clears the pair and cancelling it restores the debt", () => {
    const expense = buildExpenseEntries(dinner);
    const full = buildSettlementEntries({ ...settlement, amount: 30000, status: "completed" });
    expect(netBalances([...expense, ...full]).find((b) => b.userId === B)).toBeUndefined();

    const cancelled = reverseEntries(full);
    expect(netBalances([...expense, ...full, ...cancelled])).toEqual(netBalances(expense));
  });

  it("allows a settlement between members with no direct debt (simplified transfers)", () => {
    const entries = buildSettlementEntries({ ...settlement, payerId: C, receiverId: B, status: "completed" });
    expect(entries[0]).toMatchObject({ debtorId: B, creditorId: C });
  });

  it("rejects invalid settlements", () => {
    expectCode(() => buildSettlementEntries({ ...settlement, receiverId: B, status: "completed" }), "SAME_USER");
    expectCode(() => buildSettlementEntries({ ...settlement, amount: 0, status: "completed" }), "INVALID_AMOUNT");
    expectCode(() => buildSettlementEntries({ ...settlement, currency: "ABC", status: "completed" }), "UNKNOWN_CURRENCY");
  });
});
