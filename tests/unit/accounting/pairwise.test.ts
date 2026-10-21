import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { allocatePairwise, validatePayers } from "@/lib/accounting/pairwise";
import type { PairwiseDebt } from "@/lib/accounting/types";

function netsFromDebts(debts: PairwiseDebt[]) {
  const nets = new Map<string, number>();
  for (const { debtorId, creditorId, amount } of debts) {
    nets.set(creditorId, (nets.get(creditorId) ?? 0) + amount);
    nets.set(debtorId, (nets.get(debtorId) ?? 0) - amount);
  }
  return nets;
}

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

describe("allocatePairwise", () => {
  it("single payer: everyone else owes the payer their share", () => {
    expect(
      allocatePairwise(
        [{ userId: "a", amount: 900 }],
        [
          { userId: "a", amount: 300 },
          { userId: "b", amount: 300 },
          { userId: "c", amount: 300 },
        ],
      ),
    ).toEqual([
      { debtorId: "b", creditorId: "a", amount: 300 },
      { debtorId: "c", creditorId: "a", amount: 300 },
    ]);
  });

  it("payer who is not a participant is owed everything", () => {
    expect(
      allocatePairwise(
        [{ userId: "p", amount: 500 }],
        [
          { userId: "a", amount: 250 },
          { userId: "b", amount: 250 },
        ],
      ),
    ).toEqual([
      { debtorId: "a", creditorId: "p", amount: 250 },
      { debtorId: "b", creditorId: "p", amount: 250 },
    ]);
  });

  it("allocates each debtor's net to payers in proportion to their excess payment", () => {
    // Bill 1200 split equally among a, b, c, d (300 each). a paid 800 (excess 500), b paid 400 (excess 100).
    // c and d each owe 300, allocated 5:1 → 250 to a and 50 to b.
    const debts = allocatePairwise(
      [
        { userId: "a", amount: 800 },
        { userId: "b", amount: 400 },
      ],
      [
        { userId: "a", amount: 300 },
        { userId: "b", amount: 300 },
        { userId: "c", amount: 300 },
        { userId: "d", amount: 300 },
      ],
    );
    expect(debts).toEqual([
      { debtorId: "c", creditorId: "a", amount: 250 },
      { debtorId: "c", creditorId: "b", amount: 50 },
      { debtorId: "d", creditorId: "a", amount: 250 },
      { debtorId: "d", creditorId: "b", amount: 50 },
    ]);
  });

  it("rounds the whole matrix so no payer is over- or under-paid", () => {
    // a and b each paid 1 more than their share; c and d each owe 1.
    // Rounding each debtor's row separately would send both units to a.
    const debts = allocatePairwise(
      [
        { userId: "a", amount: 2 },
        { userId: "b", amount: 2 },
      ],
      [
        { userId: "a", amount: 1 },
        { userId: "b", amount: 1 },
        { userId: "c", amount: 1 },
        { userId: "d", amount: 1 },
      ],
    );
    expect(debts).toEqual([
      { debtorId: "c", creditorId: "a", amount: 1 },
      { debtorId: "d", creditorId: "b", amount: 1 },
    ]);
  });

  it("repairs cases the greedy largest-remainder pass cannot place (found by fuzzing)", () => {
    const payers = [
      { userId: "p0", amount: 15 },
      { userId: "p1", amount: 13 },
      { userId: "p2", amount: 8 },
    ];
    const shares = [
      { userId: "u0", amount: 7 },
      { userId: "u1", amount: 4 },
      { userId: "u2", amount: 11 },
      { userId: "u3", amount: 4 },
      { userId: "u4", amount: 3 },
      { userId: "u5", amount: 7 },
    ];
    const debts = allocatePairwise(payers, shares);

    const nets = netsFromDebts(debts);
    payers.forEach((p) => expect(nets.get(p.userId)).toBe(p.amount));
    shares.forEach((s) => expect(nets.get(s.userId)).toBe(-s.amount));
    // Every cell stays within one unit of its exact proportional value (share × paid / 36).
    for (const { debtorId, creditorId, amount } of debts) {
      const exact =
        (shares.find((s) => s.userId === debtorId)!.amount * payers.find((p) => p.userId === creditorId)!.amount) / 36;
      expect(Math.abs(amount - exact)).toBeLessThan(1);
    }
    expect(allocatePairwise(payers, shares)).toEqual(debts);
  });

  it("reconciles with every person's net in a messy multi-payer case", () => {
    const payers = [
      { userId: "a", amount: 3337 },
      { userId: "b", amount: 2221 },
      { userId: "c", amount: 1111 },
    ];
    const shares = [
      { userId: "a", amount: 1000 },
      { userId: "b", amount: 1001 },
      { userId: "c", amount: 1667 },
      { userId: "d", amount: 1500 },
      { userId: "e", amount: 1501 },
    ];
    const nets = netsFromDebts(allocatePairwise(payers, shares));
    expect(nets.get("a")).toBe(2337);
    expect(nets.get("b")).toBe(1220);
    expect(nets.get("c")).toBe(-556);
    expect(nets.get("d")).toBe(-1500);
    expect(nets.get("e")).toBe(-1501);
  });

  it("returns no debts when everyone paid exactly their share", () => {
    expect(
      allocatePairwise(
        [
          { userId: "a", amount: 100 },
          { userId: "b", amount: 200 },
        ],
        [
          { userId: "a", amount: 100 },
          { userId: "b", amount: 200 },
        ],
      ),
    ).toEqual([]);
  });

  it("rejects payers and shares that do not match", () => {
    expectCode(
      () => allocatePairwise([{ userId: "a", amount: 100 }], [{ userId: "a", amount: 99 }]),
      "SHARES_SUM_MISMATCH",
    );
    expectCode(() => allocatePairwise([], [{ userId: "a", amount: 99 }]), "NO_PAYERS");
  });
});

describe("validatePayers", () => {
  it("requires payer contributions to sum to the expense amount", () => {
    expect(() =>
      validatePayers(900, [
        { userId: "a", amount: 600 },
        { userId: "b", amount: 300 },
      ]),
    ).not.toThrow();
    expectCode(() => validatePayers(900, [{ userId: "a", amount: 800 }]), "PAYERS_SUM_MISMATCH");
  });

  it("rejects empty, duplicate, zero and negative payers", () => {
    expectCode(() => validatePayers(900, []), "NO_PAYERS");
    expectCode(
      () =>
        validatePayers(900, [
          { userId: "a", amount: 450 },
          { userId: "a", amount: 450 },
        ]),
      "DUPLICATE_USER",
    );
    expectCode(
      () =>
        validatePayers(900, [
          { userId: "a", amount: 900 },
          { userId: "b", amount: 0 },
        ]),
      "INVALID_AMOUNT",
    );
    expectCode(
      () =>
        validatePayers(900, [
          { userId: "a", amount: 1000 },
          { userId: "b", amount: -100 },
        ]),
      "INVALID_AMOUNT",
    );
  });
});
