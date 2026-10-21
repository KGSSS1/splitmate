import { isMinorAmount } from "@/lib/money/amount";
import { isCurrencyCode } from "@/lib/money/currencies";

export type AccountingErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_WEIGHT"
  | "INVALID_PERCENTAGE"
  | "INVALID_FRACTION"
  | "PERCENT_NOT_100"
  | "SHARES_SUM_MISMATCH"
  | "PAYERS_SUM_MISMATCH"
  | "NO_PARTICIPANTS"
  | "NO_PAYERS"
  | "DUPLICATE_USER"
  | "DISCOUNT_EXCEEDS_ITEMS"
  | "NEGATIVE_SHARE"
  | "UNKNOWN_CURRENCY"
  | "INVALID_VERSION"
  | "SOURCE_MISMATCH"
  | "UNBALANCED"
  | "SAME_USER"
  | "NOT_A_PARTY"
  | "NOT_ALLOWED"
  | "INVALID_TRANSITION"
  | "INTERNAL";

export class AccountingError extends Error {
  readonly code: AccountingErrorCode;

  constructor(code: AccountingErrorCode, message: string) {
    super(message);
    this.name = "AccountingError";
    this.code = code;
  }
}

/** Requires a safe-integer minor-unit amount; positive unless `allowZero`. */
export function requireAmount(value: number, label: string, { allowZero = false } = {}): void {
  if (!isMinorAmount(value) || value < 0 || (value === 0 && !allowZero)) {
    const expected = allowZero ? "a non-negative" : "a positive";
    throw new AccountingError("INVALID_AMOUNT", `${label} must be ${expected} safe integer of minor units, got ${value}`);
  }
}

export function requireUniqueUsers(userIds: readonly string[], context: string): void {
  if (userIds.length === 0) {
    throw new AccountingError("NO_PARTICIPANTS", `${context} needs at least one participant`);
  }
  const seen = new Set<string>();
  for (const userId of userIds) {
    if (seen.has(userId)) {
      throw new AccountingError("DUPLICATE_USER", `${context} lists user ${userId} more than once`);
    }
    seen.add(userId);
  }
}

export function requireCurrency(currency: string): void {
  if (!isCurrencyCode(currency)) {
    throw new AccountingError("UNKNOWN_CURRENCY", `Unsupported currency: ${currency}`);
  }
}
