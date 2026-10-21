import { AccountingError, requireAmount, requireUniqueUsers } from "./errors";
import { allocateByWeights } from "./rounding";
import type { Share, UserAmount, UserId } from "./types";

/** 100% in basis points. */
export const FULL_PERCENT_BPS = 10_000;

/** Equal split among the listed participants; anyone not listed owes nothing. */
export function splitEqual(total: number, userIds: readonly UserId[]): Share[] {
  requireAmount(total, "Expense amount");
  requireUniqueUsers(userIds, "Equal split");
  return allocateByWeights(
    total,
    userIds.map((userId) => ({ userId, weight: 1 })),
  );
}

/** Exact amounts per participant; they must add up to the total (0 is allowed). */
export function splitExact(total: number, shares: readonly UserAmount[]): Share[] {
  requireAmount(total, "Expense amount");
  requireUniqueUsers(
    shares.map((s) => s.userId),
    "Exact split",
  );
  let sum = 0n;
  for (const { userId, amount } of shares) {
    requireAmount(amount, `Share for ${userId}`, { allowZero: true });
    sum += BigInt(amount);
  }
  if (sum !== BigInt(total)) {
    throw new AccountingError("SHARES_SUM_MISMATCH", `Exact shares add up to ${sum}, expected ${total}`);
  }
  return shares.map(({ userId, amount }) => ({ userId, amount, roundingUnit: 0 }));
}

/** Percentage split in basis points (10,000 = 100%); must total exactly 100%. */
export function splitPercentage(total: number, shares: readonly { userId: UserId; basisPoints: number }[]): Share[] {
  requireAmount(total, "Expense amount");
  requireUniqueUsers(
    shares.map((s) => s.userId),
    "Percentage split",
  );
  let sum = 0;
  for (const { userId, basisPoints } of shares) {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > FULL_PERCENT_BPS) {
      throw new AccountingError(
        "INVALID_PERCENTAGE",
        `Percentage for ${userId} must be 0–10000 basis points, got ${basisPoints}`,
      );
    }
    sum += basisPoints;
  }
  if (sum !== FULL_PERCENT_BPS) {
    throw new AccountingError("PERCENT_NOT_100", `Percentages add up to ${sum / 100}%, expected 100%`);
  }
  return allocateByWeights(
    total,
    shares.map(({ userId, basisPoints }) => ({ userId, weight: basisPoints })),
  );
}

/** Weighted split by positive integer shares (e.g. 2 shares vs 1). */
export function splitShares(total: number, shares: readonly { userId: UserId; weight: number }[]): Share[] {
  requireAmount(total, "Expense amount");
  requireUniqueUsers(
    shares.map((s) => s.userId),
    "Shares split",
  );
  for (const { userId, weight } of shares) {
    if (!Number.isSafeInteger(weight) || weight < 1) {
      throw new AccountingError("INVALID_WEIGHT", `Shares for ${userId} must be a positive integer, got ${weight}`);
    }
  }
  return allocateByWeights(total, shares);
}

/** A non-itemized split rule, as stored on an expense or recurring template. */
export type SplitRule =
  | { method: "equal"; userIds: UserId[] }
  | { method: "exact"; shares: UserAmount[] }
  | { method: "percentage"; shares: { userId: UserId; basisPoints: number }[] }
  | { method: "shares"; shares: { userId: UserId; weight: number }[] };

export function computeShares(total: number, rule: SplitRule): Share[] {
  switch (rule.method) {
    case "equal":
      return splitEqual(total, rule.userIds);
    case "exact":
      return splitExact(total, rule.shares);
    case "percentage":
      return splitPercentage(total, rule.shares);
    case "shares":
      return splitShares(total, rule.shares);
  }
}
