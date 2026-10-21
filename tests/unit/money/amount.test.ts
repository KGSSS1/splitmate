import { describe, expect, it } from "vitest";

import { MAX_MINOR_AMOUNT, addMinor, assertMinorAmount, isMinorAmount } from "@/lib/money/amount";
import { MoneyError } from "@/lib/money/errors";

describe("minor-unit amount guards", () => {
  it("caps amounts at Number.MAX_SAFE_INTEGER", () => {
    expect(MAX_MINOR_AMOUNT).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("accepts safe integers only", () => {
    expect(isMinorAmount(0)).toBe(true);
    expect(isMinorAmount(-5)).toBe(true);
    expect(isMinorAmount(MAX_MINOR_AMOUNT)).toBe(true);
    expect(isMinorAmount(MAX_MINOR_AMOUNT + 1)).toBe(false);
    expect(isMinorAmount(1.5)).toBe(false);
    expect(isMinorAmount(Number.NaN)).toBe(false);
    expect(isMinorAmount("100")).toBe(false);
  });

  it("rejects zero and negative amounts unless allowed", () => {
    expect(() => assertMinorAmount(1)).not.toThrow();
    expect(() => assertMinorAmount(0)).toThrow(MoneyError);
    expect(() => assertMinorAmount(-1)).toThrow(MoneyError);
    expect(() => assertMinorAmount(0, { allowZero: true })).not.toThrow();
    expect(() => assertMinorAmount(-1, { allowNegative: true })).not.toThrow();
    expect(() => assertMinorAmount(0.1)).toThrow(/safe integer/);
  });

  it("adds without silently losing precision", () => {
    expect(addMinor(2, 3)).toBe(5);
    expect(addMinor(-2, 3)).toBe(1);
    expect(() => addMinor(MAX_MINOR_AMOUNT, 1)).toThrow(MoneyError);
    expect(() => addMinor(-MAX_MINOR_AMOUNT, -1)).toThrow(MoneyError);
  });
});
