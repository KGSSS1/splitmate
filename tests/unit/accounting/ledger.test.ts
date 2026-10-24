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
  total: 90000,
  payers: [{ userId: A, amount: 90000 }],
  shares: splitEqual(90000, [A, B, C]),
};

const MAX = Number.MAX_SAFE_INTEGER;

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
      buildExpenseEntries({
        ...dinner,
        total: 500,
        payers: [{ userId: A, amount: 500 }],
        shares: [{ userId: A, amount: 500 }],
      }),
    ).toEqual([]);
  });

  it("rejects mismatched payers and shares, unknown currencies and bad versions", () => {
    expectCode(() => buildExpenseEntries({ ...dinner, payers: [{ userId: A, amount: 1 }] }), "PAYERS_SUM_MISMATCH");
    expectCode(() => buildExpenseEntries({ ...dinner, shares: splitEqual(80000, [A, B]) }), "SHARES_SUM_MISMATCH");
    expectCode(() => buildExpenseEntries({ ...dinner, currency: "XYZ" }), "UNKNOWN_CURRENCY");
    expectCode(() => buildExpenseEntries({ ...dinner, version: 0 }), "INVALID_VERSION");
  });

  // Review finding 1: payers and shares agreed with each other, but nothing tied them to a
  // valid expense amount, so an implied total of 2 × MAX_SAFE_INTEGER produced entries.
  it("requires payers and shares to match the expense total, which must be in range", () => {
    const huge = {
      ...dinner,
      payers: [
        { userId: A, amount: MAX },
        { userId: B, amount: MAX },
      ],
      shares: [
        { userId: C, amount: MAX },
        { userId: "d", amount: MAX },
      ],
    };
    expectCode(() => buildExpenseEntries({ ...huge, total: MAX }), "PAYERS_SUM_MISMATCH");
    expectCode(() => buildExpenseEntries({ ...huge, total: 2 * MAX }), "INVALID_AMOUNT");
    expectCode(() => buildExpenseEntries({ ...dinner, total: 0 }), "INVALID_AMOUNT");
  });

  it("handles the largest supported expense exactly", () => {
    const entries = buildExpenseEntries({
      ...dinner,
      total: MAX,
      payers: [{ userId: A, amount: MAX }],
      shares: splitEqual(MAX, [A, B, C]),
    });
    expect(entries.reduce((sum, e) => sum + BigInt(e.amount), 0n)).toBe(BigInt(MAX) - BigInt(splitEqual(MAX, [A, B, C])[0]!.amount));
  });

  it("works for a 0-decimal (JPY) and 3-decimal (KWD) currency", () => {
    const yen = buildExpenseEntries({
      ...dinner,
      currency: "JPY",
      total: 100,
      payers: [{ userId: A, amount: 100 }],
      shares: splitEqual(100, [A, B, C]),
    });
    expect(netBalances(yen)).toEqual([
      { userId: A, currency: "JPY", amount: 66 },
      { userId: B, currency: "JPY", amount: -33 },
      { userId: C, currency: "JPY", amount: -33 },
    ]);
    const dinar = buildExpenseEntries({
      ...dinner,
      currency: "KWD",
      total: 10000, // 10.000 KWD
      payers: [{ userId: A, amount: 10000 }],
      shares: splitEqual(10000, [A, B, C]),
    });
    expect(netBalances(dinar)).toEqual([
      { userId: A, currency: "KWD", amount: 6666 },
      { userId: B, currency: "KWD", amount: -3333 },
      { userId: C, currency: "KWD", amount: -3333 },
    ]);
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

  it("refuses to reverse a reversal or a malformed entry", () => {
    const entries = buildExpenseEntries(dinner);
    expectCode(() => reverseEntries(reverseEntries(entries)), "SOURCE_MISMATCH");
    // Review finding 4: a negative amount used to come back as a negative reversal.
    expectCode(() => reverseEntries([{ ...entries[0]!, amount: -5 }]), "INVALID_AMOUNT");
    expectCode(() => reverseEntries([{ ...entries[0]!, amount: 0.5 }]), "INVALID_AMOUNT");
    expectCode(() => reverseEntries([{ ...entries[0]!, currency: "inr" }]), "UNKNOWN_CURRENCY");
    expectCode(() => reverseEntries([{ ...entries[0]!, creditorId: entries[0]!.debtorId }]), "SAME_USER");
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
    const amendment = amendExpenseEntries(dinner, v2Input);

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
    const amendment = amendExpenseEntries(dinner, {
      ...dinner,
      version: 2,
      currency: "USD",
      total: 300,
      payers: [{ userId: A, amount: 300 }],
      shares: splitEqual(300, [A, B, C]),
    });
    const balances = netBalances([...v1, ...amendment]);
    expect(balances.every((b) => b.currency === "USD")).toBe(true);
  });

  it("rejects an amendment that does not move to the next version of the same expense", () => {
    expectCode(() => amendExpenseEntries(dinner, { ...dinner, version: 1 }), "INVALID_VERSION");
    expectCode(() => amendExpenseEntries(dinner, { ...dinner, version: 3 }), "INVALID_VERSION");
    expectCode(() => amendExpenseEntries(dinner, { ...dinner, expenseId: "other", version: 2 }), "SOURCE_MISMATCH");
  });

  // Review finding 2: with an empty list of current entries, the version check was skipped
  // and nothing proved the old effect had been reversed. The current version is now passed
  // as data and its charges are rebuilt, so the check always runs.
  it("checks the version even when the current version had no ledger entries", () => {
    const soloPaid = {
      ...dinner,
      total: 500,
      payers: [{ userId: A, amount: 500 }],
      shares: [{ userId: A, amount: 500 }],
    };
    expect(buildExpenseEntries(soloPaid)).toEqual([]);
    expectCode(() => amendExpenseEntries(soloPaid, { ...dinner, version: 99 }), "INVALID_VERSION");
    expect(amendExpenseEntries(soloPaid, { ...dinner, version: 2 })).toHaveLength(2);
  });

  // Review findings 2/3 and P1: the reversal set is derived from the stored version, so it is
  // always complete and always in that version's single currency and group.
  it("reverses exactly the current version's charges, in its currency and group", () => {
    const cancellation = cancelExpenseEntries(dinner);
    expect(cancellation).toEqual(reverseEntries(buildExpenseEntries(dinner)));
    expect(new Set(cancellation.map((e) => `${e.currency}/${e.groupId}/${e.source.version}`))).toEqual(
      new Set(["INR/g1/1"]),
    );
  });

  it("cancelling writes only reversals and restores zero balances", () => {
    const v1 = buildExpenseEntries(dinner);
    const cancellation = cancelExpenseEntries(dinner);
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
    const statuses: SettlementStatus[] = ["pending", "rejected", "withdrawn", "cancelled"];
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
