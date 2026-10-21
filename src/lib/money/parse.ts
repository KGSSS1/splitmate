import { MAX_MINOR_AMOUNT } from "./amount";
import { CURRENCIES, isCurrencyCode } from "./currencies";

export type ParseMoneyError =
  | "EMPTY"
  | "INVALID_FORMAT"
  | "TOO_MANY_DECIMALS"
  | "NEGATIVE"
  | "TOO_LARGE"
  | "UNKNOWN_CURRENCY";

export type ParseMoneyResult = { ok: true; value: number } | { ok: false; error: ParseMoneyError };

/**
 * Integer part: plain digits, or digits grouped with commas in either the
 * Indian (1,23,456) or international (123,456) style; the last group always has 3 digits.
 * Fraction: "." followed by digits. ".5" and "5." are accepted.
 */
const AMOUNT_PATTERN = /^(\d+|\d{1,3}(?:,\d{2,3})*,\d{3})?(?:\.(\d*))?$/;

/**
 * Parses a user-entered, non-negative amount like "1,23,456.78" into minor units
 * using string and BigInt arithmetic only (never parseFloat).
 * Extra trailing zeros beyond the currency's exponent are accepted ("10.500" INR);
 * any other extra precision is rejected rather than rounded.
 */
export function parseMoney(input: string, currency: string): ParseMoneyResult {
  if (!isCurrencyCode(currency)) return { ok: false, error: "UNKNOWN_CURRENCY" };
  const { exponent } = CURRENCIES[currency];

  const text = input.trim();
  if (text === "") return { ok: false, error: "EMPTY" };
  if (text.startsWith("-")) return { ok: false, error: "NEGATIVE" };

  const match = AMOUNT_PATTERN.exec(text);
  const integerPart = match?.[1]?.replaceAll(",", "") ?? "";
  const fractionPart = match?.[2] ?? "";
  if (!match || (integerPart === "" && fractionPart === "")) {
    return { ok: false, error: "INVALID_FORMAT" };
  }

  const significantFraction = fractionPart.replace(/0+$/, "");
  if (significantFraction.length > exponent) return { ok: false, error: "TOO_MANY_DECIMALS" };

  const digits = (integerPart || "0") + significantFraction.padEnd(exponent, "0");
  const value = BigInt(digits);
  if (value > BigInt(MAX_MINOR_AMOUNT)) return { ok: false, error: "TOO_LARGE" };

  return { ok: true, value: Number(value) };
}
