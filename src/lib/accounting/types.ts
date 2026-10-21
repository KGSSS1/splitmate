/**
 * Shared accounting types. Every amount is an integer number of minor units
 * of the relevant currency (see src/lib/money).
 */

export type UserId = string;

export interface UserAmount {
  userId: UserId;
  amount: number;
}

/** What one participant owes for an expense. `roundingUnit` is 1 if they received a leftover minor unit. */
export interface Share extends UserAmount {
  roundingUnit: 0 | 1;
}

/** How much one payer contributed to an expense. */
export type Payer = UserAmount;

/** `debtorId` owes `creditorId` a positive `amount`. */
export interface PairwiseDebt {
  debtorId: UserId;
  creditorId: UserId;
  amount: number;
}

export type LedgerSourceKind = "expense" | "settlement";

export interface LedgerSource {
  kind: LedgerSourceKind;
  id: string;
  version: number;
}

/** A charge records a debt; a reversal is the same entry in the opposite direction. */
export type LedgerEntryType = "charge" | "reversal";

/** One append-only pairwise ledger row (SPEC §6). `groupId` null = direct friend expense. */
export interface LedgerEntry extends PairwiseDebt {
  currency: string;
  groupId: string | null;
  source: LedgerSource;
  entryType: LedgerEntryType;
}

/** Net position: positive = others owe this user; negative = this user owes. */
export interface Balance {
  userId: UserId;
  currency: string;
  amount: number;
}

export type SettlementStatus = "pending" | "completed" | "cancelled" | "rejected";
