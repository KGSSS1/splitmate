/** How an expense is split (`expenses.split_method`). */
export const SPLIT_METHODS = ["equal", "exact", "percentage", "shares", "itemized"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
  equal: "Equally",
  exact: "Exact amounts",
  percentage: "Percentages",
  shares: "Shares",
  itemized: "By item",
};

export function isSplitMethod(value: unknown): value is SplitMethod {
  return typeof value === "string" && (SPLIT_METHODS as readonly string[]).includes(value);
}

/** Tax, service charge, tip and discount lines of an itemized bill (`expense_items.kind`). */
export const ADJUSTMENT_KINDS = ["tax", "service", "tip", "discount"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  tax: "Tax",
  service: "Service charge",
  tip: "Tip",
  discount: "Discount",
};

/**
 * Categories offered in the form. Stored as the key in `expenses.category`
 * (free text up to 40 characters, so the list can grow without a migration).
 */
export const EXPENSE_CATEGORIES = [
  { value: "food", label: "Food and drink" },
  { value: "groceries", label: "Groceries" },
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "transport", label: "Transport" },
  { value: "travel", label: "Travel and stays" },
  { value: "entertainment", label: "Entertainment" },
  { value: "shopping", label: "Shopping" },
  { value: "health", label: "Health" },
  { value: "other", label: "Other" },
] as const;

export function categoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return EXPENSE_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

/** Group expense list page size. */
export const EXPENSES_PAGE_SIZE = 20;
