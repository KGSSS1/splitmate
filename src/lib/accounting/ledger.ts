import { AccountingError, requireAmount, requireCurrency } from "./errors";
import { allocatePairwise, validatePayers } from "./pairwise";
import type { LedgerEntry, Payer, SettlementStatus, UserAmount } from "./types";

/** One version of an expense, as stored: amount, payers and resolved shares. */
export interface ExpenseLedgerInput {
  expenseId: string;
  version: number;
  groupId: string | null;
  currency: string;
  /** Expense amount; payers and shares must each add up to it. */
  total: number;
  payers: readonly Payer[];
  shares: readonly UserAmount[];
}

function requireVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AccountingError("INVALID_VERSION", `Version must be a positive integer, got ${version}`);
  }
}

/** Checks a ledger row is well formed: positive safe-integer amount, known currency, two different users. */
export function requireLedgerEntry(entry: LedgerEntry): void {
  requireAmount(entry.amount, "Ledger entry amount");
  requireCurrency(entry.currency);
  if (entry.debtorId === entry.creditorId) {
    throw new AccountingError("SAME_USER", "A ledger entry needs two different people");
  }
}

/** Charge entries for one version of an expense (pairwise debts from payers and shares). */
export function buildExpenseEntries(input: ExpenseLedgerInput): LedgerEntry[] {
  requireCurrency(input.currency);
  requireVersion(input.version);
  validatePayers(input.total, input.payers);
  // allocatePairwise also requires the shares to add up to the payers, i.e. to the total.
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
    requireLedgerEntry(entry);
    if (entry.entryType !== "charge") {
      throw new AccountingError("SOURCE_MISMATCH", "Only charge entries can be reversed");
    }
    return { ...entry, debtorId: entry.creditorId, creditorId: entry.debtorId, entryType: "reversal" };
  });
}

/**
 * Entries for editing an expense: reversals of every charge of the current
 * version followed by charges for the next version (exactly one higher).
 * The current version's charges are rebuilt from its stored payers and shares,
 * so nothing can be left unreversed by passing an incomplete list.
 */
export function amendExpenseEntries(current: ExpenseLedgerInput, next: ExpenseLedgerInput): LedgerEntry[] {
  if (current.expenseId !== next.expenseId) {
    throw new AccountingError("SOURCE_MISMATCH", "An edit must stay on the same expense");
  }
  requireVersion(current.version);
  if (next.version !== current.version + 1) {
    throw new AccountingError("INVALID_VERSION", `Expected version ${current.version + 1}, got ${next.version}`);
  }
  return [...cancelExpenseEntries(current), ...buildExpenseEntries(next)];
}

/** Entries for cancelling an expense: reversals of every charge of its current version. */
export function cancelExpenseEntries(current: ExpenseLedgerInput): LedgerEntry[] {
  return reverseEntries(buildExpenseEntries(current));
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
