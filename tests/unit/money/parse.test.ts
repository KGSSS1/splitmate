import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { minorToDecimalString } from "@/lib/money/format";
import { parseMoney } from "@/lib/money/parse";

describe("parseMoney", () => {
  it.each([
    ["123.45", "INR", 12345],
    ["123.4", "INR", 12340],
    ["123", "INR", 12300],
    ["0.01", "INR", 1],
    [".5", "INR", 50],
    ["5.", "INR", 500],
    ["  42.10  ", "INR", 4210],
    ["1,23,456.78", "INR", 12345678],
    ["123,456.78", "USD", 12345678],
    ["1,234,567", "USD", 123456700],
    ["12,34,56,789", "INR", 123456789_00],
    ["1,234", "INR", 123400],
    ["12,345", "INR", 1234500],
    ["10.500", "INR", 1050],
    ["1500", "JPY", 1500],
    ["1.234", "KWD", 1234],
    ["0.001", "KWD", 1],
    ["0", "INR", 0],
  ])("parses %j %s as %i minor units", (input, currency, expected) => {
    expect(parseMoney(input, currency)).toEqual({ ok: true, value: expected });
  });

  it("does not use floating point: 0.1 + 0.2 style inputs are exact", () => {
    expect(parseMoney("0.29", "INR")).toEqual({ ok: true, value: 29 });
    expect(parseMoney("1.15", "INR")).toEqual({ ok: true, value: 115 });
    expect(parseMoney("4.35", "INR")).toEqual({ ok: true, value: 435 });
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["-5", "NEGATIVE"],
    ["-0.50", "NEGATIVE"],
    ["+5", "INVALID_FORMAT"],
    ["abc", "INVALID_FORMAT"],
    ["1.2.3", "INVALID_FORMAT"],
    ["₹100", "INVALID_FORMAT"],
    ["1e3", "INVALID_FORMAT"],
    ["1 000", "INVALID_FORMAT"],
    [",100", "INVALID_FORMAT"],
    ["100,", "INVALID_FORMAT"],
    ["1,00,0", "INVALID_FORMAT"],
    // Review finding 7: mixed or malformed grouping was accepted.
    ["1,234,56,789", "INVALID_FORMAT"],
    ["123,45,678", "INVALID_FORMAT"],
    ["1,23,456,789", "INVALID_FORMAT"],
    ["1234,567", "INVALID_FORMAT"],
    ["123,4567", "INVALID_FORMAT"],
    [".", "INVALID_FORMAT"],
    ["1.234", "TOO_MANY_DECIMALS"],
    ["90071992547409.92", "TOO_LARGE"],
    ["99999999999999999999", "TOO_LARGE"],
  ])("rejects %j with %s", (input, error) => {
    expect(parseMoney(input, "INR")).toEqual({ ok: false, error });
  });

  it("respects the currency exponent", () => {
    expect(parseMoney("100.5", "JPY")).toEqual({ ok: false, error: "TOO_MANY_DECIMALS" });
    expect(parseMoney("1.2345", "KWD")).toEqual({ ok: false, error: "TOO_MANY_DECIMALS" });
    expect(parseMoney("100", "XYZ")).toEqual({ ok: false, error: "UNKNOWN_CURRENCY" });
  });

  it("accepts the maximum safe amount and nothing above it", () => {
    expect(parseMoney("90071992547409.91", "INR")).toEqual({ ok: true, value: Number.MAX_SAFE_INTEGER });
  });

  it("round-trips with minorToDecimalString", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom("INR", "JPY", "KWD"),
        (minor, currency) => {
          expect(parseMoney(minorToDecimalString(minor, currency), currency)).toEqual({
            ok: true,
            value: minor,
          });
        },
      ),
    );
  });
});
