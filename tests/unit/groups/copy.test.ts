import { describe, expect, it } from "vitest";

import { emptyExpensesText, suggestionsExplanation } from "@/lib/groups/copy";

describe("group page wording", () => {
  // Review L16: a former member can't add expenses, so don't ask them to.
  it("doesn't invite a former member to add an expense", () => {
    expect(emptyExpensesText(true)).toMatch(/^Add the first expense/);
    expect(emptyExpensesText(false)).not.toMatch(/add/i);
  });

  // Review L20: only admins can change the setting.
  it("sends only admins to Settings for Simplify debts", () => {
    expect(suggestionsExplanation({ simplify: false, isAdmin: true })).toContain("Turn on Simplify debts in Settings");
    const member = suggestionsExplanation({ simplify: false, isAdmin: false });
    expect(member).not.toContain("Settings");
    expect(member).toContain("A group admin can turn on Simplify debts");
    expect(suggestionsExplanation({ simplify: true, isAdmin: false })).toMatch(/^Simplified:/);
  });
});
