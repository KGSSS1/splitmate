import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { allocateByWeights, roundShares } from "@/lib/accounting/rounding";

describe("roundShares (largest remainder)", () => {
  it("gives everyone the floor and hands leftovers to the largest remainders", () => {
    // Exact shares 10/7, 20/7, 40/7 → 1.43, 2.86, 5.71 → floors 1, 2, 5, leftover 2,
    // remainders 3/7, 6/7, 5/7 → b and c get the extra units.
    const shares = roundShares(
      [
        { userId: "a", numerator: 10n },
        { userId: "b", numerator: 20n },
        { userId: "c", numerator: 40n },
      ],
      7n,
      10,
    );
    expect(shares).toEqual([
      { userId: "a", amount: 1, roundingUnit: 0 },
      { userId: "b", amount: 3, roundingUnit: 1 },
      { userId: "c", amount: 6, roundingUnit: 1 },
    ]);
  });

  it("breaks equal remainders by entry order", () => {
    const shares = allocateByWeights(2, [
      { userId: "z", weight: 1 },
      { userId: "y", weight: 1 },
      { userId: "x", weight: 1 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([1, 1, 0]);
  });

  it("is deterministic for the same input", () => {
    const weights = [
      { userId: "a", weight: 3 },
      { userId: "b", weight: 3 },
      { userId: "c", weight: 1 },
    ];
    const first = allocateByWeights(1001, weights);
    expect(allocateByWeights(1001, weights)).toEqual(first);
    expect(first.reduce((sum, s) => sum + s.amount, 0)).toBe(1001);
  });

  it("never gives a rounding unit to a zero weight", () => {
    const shares = allocateByWeights(5, [
      { userId: "a", weight: 1 },
      { userId: "excluded", weight: 0 },
      { userId: "b", weight: 1 },
    ]);
    expect(shares).toEqual([
      { userId: "a", amount: 3, roundingUnit: 1 },
      { userId: "excluded", amount: 0, roundingUnit: 0 },
      { userId: "b", amount: 2, roundingUnit: 0 },
    ]);
  });

  it("stays exact for amounts near the safe-integer limit", () => {
    const shares = allocateByWeights(Number.MAX_SAFE_INTEGER, [
      { userId: "a", weight: 3333 },
      { userId: "b", weight: 3333 },
      { userId: "c", weight: 3334 },
    ]);
    const sum = shares.reduce((acc, s) => acc + BigInt(s.amount), 0n);
    expect(sum).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    shares.forEach((s) => expect(Number.isSafeInteger(s.amount)).toBe(true));
  });

  it("rejects inconsistent fractions", () => {
    expect(() => roundShares([{ userId: "a", numerator: 5n }], 1n, 4)).toThrow(AccountingError);
    expect(() => roundShares([{ userId: "a", numerator: 4n }], 0n, 4)).toThrow(AccountingError);
    expect(() => roundShares([{ userId: "a", numerator: -1n }, { userId: "b", numerator: 5n }], 1n, 4)).toThrow(
      AccountingError,
    );
  });

  it("rejects weights that are all zero, negative or fractional", () => {
    expect(() => allocateByWeights(10, [{ userId: "a", weight: 0 }])).toThrow(AccountingError);
    expect(() => allocateByWeights(10, [{ userId: "a", weight: -1 }])).toThrow(AccountingError);
    expect(() => allocateByWeights(10, [{ userId: "a", weight: 1.5 }])).toThrow(AccountingError);
  });
});
