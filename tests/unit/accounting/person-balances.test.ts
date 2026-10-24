import { describe, expect, it } from "vitest";

import { balancesByPerson, isSettledUp } from "@/lib/accounting/person-balances";

describe("balancesByPerson", () => {
  it("groups rows per person, one entry per currency, sorted by code", () => {
    const result = balancesByPerson([
      { personId: "b", currency: "USD", amount: -500 },
      { personId: "a", currency: "INR", amount: 60000 },
      { personId: "b", currency: "INR", amount: -30000 },
      { personId: "a", currency: "INR", amount: -100 },
    ]);
    expect(result.get("a")).toEqual([{ currency: "INR", amount: 59900 }]);
    expect(result.get("b")).toEqual([
      { currency: "INR", amount: -30000 },
      { currency: "USD", amount: -500 },
    ]);
  });

  it("never mixes currencies with different exponents", () => {
    const result = balancesByPerson([
      { personId: "a", currency: "JPY", amount: 1500 },
      { personId: "a", currency: "KWD", amount: 1500 },
    ]);
    expect(result.get("a")).toHaveLength(2);
  });

  it("drops zero balances, so a settled person has no entry", () => {
    const result = balancesByPerson([
      { personId: "a", currency: "INR", amount: 100 },
      { personId: "a", currency: "INR", amount: -100 },
    ]);
    expect(result.has("a")).toBe(false);
  });

  it("rejects unsafe amounts and unknown currencies", () => {
    expect(() => balancesByPerson([{ personId: "a", currency: "INR", amount: 1.5 }])).toThrow();
    expect(() =>
      balancesByPerson([{ personId: "a", currency: "INR", amount: Number.MAX_SAFE_INTEGER + 1 }]),
    ).toThrow();
    expect(() => balancesByPerson([{ personId: "a", currency: "XXX", amount: 1 }])).toThrow();
  });
});

describe("isSettledUp", () => {
  it("is true only when every currency is zero", () => {
    expect(isSettledUp(undefined)).toBe(true);
    expect(isSettledUp([])).toBe(true);
    expect(isSettledUp([{ currency: "INR", amount: 0 }])).toBe(true);
    expect(
      isSettledUp([
        { currency: "INR", amount: 0 },
        { currency: "USD", amount: -1 },
      ]),
    ).toBe(false);
  });
});
