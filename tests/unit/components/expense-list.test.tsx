import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpenseList } from "@/components/expenses/expense-list";
import type { ExpenseListItem } from "@/server/expenses";

const item = (myNet: number | null): ExpenseListItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  description: "Hotel",
  amount: 90000,
  currency: "INR",
  expenseDate: "2026-10-21",
  category: null,
  status: "active",
  paidBy: "Asha",
  myNet,
});

// Review M5: each row says what the expense did for the viewer when it was added,
// which must not read like a current balance (that can already be settled).
describe("ExpenseList", () => {
  it("says the viewer borrowed or lent, not that they owe", () => {
    render(<ExpenseList items={[item(-30000)]} label="Expenses" />);
    expect(screen.getByText("You borrowed ₹300.00")).toBeInTheDocument();
    expect(screen.queryByText(/You owe/)).not.toBeInTheDocument();
  });

  it("uses a neutral colour, so it isn't mistaken for what is owed now", () => {
    render(<ExpenseList items={[item(-30000), item(60000)]} label="Expenses" />);
    for (const text of ["You borrowed ₹300.00", "You lent ₹600.00"]) {
      expect(screen.getByText(text).className).not.toMatch(/text-(destructive|primary)\b/);
    }
  });
});
