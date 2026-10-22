import { addMinor, assertMinorAmount } from "@/lib/money/amount";

import { requireCurrency } from "./errors";
import type { CounterpartyBalance } from "./summary";

/** One row of `group_balances()` (a member's net) or `friend_balances()` (a friend's balance with you). */
export interface PersonBalanceRow {
  personId: string;
  currency: string;
  amount: number;
}

/**
 * Groups ledger-derived balance rows by person, one entry per currency (never
 * mixed), sorted by currency code. Zero balances are dropped, so a person with
 * no entry is settled up.
 */
export function balancesByPerson(rows: readonly PersonBalanceRow[]): Map<string, CounterpartyBalance[]> {
  const totals = new Map<string, Map<string, number>>();
  for (const { personId, currency, amount } of rows) {
    requireCurrency(currency);
    assertMinorAmount(amount, { allowZero: true, allowNegative: true }, "balance");
    const byCurrency = totals.get(personId) ?? new Map<string, number>();
    byCurrency.set(currency, addMinor(byCurrency.get(currency) ?? 0, amount));
    totals.set(personId, byCurrency);
  }

  const result = new Map<string, CounterpartyBalance[]>();
  for (const [personId, byCurrency] of totals) {
    const balances = [...byCurrency]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
    if (balances.length > 0) result.set(personId, balances);
  }
  return result;
}

/** True when every currency balance is zero (SPEC §2: required to leave or be removed). */
export function isSettledUp(balances: readonly CounterpartyBalance[] | undefined): boolean {
  return !balances || balances.every((balance) => balance.amount === 0);
}
