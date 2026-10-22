import { AccountingError, requireCurrency } from "@/lib/accounting/errors";
import type { Balance, UserId } from "@/lib/accounting/types";
import { isMinorAmount } from "@/lib/money/amount";

import { simplifyDebts } from "./simplify";

/** One row of `my_pairwise_balances()`: positive = that person owes the viewer. */
export interface RawPairwiseRow {
  counterpartyId: UserId;
  /** null = direct expenses and settlements between the two. */
  groupId: string | null;
  currency: string;
  amount: number;
  /** The group simplifies debts; its raw rows are replaced by the plan. */
  simplified: boolean;
}

/** One row of `my_simplified_group_balances()`: a member's net in a group that simplifies. */
export interface GroupNetRow extends Balance {
  groupId: string;
}

/** What the viewer and one person owe each other in one context and currency. */
export interface ContextBalance {
  counterpartyId: UserId;
  groupId: string | null;
  currency: string;
  /** Positive = they owe the viewer. Never zero. */
  amount: number;
  /** Comes from the group's simplified plan rather than raw pairwise entries. */
  simplified: boolean;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The viewer's balance with each person per context and currency (SPEC §2, §7):
 * - direct, and groups that don't simplify: the raw pairwise balance;
 * - groups that simplify: the transfer between the two in that group's
 *   simplified plan (`simplifyDebts` over members' nets), so friend balances,
 *   dashboard totals and "settle up everything" agree with the group's own
 *   suggestions. Once the plan is followed, nothing is owed anywhere.
 * Raw rows of simplifying groups are dropped even when the viewer has left the
 * group: their net there is zero, so the plan has nothing for them.
 */
export function friendContextBalances({
  viewerId,
  raw,
  groupNets,
}: {
  viewerId: UserId;
  raw: readonly RawPairwiseRow[];
  groupNets: readonly GroupNetRow[];
}): ContextBalance[] {
  const rows: ContextBalance[] = [];
  for (const row of raw) {
    requireCurrency(row.currency);
    if (!isMinorAmount(row.amount) || row.amount === 0) {
      throw new AccountingError("INVALID_AMOUNT", `Pairwise balance must be a non-zero safe integer, got ${row.amount}`);
    }
    if (!row.simplified) rows.push({ ...row });
  }

  const byGroup = new Map<string, Balance[]>();
  for (const { groupId, userId, currency, amount } of groupNets) {
    const nets = byGroup.get(groupId) ?? [];
    nets.push({ userId, currency, amount });
    byGroup.set(groupId, nets);
  }
  for (const [groupId, nets] of byGroup) {
    for (const transfer of simplifyDebts(nets)) {
      if (transfer.toUserId === viewerId) {
        rows.push({ counterpartyId: transfer.fromUserId, groupId, currency: transfer.currency, amount: transfer.amount, simplified: true });
      } else if (transfer.fromUserId === viewerId) {
        rows.push({ counterpartyId: transfer.toUserId, groupId, currency: transfer.currency, amount: -transfer.amount, simplified: true });
      }
    }
  }

  return rows.sort(
    (a, b) =>
      compare(a.counterpartyId, b.counterpartyId) ||
      (a.groupId === null ? -1 : b.groupId === null ? 1 : compare(a.groupId, b.groupId)) ||
      compare(a.currency, b.currency),
  );
}

/**
 * What "settle up everything" with `friendId` covers: direct balances and
 * groups the two of them are both still in (`sharedGroupIds`). A group either
 * has left is settled inside that group, not from here.
 */
export function settleableWith<T extends ContextBalance>(
  rows: readonly T[],
  friendId: UserId,
  sharedGroupIds: ReadonlySet<string>,
): T[] {
  return rows.filter(
    (row) => row.counterpartyId === friendId && (row.groupId === null || sharedGroupIds.has(row.groupId)),
  );
}
