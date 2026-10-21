import { addMinor, assertMinorAmount } from "@/lib/money/amount";

import { requireCurrency } from "./errors";

/** One person-to-person balance from the viewer's side: positive = they owe you. */
export interface CounterpartyBalance {
  currency: string;
  amount: number;
}

/** Dashboard totals for one currency. Currencies are never mixed. */
export interface CurrencySummary {
  currency: string;
  /** Sum of positive balances (others owe you). Always ≥ 0. */
  owedToYou: number;
  /** Sum of negative balances as a positive number (you owe others). Always ≥ 0. */
  youOwe: number;
  /** owedToYou − youOwe. */
  net: number;
}

/**
 * Totals per currency, sorted by currency code. Owed and owing are summed
 * separately (not netted across people) so the dashboard can show both.
 */
export function summarizeBalances(balances: readonly CounterpartyBalance[]): CurrencySummary[] {
  const byCurrency = new Map<string, CurrencySummary>();

  for (const { currency, amount } of balances) {
    requireCurrency(currency);
    assertMinorAmount(amount, { allowZero: true, allowNegative: true }, "balance");
    const summary = byCurrency.get(currency) ?? { currency, owedToYou: 0, youOwe: 0, net: 0 };
    if (amount > 0) summary.owedToYou = addMinor(summary.owedToYou, amount);
    else summary.youOwe = addMinor(summary.youOwe, -amount);
    summary.net = addMinor(summary.net, amount);
    byCurrency.set(currency, summary);
  }

  return [...byCurrency.values()]
    .filter((summary) => summary.owedToYou !== 0 || summary.youOwe !== 0)
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
