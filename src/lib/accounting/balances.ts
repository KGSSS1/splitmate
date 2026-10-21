import { isMinorAmount } from "@/lib/money/amount";

import { AccountingError } from "./errors";
import { requireLedgerEntry } from "./ledger";
import type { Balance, LedgerEntry, UserId } from "./types";

/**
 * Balances derived from the pairwise ledger (SPEC §6). Positive = others owe
 * this person; negative = this person owes. Currencies are never mixed.
 * Zero balances are omitted; results are sorted for stable output.
 *
 * Sums are accumulated in BigInt and range-checked once at the end, so the
 * result never depends on the order of the entries.
 */

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toSafe(total: bigint): number {
  const value = Number(total);
  if (!isMinorAmount(value) || BigInt(value) !== total) {
    throw new AccountingError("OVERFLOW", "Balance exceeds the maximum supported amount");
  }
  return value;
}

function accumulate<K>(totals: Map<string, { key: K; total: bigint }>, id: string, key: K, delta: number) {
  const row = totals.get(id) ?? { key, total: 0n };
  row.total += BigInt(delta);
  totals.set(id, row);
}

/** Net position per user and currency. */
export function netBalances(entries: readonly LedgerEntry[]): Balance[] {
  const totals = new Map<string, { key: { userId: UserId; currency: string }; total: bigint }>();
  for (const entry of entries) {
    requireLedgerEntry(entry);
    const { debtorId, creditorId, amount, currency } = entry;
    accumulate(totals, JSON.stringify([currency, creditorId]), { userId: creditorId, currency }, amount);
    accumulate(totals, JSON.stringify([currency, debtorId]), { userId: debtorId, currency }, -amount);
  }
  return [...totals.values()]
    .filter(({ total }) => total !== 0n)
    .map(({ key, total }) => ({ ...key, amount: toSafe(total) }))
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
  const totals = new Map<string, { key: { counterpartyId: UserId; currency: string }; total: bigint }>();
  for (const entry of entries) {
    requireLedgerEntry(entry);
    const { debtorId, creditorId, amount, currency } = entry;
    if (creditorId === userId) {
      accumulate(totals, JSON.stringify([debtorId, currency]), { counterpartyId: debtorId, currency }, amount);
    } else if (debtorId === userId) {
      accumulate(totals, JSON.stringify([creditorId, currency]), { counterpartyId: creditorId, currency }, -amount);
    }
  }
  return [...totals.values()]
    .filter(({ total }) => total !== 0n)
    .map(({ key, total }) => ({ ...key, amount: toSafe(total) }))
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
