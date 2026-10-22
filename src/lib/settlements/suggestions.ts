import { isMinorAmount } from "@/lib/money/amount";

import { AccountingError, requireCurrency } from "@/lib/accounting/errors";
import type { Balance, PairwiseDebt, UserId } from "@/lib/accounting/types";

import { simplifyDebts, type Transfer } from "./simplify";

/** One row of `group_pairwise_balances()`: `debtorId` owes `creditorId` in `currency`. */
export interface CurrencyDebt extends PairwiseDebt {
  currency: string;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Suggested repayments for a group (SPEC §7). With simplify-debts on, they
 * come from members' net balances (`simplifyDebts`), so someone may be asked
 * to pay a person they never owed directly. With it off, they are the raw
 * pairwise debts. Either way, every member's net balance is cleared exactly.
 * Sorted by currency, then largest amount first, then by user IDs.
 */
export function suggestedTransfers({
  simplify,
  nets,
  pairwise,
}: {
  simplify: boolean;
  nets: readonly Balance[];
  pairwise: readonly CurrencyDebt[];
}): Transfer[] {
  const transfers = simplify
    ? simplifyDebts(nets)
    : pairwise.map(({ debtorId, creditorId, amount, currency }) => {
        requireCurrency(currency);
        if (!isMinorAmount(amount) || amount <= 0) {
          throw new AccountingError("INVALID_AMOUNT", `Pairwise debt must be a positive safe integer, got ${amount}`);
        }
        if (debtorId === creditorId) throw new AccountingError("SAME_USER", "A debt needs two different people");
        return { fromUserId: debtorId, toUserId: creditorId, amount, currency };
      });

  return [...transfers].sort(
    (a, b) =>
      compare(a.currency, b.currency) ||
      b.amount - a.amount ||
      compare(a.fromUserId, b.fromUserId) ||
      compare(a.toUserId, b.toUserId),
  );
}

/** The suggestions the viewer can act on: only the payer or the receiver can record a settlement. */
export function transfersInvolving(transfers: readonly Transfer[], userId: UserId): Transfer[] {
  return transfers.filter((transfer) => transfer.fromUserId === userId || transfer.toUserId === userId);
}
