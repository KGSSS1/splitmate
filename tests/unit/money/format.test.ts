import { describe, expect, it } from "vitest";

import { formatMoney, minorToDecimalString } from "@/lib/money/format";

// Intl output uses non-breaking spaces in some locales; normalise for readable assertions.
const plain = (value: string) => value.replace(/[  ]/g, " ");

describe("minorToDecimalString", () => {
  it.each([
    [12345678, "INR", "123456.78"],
    [5, "INR", "0.05"],
    [0, "INR", "0.00"],
    [-12345, "INR", "-123.45"],
    [-5, "INR", "-0.05"],
    [1500, "JPY", "1500"],
    [1234, "KWD", "1.234"],
    [Number.MAX_SAFE_INTEGER, "INR", "90071992547409.91"],
  ])("%i %s → %s", (minor, currency, expected) => {
    expect(minorToDecimalString(minor, currency)).toBe(expected);
  });

  it("rejects unsafe values", () => {
    expect(() => minorToDecimalString(1.5, "INR")).toThrow();
    expect(() => minorToDecimalString(Number.MAX_SAFE_INTEGER + 1, "INR")).toThrow();
  });
});

describe("formatMoney", () => {
  it("defaults to en-IN grouping", () => {
    expect(formatMoney(12345678, "INR")).toBe("₹1,23,456.78");
  });

  it("uses the currency exponent for decimals", () => {
    expect(formatMoney(1500, "JPY", { locale: "en-US" })).toBe("¥1,500");
    expect(plain(formatMoney(1234, "KWD", { locale: "en-US" }))).toBe("KWD 1.234");
    expect(formatMoney(100, "USD", { locale: "en-US" })).toBe("$1.00");
  });

  it("formats large amounts exactly (no float rounding)", () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "INR")).toBe("₹9,00,71,99,25,47,409.91");
  });

  it("supports explicit signs", () => {
    expect(formatMoney(-30000, "INR")).toBe("-₹300.00");
    expect(formatMoney(60000, "INR", { signDisplay: "always" })).toBe("+₹600.00");
  });
});
