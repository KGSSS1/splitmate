import { describe, expect, it } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { createExpenseSchema } from "@/lib/validation/expenses";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const GROUP = "44444444-4444-4444-8444-444444444444";
const KEY = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const values = (userIds: string[]) => ({
  ...blankExpenseValues({ splitWith: `group:${GROUP}`, userIds, paidBy: A, currency: "INR", date: "2026-10-20" }),
  description: "Dinner",
  amount: "100",
});

describe("createExpenseSchema", () => {
  // Review L3: a crafted payload listing someone twice used to make the accounting
  // module throw inside the Server Action instead of returning a validation error.
  it("reports a person listed twice as a field error instead of throwing", () => {
    const result = createExpenseSchema.safeParse({ idempotencyKey: KEY, values: values([A, B, B]) });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ["values", "people"], message: "Each person can appear only once." }),
    );
  });

  it("reports an item assigned to the same person twice", () => {
    const itemized = {
      ...values([A, B]),
      splitMethod: "itemized" as const,
      items: [{ name: "Pizza", amount: "100", assignees: [A, A] }],
    };
    const result = createExpenseSchema.safeParse({ idempotencyKey: KEY, values: itemized });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["values", "items", 0] }));
  });

  it("accepts each person once", () => {
    expect(createExpenseSchema.safeParse({ idempotencyKey: KEY, values: values([A, B]) }).success).toBe(true);
  });
});
