import { addMinor } from "@/lib/money/amount";

import type { Balance, LedgerEntry, UserId } from "./types";

/**
 * Balances derived from the pairwise ledger (SPEC §6). Positive = others owe
 * this person; negative = this person owes. Currencies are never mixed.
 * Zero balances are omitted; results are sorted for stable output.
 */

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function add(map: Map<string, number>, key: string, delta: number) {
  map.set(key, addMinor(map.get(key) ?? 0, delta));
}

/** Net position per user and currency. */
export function netBalances(entries: readonly LedgerEntry[]): Balance[] {
  const totals = new Map<string, number>();
  const keys = new Map<string, { userId: UserId; currency: string }>();
  for (const { debtorId, creditorId, amount, currency } of entries) {
    for (const [userId, delta] of [
      [creditorId, amount],
      [debtorId, -amount],
    ] as const) {
      const key = JSON.stringify([currency, userId]);
      keys.set(key, { userId, currency });
      add(totals, key, delta);
    }
  }
  return [...totals]
    .filter(([, amount]) => amount !== 0)
    .map(([key, amount]) => ({ ...keys.get(key)!, amount }))
    .sort((a, b) => compare(a.currency, b.currency) || compare(a.userId, b.userId));
}

/** Net positions within one group; `null` selects direct (non-group) entries. */
export function groupBalances(entries: readonly LedgerEntry[], groupId: string | null): Balance[] {
  return netBalances(entries.filter((entry) => entry.groupId === groupId));
}

export interface PairBalance {
  counterpartyId: UserId;
  currency: string;
  /** Positive = the counterparty owes `userId`; negative = `userId` owes them. */
  amount: number;
}

/**
 * Friend balances for `userId`: raw pairwise totals with each counterparty,
 * across every group and direct expense, per currency.
 */
export function pairBalances(entries: readonly LedgerEntry[], userId: UserId): PairBalance[] {
  const totals = new Map<string, number>();
  const keys = new Map<string, { counterpartyId: UserId; currency: string }>();
  for (const { debtorId, creditorId, amount, currency } of entries) {
    let counterpartyId: UserId;
    let delta: number;
    if (creditorId === userId) {
      counterpartyId = debtorId;
      delta = amount;
    } else if (debtorId === userId) {
      counterpartyId = creditorId;
      delta = -amount;
    } else {
      continue;
    }
    const key = JSON.stringify([counterpartyId, currency]);
    keys.set(key, { counterpartyId, currency });
    add(totals, key, delta);
  }
  return [...totals]
    .filter(([, amount]) => amount !== 0)
    .map(([key, amount]) => ({ ...keys.get(key)!, amount }))
    .sort((a, b) => compare(a.counterpartyId, b.counterpartyId) || compare(a.currency, b.currency));
}

/** Balance between two friends per currency; positive = `otherId` owes `userId`. */
export function pairBalance(
  entries: readonly LedgerEntry[],
  userId: UserId,
  otherId: UserId,
): { currency: string; amount: number }[] {
  return pairBalances(entries, userId)
    .filter((balance) => balance.counterpartyId === otherId)
    .map(({ currency, amount }) => ({ currency, amount }));
}
