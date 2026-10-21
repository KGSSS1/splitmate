import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { computeShares, splitEqual, splitExact, splitPercentage, splitShares } from "@/lib/accounting/splits";

const amounts = (shares: { amount: number }[]) => shares.map((s) => s.amount);

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

describe("equal split", () => {
  it("splits evenly with rounding units to the earliest participants", () => {
    expect(amounts(splitEqual(10000, ["a", "b", "c"]))).toEqual([3334, 3333, 3333]);
    expect(amounts(splitEqual(10001, ["a", "b", "c"]))).toEqual([3334, 3334, 3333]);
    expect(amounts(splitEqual(5, ["a"]))).toEqual([5]);
  });

  it("works for a zero-exponent currency amount (¥100 / 3)", () => {
    expect(amounts(splitEqual(100, ["a", "b", "c"]))).toEqual([34, 33, 33]);
  });

  it("gives fewer units than participants to the first ones", () => {
    expect(amounts(splitEqual(2, ["a", "b", "c"]))).toEqual([1, 1, 0]);
  });
});

describe("exact split", () => {
  it("keeps exact amounts that sum to the total", () => {
    const shares = splitExact(1000, [
      { userId: "a", amount: 700 },
      { userId: "b", amount: 300 },
      { userId: "c", amount: 0 },
    ]);
    expect(shares).toEqual([
      { userId: "a", amount: 700, roundingUnit: 0 },
      { userId: "b", amount: 300, roundingUnit: 0 },
      { userId: "c", amount: 0, roundingUnit: 0 },
    ]);
  });

  it("rejects amounts that do not sum to the total", () => {
    expectCode(() => splitExact(1000, [{ userId: "a", amount: 999 }]), "SHARES_SUM_MISMATCH");
    expectCode(() => splitExact(1000, [{ userId: "a", amount: 1001 }]), "SHARES_SUM_MISMATCH");
  });

  it("rejects negative or fractional exact amounts", () => {
    expectCode(
      () =>
        splitExact(1000, [
          { userId: "a", amount: 1100 },
          { userId: "b", amount: -100 },
        ]),
      "INVALID_AMOUNT",
    );
    expectCode(() => splitExact(1000, [{ userId: "a", amount: 999.5 }, { userId: "b", amount: 0.5 }]), "INVALID_AMOUNT");
  });
});

describe("percentage split (basis points)", () => {
  it("splits by basis points with largest remainder rounding", () => {
    // 33.33% / 33.33% / 33.34% of ₹100
    expect(
      amounts(
        splitPercentage(10000, [
          { userId: "a", basisPoints: 3333 },
          { userId: "b", basisPoints: 3333 },
          { userId: "c", basisPoints: 3334 },
        ]),
      ),
    ).toEqual([3333, 3333, 3334]);
    // 50% / 25% / 25% of 1 paisa
    expect(
      amounts(
        splitPercentage(1, [
          { userId: "a", basisPoints: 5000 },
          { userId: "b", basisPoints: 2500 },
          { userId: "c", basisPoints: 2500 },
        ]),
      ),
    ).toEqual([1, 0, 0]);
  });

  it("rejects percentages that do not total 100%", () => {
    expectCode(
      () =>
        splitPercentage(10000, [
          { userId: "a", basisPoints: 5000 },
          { userId: "b", basisPoints: 4999 },
        ]),
      "PERCENT_NOT_100",
    );
    expectCode(
      () =>
        splitPercentage(10000, [
          { userId: "a", basisPoints: 6000 },
          { userId: "b", basisPoints: 5000 },
        ]),
      "PERCENT_NOT_100",
    );
  });

  it("rejects out-of-range or fractional basis points", () => {
    expectCode(
      () =>
        splitPercentage(100, [
          { userId: "a", basisPoints: 10001 },
          { userId: "b", basisPoints: -1 },
        ]),
      "INVALID_PERCENTAGE",
    );
    expectCode(
      () =>
        splitPercentage(100, [
          { userId: "a", basisPoints: 5000.5 },
          { userId: "b", basisPoints: 4999.5 },
        ]),
      "INVALID_PERCENTAGE",
    );
  });

  it("gives a 0% participant zero liability (exclusion)", () => {
    const shares = splitPercentage(999, [
      { userId: "a", basisPoints: 10000 },
      { userId: "excluded", basisPoints: 0 },
    ]);
    expect(shares[1]).toEqual({ userId: "excluded", amount: 0, roundingUnit: 0 });
  });
});

describe("weighted-share split", () => {
  it("splits proportionally to positive integer weights", () => {
    expect(
      amounts(
        splitShares(1000, [
          { userId: "a", weight: 2 },
          { userId: "b", weight: 1 },
          { userId: "c", weight: 1 },
        ]),
      ),
    ).toEqual([500, 250, 250]);
    expect(
      amounts(
        splitShares(100, [
          { userId: "a", weight: 1 },
          { userId: "b", weight: 2 },
        ]),
      ),
    ).toEqual([33, 67]);
  });

  it("rejects zero, negative or fractional weights", () => {
    expectCode(() => splitShares(100, [{ userId: "a", weight: 0 }]), "INVALID_WEIGHT");
    expectCode(() => splitShares(100, [{ userId: "a", weight: -2 }]), "INVALID_WEIGHT");
    expectCode(() => splitShares(100, [{ userId: "a", weight: 1.5 }]), "INVALID_WEIGHT");
  });
});

describe("common validation", () => {
  it.each([0, -100, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])("rejects total %s", (total) => {
    expectCode(() => splitEqual(total, ["a"]), "INVALID_AMOUNT");
  });

  it("accepts the largest safe total", () => {
    const shares = splitEqual(Number.MAX_SAFE_INTEGER, ["a", "b"]);
    expect(amounts(shares)).toEqual([4503599627370496, 4503599627370495]);
  });

  it("rejects empty and duplicate participant lists", () => {
    expectCode(() => splitEqual(100, []), "NO_PARTICIPANTS");
    expectCode(() => splitEqual(100, ["a", "a"]), "DUPLICATE_USER");
    expectCode(
      () =>
        splitShares(100, [
          { userId: "a", weight: 1 },
          { userId: "a", weight: 2 },
        ]),
      "DUPLICATE_USER",
    );
  });

  it("excludes members simply by not listing them", () => {
    const shares = splitEqual(900, ["a", "c"]);
    expect(shares.find((s) => s.userId === "b")).toBeUndefined();
    expect(amounts(shares)).toEqual([450, 450]);
  });
});

describe("computeShares", () => {
  it("dispatches on the split method", () => {
    expect(amounts(computeShares(900, { method: "equal", userIds: ["a", "b", "c"] }))).toEqual([300, 300, 300]);
    expect(
      amounts(
        computeShares(900, {
          method: "exact",
          shares: [
            { userId: "a", amount: 100 },
            { userId: "b", amount: 800 },
          ],
        }),
      ),
    ).toEqual([100, 800]);
    expect(
      amounts(
        computeShares(900, {
          method: "percentage",
          shares: [
            { userId: "a", basisPoints: 2500 },
            { userId: "b", basisPoints: 7500 },
          ],
        }),
      ),
    ).toEqual([225, 675]);
    expect(
      amounts(
        computeShares(900, {
          method: "shares",
          shares: [
            { userId: "a", weight: 1 },
            { userId: "b", weight: 2 },
          ],
        }),
      ),
    ).toEqual([300, 600]);
  });
});
