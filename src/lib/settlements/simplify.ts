import { isMinorAmount } from "@/lib/money/amount";

import { AccountingError, requireCurrency } from "@/lib/accounting/errors";
import type { Balance, UserId } from "@/lib/accounting/types";

/** A suggested payment: `fromUserId` pays `toUserId`. */
export interface Transfer {
  fromUserId: UserId;
  toUserId: UserId;
  amount: number;
  currency: string;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Position {
  userId: UserId;
  amount: number;
}

/** Largest amount first; ties by user ID. */
function pickLargest(positions: Position[]): Position {
  return positions.reduce((best, p) =>
    p.amount > best.amount || (p.amount === best.amount && compare(p.userId, best.userId) < 0) ? p : best,
  );
}

/**
 * Simplified (not necessarily minimal) set of transfers that settles net
 * balances (SPEC §7). Per currency, repeatedly matches the largest creditor
 * with the largest debtor (ties by user ID) and transfers the smaller amount.
 * Each step clears at least one person, so n non-zero members need at most
 * n − 1 transfers, and every net balance is preserved exactly. Finding the true
 * minimum is NP-hard, so never call this result "optimal".
 */
export function simplifyDebts(balances: readonly Balance[]): Transfer[] {
  const byCurrency = new Map<string, Map<UserId, number>>();
  for (const { userId, currency, amount } of balances) {
    requireCurrency(currency);
    if (!isMinorAmount(amount)) {
      throw new AccountingError("INVALID_AMOUNT", `Balance for ${userId} must be a safe integer, got ${amount}`);
    }
    const members = byCurrency.get(currency) ?? new Map<UserId, number>();
    if (members.has(userId)) {
      throw new AccountingError("DUPLICATE_USER", `Duplicate ${currency} balance for ${userId}`);
    }
    members.set(userId, amount);
    byCurrency.set(currency, members);
  }

  const transfers: Transfer[] = [];
  for (const currency of [...byCurrency.keys()].sort(compare)) {
    const members = [...byCurrency.get(currency)!];
    const total = members.reduce((acc, [, amount]) => acc + BigInt(amount), 0n);
    if (total !== 0n) {
      throw new AccountingError("UNBALANCED", `${currency} balances add up to ${total}, expected 0`);
    }

    let creditors: Position[] = members.filter(([, a]) => a > 0).map(([userId, amount]) => ({ userId, amount }));
    let debtors: Position[] = members.filter(([, a]) => a < 0).map(([userId, amount]) => ({ userId, amount: -amount }));

    while (creditors.length > 0 && debtors.length > 0) {
      const creditor = pickLargest(creditors);
      const debtor = pickLargest(debtors);
      const amount = Math.min(creditor.amount, debtor.amount);
      transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amount, currency });
      creditor.amount -= amount;
      debtor.amount -= amount;
      creditors = creditors.filter((p) => p.amount > 0);
      debtors = debtors.filter((p) => p.amount > 0);
    }
  }
  return transfers;
}
