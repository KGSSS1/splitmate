import { describe, expect, it } from "vitest";

import { blankExpenseValues, storedToFormValues } from "@/lib/expenses/form-values";
import { buildExpensePayload, parseTags } from "@/lib/expenses/payload";
import { formatBasisPoints, parsePercent } from "@/lib/expenses/percent";
import { type ExpenseFormValues, MULTIPLE_PAYERS, resolveExpense } from "@/lib/expenses/resolve";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

function values(overrides: Partial<ExpenseFormValues> = {}): ExpenseFormValues {
  return {
    ...blankExpenseValues({ splitWith: "", userIds: [A, B, C], paidBy: A, currency: "INR", date: "2026-10-21" }),
    description: "Dinner",
    amount: "900",
    ...overrides,
  };
}

function resolved(input: ExpenseFormValues) {
  const result = resolveExpense(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.expense;
}

function issues(input: ExpenseFormValues) {
  const result = resolveExpense(input);
  if (result.ok) throw new Error("expected issues");
  return result.issues;
}

describe("resolveExpense", () => {
  it("SPEC §7 mandatory case: A pays ₹900 split equally → B and C each owe A ₹300", () => {
    const expense = resolved(values());
    expect(expense.total).toBe(90000);
    expect(expense.shares.map((s) => s.amount)).toEqual([30000, 30000, 30000]);
    expect(expense.debts).toEqual([
      { debtorId: B, creditorId: A, amount: 30000 },
      { debtorId: C, creditorId: A, amount: 30000 },
    ]);
  });

  it("₹100 ÷ 3 gives 3334/3333/3333 and marks who got the rounding unit", () => {
    const expense = resolved(values({ amount: "100" }));
    expect(expense.shares.map((s) => [s.amount, s.roundingUnit])).toEqual([
      [3334, 1],
      [3333, 0],
      [3333, 0],
    ]);
  });

  it("excluded people owe nothing and are not participants", () => {
    const input = values();
    input.people[2]!.included = false;
    const expense = resolved(input);
    expect(expense.shares.map((s) => s.userId)).toEqual([A, B]);
    expect(expense.shares.map((s) => s.amount)).toEqual([45000, 45000]);
  });

  it("respects each currency's exponent (JPY 0, KWD 3)", () => {
    expect(resolved(values({ currency: "JPY", amount: "100" })).shares.map((s) => s.amount)).toEqual([34, 33, 33]);
    expect(resolved(values({ currency: "KWD", amount: "1.000" })).total).toBe(1000);
    expect(issues(values({ currency: "JPY", amount: "1.5" }))[0]).toMatchObject({ path: "amount" });
  });

  it("rejects a zero, blank or malformed amount", () => {
    expect(issues(values({ amount: "0" }))[0]?.path).toBe("amount");
    expect(issues(values({ amount: "" }))[0]?.message).toBe("Enter an amount.");
    expect(issues(values({ amount: "-5" }))[0]?.message).toContain("negative");
    expect(issues(values({ amount: "12.345" }))[0]?.message).toContain("decimal");
  });

  it("needs at least one person in the split", () => {
    const input = values();
    for (const person of input.people) person.included = false;
    expect(issues(input)).toEqual([{ path: "people", message: "Choose at least one person to split with." }]);
  });

  describe("exact", () => {
    it("uses the amounts as given when they add up", () => {
      const input = values({ splitMethod: "exact" });
      input.people[0]!.exact = "500";
      input.people[1]!.exact = "400";
      input.people[2]!.exact = "";
      const expense = resolved(input);
      expect(expense.shares.map((s) => s.amount)).toEqual([50000, 40000, 0]);
    });

    it("says how much is left or over", () => {
      const input = values({ splitMethod: "exact" });
      input.people[0]!.exact = "500";
      expect(issues(input)[0]?.message).toBe("The amounts add up to ₹500.00. ₹400.00 is left to assign.");
      input.people[1]!.exact = "500";
      expect(issues(input)[0]?.message).toBe("The amounts add up to ₹1,000.00, ₹100.00 more than the total.");
    });

    it("points at the field with a bad amount", () => {
      const input = values({ splitMethod: "exact" });
      input.people[1]!.exact = "abc";
      expect(issues(input)[0]?.path).toBe("people.1.exact");
    });
  });

  describe("percentage", () => {
    it("stores basis points and rounds with the largest remainder method", () => {
      const input = values({ splitMethod: "percentage", amount: "100" });
      input.people[0]!.percent = "33.33";
      input.people[1]!.percent = "33.33";
      input.people[2]!.percent = "33.34";
      const expense = resolved(input);
      expect([...expense.basisPoints.values()]).toEqual([3333, 3333, 3334]);
      expect(expense.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(10000);
    });

    it("must add up to exactly 100%", () => {
      const input = values({ splitMethod: "percentage" });
      input.people[0]!.percent = "50";
      input.people[1]!.percent = "40";
      expect(issues(input)[0]?.message).toBe("The percentages add up to 90%. 10% is left.");
      input.people[2]!.percent = "20";
      expect(issues(input)[0]?.message).toBe("The percentages add up to 110%, more than 100%.");
      input.people[2]!.percent = "10.123";
      expect(issues(input)[0]?.path).toBe("people.2.percent");
    });
  });

  describe("shares", () => {
    it("splits by positive whole weights", () => {
      const input = values({ splitMethod: "shares" });
      input.people[0]!.shares = "2";
      const expense = resolved(input);
      expect(expense.shares.map((s) => s.amount)).toEqual([45000, 22500, 22500]);
      expect(expense.weights.get(A)).toBe(2);
    });

    it("rejects zero or fractional shares", () => {
      const input = values({ splitMethod: "shares" });
      input.people[1]!.shares = "0";
      input.people[2]!.shares = "1.5";
      expect(issues(input).map((i) => i.path)).toEqual(["people.1.shares", "people.2.shares"]);
    });
  });

  describe("itemized", () => {
    it("allocates tax proportionally, a tip equally and a discount, then rounds once to the bill total", () => {
      const input = values({
        splitMethod: "itemized",
        amount: "ignored",
        items: [
          { name: "Pizza", amount: "600", assignees: [A, B] },
          { name: "Salad", amount: "300", assignees: [C] },
        ],
        adjustments: [
          { kind: "tax", amount: "90", allocation: "proportional" },
          { kind: "tip", amount: "30", allocation: "equal" },
          { kind: "discount", amount: "100", allocation: "proportional" },
        ],
      });
      const expense = resolved(input);
      expect(expense.total).toBe(92000);
      expect(expense.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(92000);
      // A and B: 300 + 30 tax + 10 tip − 33.33 discount; C: 300 + 30 + 10 − 33.33.
      expect(expense.shares.map((s) => s.amount)).toEqual([30667, 30667, 30666]);
      expect(expense.items.map((item) => item.kind)).toEqual(["item", "item", "tax", "tip", "discount"]);
    });

    it("explains incomplete items and impossible discounts", () => {
      const input = values({
        splitMethod: "itemized",
        items: [{ name: "", amount: "", assignees: [] }],
      });
      expect(issues(input).map((i) => i.path)).toEqual(["items.0.name", "items.0.amount", "items.0.assignees"]);

      input.items = [{ name: "Tea", amount: "50", assignees: [A] }];
      input.adjustments = [{ kind: "discount", amount: "60", allocation: "proportional" }];
      expect(issues(input)[0]?.message).toBe("Discounts can't be more than the items total.");
    });
  });

  describe("payers", () => {
    it("SPEC §7 multi-payer case: A pays ₹600, B ₹300 → only C owes A ₹300", () => {
      const input = values({ paidBy: MULTIPLE_PAYERS });
      input.people[0]!.paid = "600";
      input.people[1]!.paid = "300";
      const expense = resolved(input);
      expect(expense.payers).toEqual([
        { userId: A, amount: 60000 },
        { userId: B, amount: 30000 },
      ]);
      expect(expense.debts).toEqual([{ debtorId: C, creditorId: A, amount: 30000 }]);
    });

    it("payments must add up to the total, and the shares are still previewed", () => {
      const input = values({ paidBy: MULTIPLE_PAYERS });
      input.people[0]!.paid = "600";
      const result = resolveExpense(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0]).toEqual({
        path: "payers",
        message: "The payments add up to ₹600.00. ₹300.00 is still unpaid.",
      });
      expect(result.shares?.map((s) => s.amount)).toEqual([30000, 30000, 30000]);
    });

    it("a single payer must be one of the people", () => {
      expect(issues(values({ paidBy: "00000000-0000-4000-8000-0000000000ff" }))[0]?.path).toBe("paidBy");
    });

    it("someone can pay without taking part", () => {
      const input = values();
      input.people[0]!.included = false;
      const expense = resolved(input);
      expect(expense.debts.map((d) => [d.debtorId, d.amount])).toEqual([
        [B, 45000],
        [C, 45000],
      ]);
    });
  });

  it("is deterministic", () => {
    expect(resolveExpense(values({ amount: "1000.01" }))).toEqual(resolveExpense(values({ amount: "1000.01" })));
  });
});

describe("buildExpensePayload", () => {
  it("produces the snake_case payload the database validates", () => {
    const input = values({ splitMethod: "percentage", amount: "100" });
    input.people[0]!.percent = "50";
    input.people[1]!.percent = "50";
    input.people[2]!.included = false;
    const payload = buildExpensePayload(resolved(input));
    expect(payload).toEqual({
      p_amount: 10000,
      p_currency: "INR",
      p_split_method: "percentage",
      p_payers: [{ user_id: A, amount: 10000 }],
      p_participants: [
        { user_id: A, amount: 5000, basis_points: 5000, received_rounding_unit: false },
        { user_id: B, amount: 5000, basis_points: 5000, received_rounding_unit: false },
      ],
      p_ledger_entries: [{ debtor_id: B, creditor_id: A, amount: 5000 }],
      p_items: null,
    });
  });

  it("sends items with assignments and adjustments with their allocation", () => {
    const payload = buildExpensePayload(
      resolved(
        values({
          splitMethod: "itemized",
          items: [{ name: "Cake", amount: "300", assignees: [B, A] }],
          adjustments: [{ kind: "service", amount: "30", allocation: "equal" }],
        }),
      ),
    );
    expect(payload.p_items).toEqual([
      {
        name: "Cake",
        kind: "item",
        amount: 30000,
        // Entry order of the people, not the order they were ticked.
        assignments: [
          { user_id: A, weight: 1 },
          { user_id: B, weight: 1 },
        ],
      },
      { name: "service", kind: "service", amount: 3000, allocation: "equal" },
    ]);
  });
});

describe("storedToFormValues", () => {
  it("round-trips a stored version back to the same split", () => {
    const input = values({ paidBy: MULTIPLE_PAYERS, splitMethod: "percentage", amount: "100", category: "food" });
    input.people[0]!.paid = "60";
    input.people[1]!.paid = "40";
    input.people[0]!.percent = "20";
    input.people[1]!.percent = "30";
    input.people[2]!.percent = "50";
    const expense = resolved(input);
    const stored = {
      description: "Dinner",
      amount: expense.total,
      currency: "INR",
      expenseDate: "2026-10-21",
      category: "food",
      notes: null,
      tags: ["goa"],
      splitMethod: "percentage",
      payers: expense.payers,
      participants: expense.shares.map((s) => ({
        userId: s.userId,
        amount: s.amount,
        basisPoints: expense.basisPoints.get(s.userId) ?? null,
        weight: null,
      })),
      items: [],
    };
    const back = storedToFormValues(stored, { splitWith: "group:x", userIds: [A, B, C] });
    expect(back.tags).toBe("goa");
    expect(resolved(back)).toEqual(expense);
  });
});

describe("percent and tags", () => {
  it("parses percentages to basis points without floats", () => {
    expect(parsePercent("33.33")).toBe(3333);
    expect(parsePercent("12.5")).toBe(1250);
    expect(parsePercent("100")).toBe(10000);
    expect(parsePercent("100.01")).toBeNull();
    expect(parsePercent("1.234")).toBeNull();
    expect(parsePercent("-1")).toBeNull();
    expect(formatBasisPoints(3333)).toBe("33.33");
    expect(formatBasisPoints(1250)).toBe("12.5");
    expect(formatBasisPoints(5000)).toBe("50");
  });

  it("splits comma-separated tags", () => {
    expect(parseTags(" goa, beach ,, goa ")).toEqual(["goa", "beach"]);
  });
});
