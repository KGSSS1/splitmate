import { AccountingError } from "@/lib/accounting/errors";
import { splitItemized } from "@/lib/accounting/itemized";
import { allocatePairwise } from "@/lib/accounting/pairwise";
import { FULL_PERCENT_BPS, splitEqual, splitExact, splitPercentage, splitShares } from "@/lib/accounting/splits";
import type { PairwiseDebt, Payer, Share } from "@/lib/accounting/types";
import { isCurrencyCode, maxExpenseMinor } from "@/lib/money/currencies";
import { formatMoney } from "@/lib/money/format";
import { type ParseMoneyError, parseMoney } from "@/lib/money/parse";

import type { AdjustmentKind, SplitMethod } from "./options";
import { formatBasisPoints, parsePercent } from "./percent";

/**
 * Everything the expense form edits, as the user typed it (amounts are
 * decimal strings). The same values are sent to the Server Action, which
 * resolves them again on the server: amounts computed in the browser are never
 * trusted (SPEC §6).
 */
export interface ExpenseFormValues {
  description: string;
  /** Ignored for itemized bills, whose total comes from the items. */
  amount: string;
  currency: string;
  /** YYYY-MM-DD */
  date: string;
  category: string;
  notes: string;
  /** Comma-separated. */
  tags: string;
  /** A user ID, or "multiple" to enter what each person paid. */
  paidBy: string;
  splitMethod: SplitMethod;
  /** Everyone who can take part, in entry order (rounding ties go to earlier people). */
  people: ExpensePersonValues[];
  items: ExpenseItemValues[];
  adjustments: ExpenseAdjustmentValues[];
}

export interface ExpensePersonValues {
  userId: string;
  /** Part of an equal / exact / percentage / shares split. Excluded people owe nothing. */
  included: boolean;
  /** What they paid, when `paidBy` is "multiple". */
  paid: string;
  exact: string;
  percent: string;
  shares: string;
}

export interface ExpenseItemValues {
  name: string;
  amount: string;
  /** User IDs sharing this item equally. */
  assignees: string[];
}

export interface ExpenseAdjustmentValues {
  kind: AdjustmentKind;
  amount: string;
  allocation: "proportional" | "equal";
}

export const MULTIPLE_PAYERS = "multiple";

export interface ExpenseIssue {
  /** Form path the message belongs to, e.g. "amount", "people", "items.2.amount". */
  path: string;
  message: string;
}

export interface ResolvedItem {
  name: string;
  kind: "item" | AdjustmentKind;
  amount: number;
  allocation?: "proportional" | "equal";
  assignees?: string[];
}

export interface ResolvedExpense {
  total: number;
  currency: string;
  splitMethod: SplitMethod;
  payers: Payer[];
  /** One per participant; zero shares are kept for percentage splits at 0%. */
  shares: Share[];
  /** Basis points or weights per participant, for percentage and shares splits. */
  basisPoints: Map<string, number>;
  weights: Map<string, number>;
  items: ResolvedItem[];
  /** Pairwise charge entries for the ledger (src/lib/accounting). */
  debts: PairwiseDebt[];
}

export type ResolveResult =
  | { ok: true; expense: ResolvedExpense }
  | {
      ok: false;
      issues: ExpenseIssue[];
      /** Shares computed so far, so the preview can still show them. */
      total: number | null;
      shares: Share[] | null;
    };

/** User-facing messages for amounts that fail to parse. */
export const MONEY_ERRORS: Record<ParseMoneyError, string> = {
  EMPTY: "Enter an amount.",
  INVALID_FORMAT: "Enter a number, like 1250.50.",
  TOO_MANY_DECIMALS: "Too many decimal places for this currency.",
  NEGATIVE: "Amounts can't be negative.",
  TOO_LARGE: "That amount is too large.",
  UNKNOWN_CURRENCY: "Choose a supported currency.",
};

const ACCOUNTING_MESSAGES: Partial<Record<AccountingError["code"], string>> = {
  DISCOUNT_EXCEEDS_ITEMS: "Discounts can't be more than the items total.",
  NEGATIVE_SHARE: "An equal discount would give someone a negative share. Split it proportionally instead.",
  INVALID_AMOUNT: "The bill total must be more than zero.",
};

function money(input: string, currency: string): { value: number } | { error: string } {
  const result = parseMoney(input, currency);
  return result.ok ? { value: result.value } : { error: MONEY_ERRORS[result.error] };
}

/** Like `money`, but an empty field means zero. */
function moneyOrZero(input: string, currency: string): { value: number } | { error: string } {
  return input.trim() === "" ? { value: 0 } : money(input, currency);
}

/**
 * Resolves form values into the expense's total, payers, shares and pairwise
 * debts with the accounting module, or explains what is wrong. Deterministic:
 * the same values always give the same result (SPEC §7).
 */
export function resolveExpense(values: ExpenseFormValues): ResolveResult {
  const issues: ExpenseIssue[] = [];
  const fail = (total: number | null = null, shares: Share[] | null = null): ResolveResult => ({
    ok: false,
    issues,
    total,
    shares,
  });

  const { currency } = values;
  if (!isCurrencyCode(currency)) {
    issues.push({ path: "currency", message: "Choose a supported currency." });
    return fail();
  }
  const format = (amount: number) => formatMoney(amount, currency);

  // 1. Total and shares.
  let total: number | null = null;
  let shares: Share[] | null = null;
  const basisPoints = new Map<string, number>();
  const weights = new Map<string, number>();
  let items: ResolvedItem[] = [];

  if (values.splitMethod === "itemized") {
    const resolved = resolveItemized(values, currency, issues);
    if (!resolved) return fail();
    ({ total, shares, items } = resolved);
  } else {
    const amount = money(values.amount, currency);
    if ("error" in amount) {
      issues.push({ path: "amount", message: amount.error });
    } else if (amount.value === 0) {
      issues.push({ path: "amount", message: "Enter an amount more than zero." });
    } else {
      total = amount.value;
    }

    const included = values.people.filter((person) => person.included);
    if (included.length === 0) {
      issues.push({ path: "people", message: "Choose at least one person to split with." });
      return fail(total);
    }
    if (total === null) return fail();
    shares = resolveShares(values, included, total, currency, basisPoints, weights, issues, format);
    if (!shares) return fail(total);
  }

  // One expense may not exceed the currency's limit (SPEC §7); the database checks it too.
  const max = maxExpenseMinor(currency);
  if (total > max) {
    issues.push({
      path: values.splitMethod === "itemized" ? "items" : "amount",
      message: `One expense in ${currency} can be at most ${formatMoney(max, currency)}.`,
    });
    return fail(total, shares);
  }

  // 2. Payers.
  const payers = resolvePayers(values, total, currency, issues, format);
  if (!payers) return fail(total, shares);

  // 3. Pairwise debts (the ledger rows). Cannot fail once payers and shares both add up.
  let debts: PairwiseDebt[];
  try {
    debts = allocatePairwise(payers, shares);
  } catch (error) {
    issues.push({ path: "form", message: accountingMessage(error) });
    return fail(total, shares);
  }

  return {
    ok: true,
    expense: {
      total,
      currency,
      splitMethod: values.splitMethod,
      payers,
      shares,
      basisPoints,
      weights,
      items,
      debts,
    },
  };
}

function resolveShares(
  values: ExpenseFormValues,
  included: readonly ExpensePersonValues[],
  total: number,
  currency: string,
  basisPoints: Map<string, number>,
  weights: Map<string, number>,
  issues: ExpenseIssue[],
  format: (amount: number) => string,
): Share[] | null {
  const indexOf = (userId: string) => values.people.findIndex((person) => person.userId === userId);

  switch (values.splitMethod) {
    case "equal":
      return splitEqual(
        total,
        included.map((person) => person.userId),
      );

    case "exact": {
      let sum = 0;
      const amounts: { userId: string; amount: number }[] = [];
      for (const person of included) {
        const parsed = moneyOrZero(person.exact, currency);
        if ("error" in parsed) {
          issues.push({ path: `people.${indexOf(person.userId)}.exact`, message: parsed.error });
          continue;
        }
        sum += parsed.value;
        amounts.push({ userId: person.userId, amount: parsed.value });
      }
      if (issues.length > 0) return null;
      if (!Number.isSafeInteger(sum) || sum !== total) {
        const message =
          sum < total
            ? `The amounts add up to ${format(sum)}. ${format(total - sum)} is left to assign.`
            : `The amounts add up to ${format(sum)}, ${format(sum - total)} more than the total.`;
        issues.push({ path: "people", message });
        return null;
      }
      return splitExact(total, amounts);
    }

    case "percentage": {
      let sum = 0;
      for (const person of included) {
        const parsed = person.percent.trim() === "" ? 0 : parsePercent(person.percent);
        if (parsed === null) {
          issues.push({
            path: `people.${indexOf(person.userId)}.percent`,
            message: "Enter a percentage from 0 to 100, with at most two decimals.",
          });
          continue;
        }
        sum += parsed;
        basisPoints.set(person.userId, parsed);
      }
      if (issues.length > 0) return null;
      if (sum !== FULL_PERCENT_BPS) {
        const message =
          sum < FULL_PERCENT_BPS
            ? `The percentages add up to ${formatBasisPoints(sum)}%. ${formatBasisPoints(FULL_PERCENT_BPS - sum)}% is left.`
            : `The percentages add up to ${formatBasisPoints(sum)}%, more than 100%.`;
        issues.push({ path: "people", message });
        return null;
      }
      return splitPercentage(
        total,
        included.map((person) => ({ userId: person.userId, basisPoints: basisPoints.get(person.userId) ?? 0 })),
      );
    }

    case "shares": {
      for (const person of included) {
        const text = person.shares.trim();
        const weight = /^\d{1,6}$/.test(text) ? Number(text) : 0;
        if (weight < 1) {
          issues.push({
            path: `people.${indexOf(person.userId)}.shares`,
            message: "Enter a whole number of shares, 1 or more.",
          });
          continue;
        }
        weights.set(person.userId, weight);
      }
      if (issues.length > 0) return null;
      return splitShares(
        total,
        included.map((person) => ({ userId: person.userId, weight: weights.get(person.userId) ?? 1 })),
      );
    }

    case "itemized":
      return null;
  }
}

function resolveItemized(
  values: ExpenseFormValues,
  currency: string,
  issues: ExpenseIssue[],
): { total: number; shares: Share[]; items: ResolvedItem[] } | null {
  if (values.items.length === 0) {
    issues.push({ path: "items", message: "Add at least one item." });
    return null;
  }
  const items: ResolvedItem[] = [];
  values.items.forEach((item, index) => {
    const name = item.name.trim();
    if (!name) issues.push({ path: `items.${index}.name`, message: "Name this item." });
    const amount = money(item.amount, currency);
    if ("error" in amount) issues.push({ path: `items.${index}.amount`, message: amount.error });
    else if (amount.value === 0) issues.push({ path: `items.${index}.amount`, message: "Enter more than zero." });
    const assignees = values.people.map((person) => person.userId).filter((id) => item.assignees.includes(id));
    if (assignees.length === 0) issues.push({ path: `items.${index}.assignees`, message: "Choose who shares it." });
    if ("value" in amount && name && assignees.length > 0) {
      items.push({ name, kind: "item", amount: amount.value, assignees });
    }
  });
  values.adjustments.forEach((adjustment, index) => {
    const amount = money(adjustment.amount, currency);
    if ("error" in amount) issues.push({ path: `adjustments.${index}.amount`, message: amount.error });
    else if (amount.value === 0) {
      issues.push({ path: `adjustments.${index}.amount`, message: "Enter more than zero, or remove this line." });
    } else {
      items.push({
        name: adjustment.kind,
        kind: adjustment.kind,
        amount: amount.value,
        allocation: adjustment.allocation,
      });
    }
  });
  if (issues.length > 0) return null;

  try {
    const result = splitItemized({
      items: items
        .filter((item) => item.kind === "item")
        .map((item) => ({ amount: item.amount, assignments: (item.assignees ?? []).map((userId) => ({ userId })) })),
      adjustments: items
        .filter((item): item is ResolvedItem & { kind: AdjustmentKind } => item.kind !== "item")
        .map((item) => ({ kind: item.kind, amount: item.amount, allocation: item.allocation })),
    });
    return { total: result.total, shares: result.shares, items };
  } catch (error) {
    issues.push({ path: "items", message: accountingMessage(error) });
    return null;
  }
}

function resolvePayers(
  values: ExpenseFormValues,
  total: number,
  currency: string,
  issues: ExpenseIssue[],
  format: (amount: number) => string,
): Payer[] | null {
  if (values.paidBy !== MULTIPLE_PAYERS) {
    if (!values.people.some((person) => person.userId === values.paidBy)) {
      issues.push({ path: "paidBy", message: "Choose who paid." });
      return null;
    }
    return [{ userId: values.paidBy, amount: total }];
  }

  const payers: Payer[] = [];
  let sum = 0;
  values.people.forEach((person, index) => {
    const parsed = moneyOrZero(person.paid, currency);
    if ("error" in parsed) {
      issues.push({ path: `people.${index}.paid`, message: parsed.error });
      return;
    }
    if (parsed.value > 0) {
      payers.push({ userId: person.userId, amount: parsed.value });
      sum += parsed.value;
    }
  });
  if (issues.length > 0) return null;
  if (payers.length === 0) {
    issues.push({ path: "payers", message: "Enter what each person paid." });
    return null;
  }
  if (!Number.isSafeInteger(sum) || sum !== total) {
    const message =
      sum < total
        ? `The payments add up to ${format(sum)}. ${format(total - sum)} is still unpaid.`
        : `The payments add up to ${format(sum)}, ${format(sum - total)} more than the total.`;
    issues.push({ path: "payers", message });
    return null;
  }
  return payers;
}

function accountingMessage(error: unknown): string {
  if (error instanceof AccountingError) return ACCOUNTING_MESSAGES[error.code] ?? "This split doesn't add up.";
  return "This split doesn't add up.";
}

/** Everyone a resolved expense involves: payers and participants with a share or a payment. */
export function involvedUsers(expense: Pick<ResolvedExpense, "payers" | "shares">): string[] {
  return [...new Set([...expense.payers.map((payer) => payer.userId), ...expense.shares.map((share) => share.userId)])];
}
