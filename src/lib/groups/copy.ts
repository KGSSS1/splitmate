/** Group page wording that depends on who is looking (review L16, L20). */

export function emptyExpensesText(isMember: boolean): string {
  return isMember
    ? "Add the first expense to see who owes whom."
    : "There are no expenses here that you were part of.";
}

export function suggestionsExplanation({ simplify, isAdmin }: { simplify: boolean; isAdmin: boolean }): string {
  if (simplify) {
    return "Simplified: debts across the group are combined into fewer payments, so you may pay someone you never owed directly. Everyone's balance ends up the same. This is a simplified plan, not necessarily the fewest possible payments.";
  }
  return isAdmin
    ? "Who owes whom directly from the group's expenses. Turn on Simplify debts in Settings to combine them into fewer payments."
    : "Who owes whom directly from the group's expenses. A group admin can turn on Simplify debts to combine them into fewer payments.";
}
