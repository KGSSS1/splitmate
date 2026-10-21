import { MoneyError } from "./errors";

/**
 * Amounts are integers in the currency's minor unit, held in a JS `number`
 * and limited to the safe-integer range so they stay exact and JSON-serializable
 * (SPEC §7). The database column is `bigint`, which is wider than this limit.
 */
export const MAX_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER;

export function isMinorAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export interface AmountRules {
  /** Allow 0 (e.g. an excluded participant's share). */
  allowZero?: boolean;
  /** Allow negative values (e.g. a net balance). */
  allowNegative?: boolean;
}

export function assertMinorAmount(value: number, rules: AmountRules = {}, label = "amount"): void {
  if (!isMinorAmount(value)) {
    throw new MoneyError("INVALID_AMOUNT", `${label} must be a safe integer of minor units, got ${value}`);
  }
  if (value === 0 && !rules.allowZero) {
    throw new MoneyError("INVALID_AMOUNT", `${label} must not be zero`);
  }
  if (value < 0 && !rules.allowNegative) {
    throw new MoneyError("INVALID_AMOUNT", `${label} must not be negative, got ${value}`);
  }
}

/** Adds two minor-unit amounts, throwing instead of losing precision. */
export function addMinor(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError("OVERFLOW", "Amount exceeds the maximum supported value");
  }
  return result;
}
