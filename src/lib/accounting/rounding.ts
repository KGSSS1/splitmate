import { AccountingError, requireAmount } from "./errors";
import type { Share, UserId } from "./types";

/** An exact share expressed as `numerator / denominator` minor units. */
export interface ExactShare {
  userId: UserId;
  numerator: bigint;
}

/**
 * Largest remainder method (SPEC §7): every participant gets the floor of their
 * exact share, then the leftover minor units go one each to the largest
 * fractional remainders. Ties go to the earlier entry (entry order is the
 * stable order; user ID is the final fallback). Output keeps input order.
 *
 * Requires Σ numerators = total × denominator, so the result always sums to `total`.
 * BigInt is used internally because products like amount × basis points can
 * exceed Number.MAX_SAFE_INTEGER.
 */
export function roundShares(exact: readonly ExactShare[], denominator: bigint, total: number): Share[] {
  requireAmount(total, "total", { allowZero: true });
  if (denominator <= 0n) {
    throw new AccountingError("INVALID_FRACTION", "Denominator must be positive");
  }
  let sum = 0n;
  for (const { numerator } of exact) {
    if (numerator < 0n) throw new AccountingError("INVALID_FRACTION", "Exact shares must not be negative");
    sum += numerator;
  }
  if (sum !== BigInt(total) * denominator) {
    throw new AccountingError("INVALID_FRACTION", "Exact shares do not add up to the total");
  }

  const rows = exact.map(({ userId, numerator }, index) => ({
    userId,
    index,
    floor: numerator / denominator,
    remainder: numerator % denominator,
  }));
  let leftover = BigInt(total) - rows.reduce((acc, row) => acc + row.floor, 0n);

  const byPriority = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  const extra = new Set<number>();
  for (const row of byPriority) {
    if (leftover === 0n) break;
    extra.add(row.index);
    leftover -= 1n;
  }

  return rows.map((row) => {
    const roundingUnit = extra.has(row.index) ? 1 : 0;
    return { userId: row.userId, amount: Number(row.floor) + roundingUnit, roundingUnit };
  });
}

/** Splits `total` proportionally to non-negative integer weights (at least one positive). */
export function allocateByWeights(total: number, weights: readonly { userId: UserId; weight: number }[]): Share[] {
  let weightSum = 0n;
  for (const { userId, weight } of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new AccountingError("INVALID_WEIGHT", `Weight for ${userId} must be a non-negative integer, got ${weight}`);
    }
    weightSum += BigInt(weight);
  }
  if (weightSum === 0n) {
    throw new AccountingError("INVALID_WEIGHT", "At least one weight must be positive");
  }
  requireAmount(total, "total", { allowZero: true });
  return roundShares(
    weights.map(({ userId, weight }) => ({ userId, numerator: BigInt(total) * BigInt(weight) })),
    weightSum,
    total,
  );
}
