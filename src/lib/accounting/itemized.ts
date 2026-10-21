import { MAX_MINOR_AMOUNT } from "@/lib/money/amount";

import { AccountingError, requireAmount, requireUniqueUsers } from "./errors";
import { roundShares } from "./rounding";
import type { Share, UserId } from "./types";

export interface ItemizedItem {
  amount: number;
  /** Who shares this item; `weight` defaults to 1 (equal split of the item). */
  assignments: readonly { userId: UserId; weight?: number }[];
}

export type AdjustmentKind = "tax" | "service" | "tip" | "discount";

export interface ItemizedAdjustment {
  kind: AdjustmentKind;
  amount: number;
  /** "proportional" (default) follows each person's pre-tax item subtotal; "equal" splits evenly. */
  allocation?: "proportional" | "equal";
}

export interface ItemizedInput {
  items: readonly ItemizedItem[];
  adjustments?: readonly ItemizedAdjustment[];
}

export interface ItemizedResult {
  /** Bill total = items + tax + service + tip − discounts. */
  total: number;
  /** One share per participant, in order of first appearance across items. */
  shares: Share[];
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
const lcm = (a: bigint, b: bigint): bigint => (a / gcd(a, b)) * b;

/**
 * Itemized split (SPEC §7). Everything is kept as exact fractions over one
 * common denominator and rounded once at the end with the largest remainder
 * method, so the final shares sum exactly to the bill total:
 *
 * 1. Each item is split among its assignees by weight → exact pre-tax subtotals sᵢ.
 * 2. Tax, service charge and tip add A·sᵢ/S (S = items total), or A/n when "equal".
 * 3. Discounts subtract the same way.
 */
export function splitItemized(input: ItemizedInput): ItemizedResult {
  const { items, adjustments = [] } = input;
  if (items.length === 0) {
    throw new AccountingError("NO_PARTICIPANTS", "An itemized bill needs at least one item");
  }

  const people: UserId[] = [];
  const indexOf = new Map<UserId, number>();
  let itemsTotal = 0n;
  let denominator = 1n; // lcm of every item's weight sum

  const parsedItems = items.map((item, itemIndex) => {
    requireAmount(item.amount, `Item ${itemIndex + 1} amount`);
    requireUniqueUsers(
      item.assignments.map((a) => a.userId),
      `Item ${itemIndex + 1}`,
    );
    let weightSum = 0n;
    const assignments = item.assignments.map(({ userId, weight = 1 }) => {
      if (!Number.isSafeInteger(weight) || weight < 1) {
        throw new AccountingError("INVALID_WEIGHT", `Weight for ${userId} must be a positive integer, got ${weight}`);
      }
      if (!indexOf.has(userId)) {
        indexOf.set(userId, people.length);
        people.push(userId);
      }
      weightSum += BigInt(weight);
      return { userId, weight: BigInt(weight) };
    });
    itemsTotal += BigInt(item.amount);
    denominator = lcm(denominator, weightSum);
    return { amount: BigInt(item.amount), assignments, weightSum };
  });

  // Exact pre-tax subtotals, as numerators over `denominator`. Σ subtotals = itemsTotal × denominator.
  const subtotals: bigint[] = people.map(() => 0n);
  for (const item of parsedItems) {
    const scale = denominator / item.weightSum;
    for (const { userId, weight } of item.assignments) {
      const index = indexOf.get(userId)!;
      subtotals[index] = subtotals[index]! + item.amount * weight * scale;
    }
  }

  let total = itemsTotal;
  let discounts = 0n;
  for (const { kind, amount } of adjustments) {
    requireAmount(amount, `${kind} amount`);
    if (kind === "discount") {
      discounts += BigInt(amount);
      total -= BigInt(amount);
    } else {
      total += BigInt(amount);
    }
  }
  if (discounts > itemsTotal) {
    throw new AccountingError("DISCOUNT_EXCEEDS_ITEMS", "Discounts cannot exceed the item total");
  }
  if (total <= 0n || total > BigInt(MAX_MINOR_AMOUNT)) {
    throw new AccountingError("INVALID_AMOUNT", "The bill total must be positive and within the supported range");
  }

  // Common denominator for subtotals (÷denominator), proportional charges (÷itemsTotal) and equal charges (÷n).
  const n = BigInt(people.length);
  const commonDenominator = denominator * itemsTotal * n;
  const numerators = subtotals.map((subtotal) => subtotal * itemsTotal * n);
  for (const { kind, amount, allocation = "proportional" } of adjustments) {
    const signed = kind === "discount" ? -BigInt(amount) : BigInt(amount);
    for (let i = 0; i < numerators.length; i += 1) {
      const portion = allocation === "equal" ? signed * denominator * itemsTotal : signed * subtotals[i]! * n;
      numerators[i] = numerators[i]! + portion;
    }
  }

  numerators.forEach((numerator, i) => {
    if (numerator < 0n) {
      throw new AccountingError("NEGATIVE_SHARE", `Adjustments would give ${people[i]} a negative share`);
    }
  });

  const shares = roundShares(
    people.map((userId, i) => ({ userId, numerator: numerators[i]! })),
    commonDenominator,
    Number(total),
  );
  return { total: Number(total), shares };
}
