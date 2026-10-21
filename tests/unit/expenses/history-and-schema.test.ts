import { describe, expect, it } from "vitest";

import { formatExpenseDate, todayIn } from "@/lib/expenses/dates";
import { blankExpenseValues } from "@/lib/expenses/form-values";
import { describeChanges, parseSnapshot } from "@/lib/expenses/history";
import { createExpenseSchema, expenseFormSchema, isExpenseDate, parseSplitWith } from "@/lib/validation/expenses";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const names: Record<string, string> = { [A]: "Asha", [B]: "Bina" };
const nameOf = (id: string) => names[id] ?? "?";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  status: "active",
  description: "Dinner",
  amount: 90000,
  currency: "INR",
  expense_date: "2026-10-21",
  split_method: "equal",
  category: "food",
  payers: [{ user_id: A, amount: 90000 }],
  participants: [
    { user_id: A, amount: 45000 },
    { user_id: B, amount: 45000 },
  ],
  ...overrides,
});

describe("expense history", () => {
  it("lists what changed with before and after amounts", () => {
    const before = parseSnapshot(snapshot());
    const after = parseSnapshot(
      snapshot({
        version: 2,
        amount: 120000,
        split_method: "percentage",
        participants: [
          { user_id: A, amount: 30000 },
          { user_id: B, amount: 90000 },
        ],
        payers: [{ user_id: A, amount: 120000 }],
      }),
    );
    expect(before && after && describeChanges(before, after, nameOf)).toEqual([
      { label: "Amount", before: "₹900.00", after: "₹1,200.00" },
      { label: "Split", before: "Equally", after: "Percentages" },
      { label: "Paid by", before: "Asha ₹900.00", after: "Asha ₹1,200.00" },
      { label: "Shares", before: "Asha ₹450.00, Bina ₹450.00", after: "Asha ₹300.00, Bina ₹900.00" },
    ]);
  });

  it("reports nothing for an unchanged save", () => {
    const same = parseSnapshot(snapshot());
    expect(same && describeChanges(same, same, nameOf)).toEqual([]);
  });

  it("ignores malformed audit JSON instead of crashing", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ description: "x", amount: "900", currency: "INR" })).toBeNull();
    expect(parseSnapshot(snapshot({ currency: "XXX" }))).toBeNull();
    expect(parseSnapshot(snapshot({ payers: [{ user_id: A, amount: 1.5 }] }))?.payers).toEqual([]);
  });
});

describe("dates", () => {
  it("uses the user's time zone for today", () => {
    const instant = new Date("2026-10-21T20:00:00Z");
    expect(todayIn("Asia/Kolkata", instant)).toBe("2026-10-22");
    expect(todayIn("America/New_York", instant)).toBe("2026-10-21");
    expect(todayIn("Not/AZone", instant)).toBe("2026-10-21");
  });

  it("formats a calendar date without shifting it", () => {
    expect(formatExpenseDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("accepts real dates from 2000 up to a year ahead", () => {
    expect(isExpenseDate("2026-02-28")).toBe(true);
    expect(isExpenseDate("2026-02-30")).toBe(false);
    expect(isExpenseDate("1999-12-31")).toBe(false);
    expect(isExpenseDate("2999-01-01")).toBe(false);
    expect(isExpenseDate("21/10/2026")).toBe(false);
  });
});

describe("expenseFormSchema", () => {
  const base = (splitWith: string) => ({
    ...blankExpenseValues({ splitWith, userIds: [A, B], paidBy: A, currency: "INR", date: "2026-10-21" }),
    description: "Taxi",
    amount: "500",
  });

  it("parses where the expense goes", () => {
    expect(parseSplitWith(`group:${A}`)).toEqual({ kind: "group", id: A });
    expect(parseSplitWith(`friend:${B.toUpperCase()}`)).toEqual({ kind: "friend", id: B });
    expect(parseSplitWith("group:nope")).toBeNull();
  });

  it("accepts a valid expense", () => {
    expect(expenseFormSchema.safeParse(base(`friend:${B}`)).success).toBe(true);
  });

  it("requires a direct expense to involve both friends", () => {
    const values = base(`friend:${B}`);
    values.people[1]!.included = false; // only Asha in the split, and Asha paid
    const result = expenseFormSchema.safeParse(values);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["people"],
      message: "An expense with a friend must involve both of you.",
    });
  });

  it("reports split problems at their fields", () => {
    const values = { ...base(`group:${A}`), splitMethod: "exact" as const };
    values.people[0]!.exact = "1.234";
    const result = expenseFormSchema.safeParse(values);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["people.0.exact"]);
  });

  it("limits tags and text lengths", () => {
    expect(expenseFormSchema.safeParse({ ...base(`group:${A}`), tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(",") }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...base(`group:${A}`), description: "  " }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...base(`group:${A}`), date: "2026-13-01" }).success).toBe(false);
  });

  it("needs a v4 idempotency key to create", () => {
    const values = base(`group:${A}`);
    expect(createExpenseSchema.safeParse({ idempotencyKey: "not-a-key", values }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ idempotencyKey: crypto.randomUUID(), values }).success).toBe(true);
  });
});
