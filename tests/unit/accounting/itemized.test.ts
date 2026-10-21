import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { splitItemized } from "@/lib/accounting/itemized";

const byUser = (shares: { userId: string; amount: number }[]) =>
  Object.fromEntries(shares.map((s) => [s.userId, s.amount]));

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

describe("itemized split", () => {
  it("splits each item among its assignees and sums to the item total", () => {
    const result = splitItemized({
      items: [
        { amount: 60000, assignments: [{ userId: "a" }] },
        { amount: 30000, assignments: [{ userId: "b" }, { userId: "c" }] },
        { amount: 9000, assignments: [{ userId: "a" }, { userId: "b" }, { userId: "c" }] },
      ],
    });
    expect(result.total).toBe(99000);
    expect(byUser(result.shares)).toEqual({ a: 63000, b: 18000, c: 18000 });
  });

  it("orders participants by first appearance", () => {
    const result = splitItemized({
      items: [
        { amount: 100, assignments: [{ userId: "z" }] },
        { amount: 100, assignments: [{ userId: "y" }, { userId: "z" }] },
      ],
    });
    expect(result.shares.map((s) => s.userId)).toEqual(["z", "y"]);
  });

  it("supports weighted assignments within an item", () => {
    const result = splitItemized({
      items: [{ amount: 900, assignments: [{ userId: "a", weight: 2 }, { userId: "b" }] }],
    });
    expect(byUser(result.shares)).toEqual({ a: 600, b: 300 });
  });

  it("allocates tax, service charge and tip proportionally to pre-tax subtotals", () => {
    // Subtotals a 600, b 300, c 100 (of 1000). Tax 100, service 50, tip 150 → 300 extra.
    const result = splitItemized({
      items: [
        { amount: 600, assignments: [{ userId: "a" }] },
        { amount: 300, assignments: [{ userId: "b" }] },
        { amount: 100, assignments: [{ userId: "c" }] },
      ],
      adjustments: [
        { kind: "tax", amount: 100 },
        { kind: "service", amount: 50 },
        { kind: "tip", amount: 150 },
      ],
    });
    expect(result.total).toBe(1300);
    expect(byUser(result.shares)).toEqual({ a: 780, b: 390, c: 130 });
  });

  it("can split a charge equally instead of proportionally", () => {
    const result = splitItemized({
      items: [
        { amount: 600, assignments: [{ userId: "a" }] },
        { amount: 300, assignments: [{ userId: "b" }] },
        { amount: 100, assignments: [{ userId: "c" }] },
      ],
      adjustments: [{ kind: "tip", amount: 300, allocation: "equal" }],
    });
    expect(byUser(result.shares)).toEqual({ a: 700, b: 400, c: 200 });
  });

  it("reduces shares proportionally for discounts", () => {
    const result = splitItemized({
      items: [
        { amount: 600, assignments: [{ userId: "a" }] },
        { amount: 400, assignments: [{ userId: "b" }] },
      ],
      adjustments: [{ kind: "discount", amount: 100 }],
    });
    expect(result.total).toBe(900);
    expect(byUser(result.shares)).toEqual({ a: 540, b: 360 });
  });

  it("rounds once at the end so shares sum exactly to the bill total", () => {
    // Three-way item with 18% tax and a tip that do not divide evenly.
    const result = splitItemized({
      items: [
        { amount: 1000, assignments: [{ userId: "a" }, { userId: "b" }, { userId: "c" }] },
        { amount: 333, assignments: [{ userId: "a" }, { userId: "b" }] },
      ],
      adjustments: [
        { kind: "tax", amount: 240 },
        { kind: "tip", amount: 101, allocation: "equal" },
        { kind: "discount", amount: 7 },
      ],
    });
    expect(result.total).toBe(1000 + 333 + 240 + 101 - 7);
    expect(result.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(result.total);
    expect(result.shares.filter((s) => s.roundingUnit === 1).length).toBeLessThan(result.shares.length);
  });

  it("gives zero liability to someone assigned no items (only listed participants appear)", () => {
    const result = splitItemized({
      items: [{ amount: 500, assignments: [{ userId: "a" }] }],
      adjustments: [{ kind: "tax", amount: 50 }],
    });
    expect(result.shares).toEqual([{ userId: "a", amount: 550, roundingUnit: 0 }]);
  });

  it("rejects discounts larger than the items", () => {
    expectCode(
      () =>
        splitItemized({
          items: [{ amount: 100, assignments: [{ userId: "a" }] }],
          adjustments: [{ kind: "discount", amount: 101 }],
        }),
      "DISCOUNT_EXCEEDS_ITEMS",
    );
  });

  it("rejects an equal discount that would make someone's share negative", () => {
    expectCode(
      () =>
        splitItemized({
          items: [
            { amount: 1000, assignments: [{ userId: "a" }] },
            { amount: 10, assignments: [{ userId: "b" }] },
          ],
          adjustments: [{ kind: "discount", amount: 100, allocation: "equal" }],
        }),
      "NEGATIVE_SHARE",
    );
  });

  it("rejects invalid items", () => {
    expectCode(() => splitItemized({ items: [] }), "NO_PARTICIPANTS");
    expectCode(() => splitItemized({ items: [{ amount: 100, assignments: [] }] }), "NO_PARTICIPANTS");
    expectCode(() => splitItemized({ items: [{ amount: 0, assignments: [{ userId: "a" }] }] }), "INVALID_AMOUNT");
    expectCode(
      () => splitItemized({ items: [{ amount: 100, assignments: [{ userId: "a" }, { userId: "a" }] }] }),
      "DUPLICATE_USER",
    );
    expectCode(
      () => splitItemized({ items: [{ amount: 100, assignments: [{ userId: "a", weight: 0 }] }] }),
      "INVALID_WEIGHT",
    );
    expectCode(
      () =>
        splitItemized({
          items: [{ amount: 100, assignments: [{ userId: "a" }] }],
          adjustments: [{ kind: "tax", amount: -5 }],
        }),
      "INVALID_AMOUNT",
    );
  });
});
