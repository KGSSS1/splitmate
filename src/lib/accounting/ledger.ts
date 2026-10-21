import { AccountingError, requireAmount, requireCurrency } from "./errors";
import { allocatePairwise } from "./pairwise";
import type { LedgerEntry, Payer, SettlementStatus, UserAmount } from "./types";

export interface ExpenseLedgerInput {
  expenseId: string;
  version: number;
  groupId: string | null;
  currency: string;
  payers: readonly Payer[];
  shares: readonly UserAmount[];
}

function requireVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AccountingError("INVALID_VERSION", `Version must be a positive integer, got ${version}`);
  }
}

/** Charge entries for one version of an expense (pairwise debts from payers and shares). */
export function buildExpenseEntries(input: ExpenseLedgerInput): LedgerEntry[] {
  requireCurrency(input.currency);
  requireVersion(input.version);
  return allocatePairwise(input.payers, input.shares).map((debt) => ({
    ...debt,
    currency: input.currency,
    groupId: input.groupId,
    source: { kind: "expense", id: input.expenseId, version: input.version },
    entryType: "charge",
  }));
}

/**
 * Reversing entries: same amount, currency, group and source, opposite direction.
 * Amounts stay positive; the swap is what cancels the original's effect.
 */
export function reverseEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.map((entry) => {
    if (entry.entryType !== "charge") {
      throw new AccountingError("SOURCE_MISMATCH", "Only charge entries can be reversed");
    }
    return { ...entry, debtorId: entry.creditorId, creditorId: entry.debtorId, entryType: "reversal" };
  });
}

/** Checks that `entries` are the charges of one version of one expense and returns that version. */
function requireExpenseVersion(entries: readonly LedgerEntry[], expenseId?: string): number | undefined {
  const first = entries[0];
  if (!first) return undefined;
  for (const { source, entryType } of entries) {
    if (
      entryType !== "charge" ||
      source.kind !== "expense" ||
      source.id !== (expenseId ?? first.source.id) ||
      source.version !== first.source.version
    ) {
      throw new AccountingError("SOURCE_MISMATCH", "Entries must be the charges of a single expense version");
    }
  }
  return first.source.version;
}

/**
 * Entries for editing an expense: reversals of the current version's charges
 * followed by charges for the new version (which must be exactly one higher).
 */
export function amendExpenseEntries(current: readonly LedgerEntry[], next: ExpenseLedgerInput): LedgerEntry[] {
  const currentVersion = requireExpenseVersion(current, next.expenseId);
  if (currentVersion !== undefined && next.version !== currentVersion + 1) {
    throw new AccountingError(
      "INVALID_VERSION",
      `Expected version ${currentVersion + 1}, got ${next.version}`,
    );
  }
  return [...reverseEntries(current), ...buildExpenseEntries(next)];
}

/** Entries for cancelling an expense: reversals only. */
export function cancelExpenseEntries(current: readonly LedgerEntry[]): LedgerEntry[] {
  requireExpenseVersion(current);
  return reverseEntries(current);
}

export interface SettlementLedgerInput {
  settlementId: string;
  payerId: string;
  receiverId: string;
  amount: number;
  currency: string;
  groupId: string | null;
  status: SettlementStatus;
}

/**
 * A completed settlement writes one entry in the opposite direction of the debt
 * (the receiver now "owes" the payer that amount), reducing the payer's debt.
 * Pending, rejected and cancelled settlements have no balance effect.
 */
export function buildSettlementEntries(input: SettlementLedgerInput): LedgerEntry[] {
  requireCurrency(input.currency);
  requireAmount(input.amount, "Settlement amount");
  if (input.payerId === input.receiverId) {
    throw new AccountingError("SAME_USER", "A settlement needs two different people");
  }
  if (input.status !== "completed") return [];
  return [
    {
      debtorId: input.receiverId,
      creditorId: input.payerId,
      amount: input.amount,
      currency: input.currency,
      groupId: input.groupId,
      source: { kind: "settlement", id: input.settlementId, version: 1 },
      entryType: "charge",
    },
  ];
}
