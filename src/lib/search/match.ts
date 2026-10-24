import { EXPENSE_CATEGORIES } from "@/lib/expenses/options";

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** Lower-case words of a query, as `search_expenses` splits them (on whitespace). */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
}

/** True when every term appears somewhere in the given texts (case-insensitive substrings). */
export function matchesTerms(terms: readonly string[], ...texts: (string | null | undefined)[]): boolean {
  if (terms.length === 0) return false;
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Category keys whose label matches the query ("food" finds "Food and drink"). */
export function matchingCategories(terms: readonly string[]): string[] {
  return EXPENSE_CATEGORIES.filter((category) => matchesTerms(terms, category.label)).map((category) => category.value);
}
