import { describe, expect, it } from "vitest";

import { CURRENCIES, DEFAULT_CURRENCY, getCurrency, isCurrencyCode } from "@/lib/money/currencies";
import { MoneyError } from "@/lib/money/errors";

describe("currency table", () => {
  it("defaults to INR", () => {
    expect(DEFAULT_CURRENCY).toBe("INR");
  });

  it.each([
    ["INR", 2],
    ["USD", 2],
    ["EUR", 2],
    ["GBP", 2],
    ["JPY", 0],
    ["KRW", 0],
    ["KWD", 3],
    ["BHD", 3],
  ])("%s has exponent %i", (code, exponent) => {
    expect(getCurrency(code).exponent).toBe(exponent);
  });

  it("keys every entry by its own ISO code", () => {
    for (const [code, currency] of Object.entries(CURRENCIES)) {
      expect(currency.code).toBe(code);
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3]).toContain(currency.exponent);
    }
  });

  it("recognises supported codes only", () => {
    expect(isCurrencyCode("INR")).toBe(true);
    expect(isCurrencyCode("inr")).toBe(false);
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(() => getCurrency("XYZ")).toThrow(MoneyError);
  });
});
