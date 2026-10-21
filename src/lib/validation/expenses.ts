import { z } from "zod";

import { isIdempotencyKey } from "@/lib/accounting/idempotency";
import { parseTags } from "@/lib/expenses/payload";
import { ADJUSTMENT_KINDS, SPLIT_METHODS } from "@/lib/expenses/options";
import { type ExpenseFormValues, involvedUsers, MULTIPLE_PAYERS, resolveExpense } from "@/lib/expenses/resolve";

import { uuidSchema } from "./groups";

const amountText = z.string().max(40, "That amount is too long.");

/** "group:{id}" or "friend:{id}": where the expense belongs. */
export const SPLIT_WITH_PATTERN = /^(group|friend):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseSplitWith(value: string): { kind: "group" | "friend"; id: string } | null {
  const match = SPLIT_WITH_PATTERN.exec(value);
  return match ? { kind: match[1] === "group" ? "group" : "friend", id: (match[2] ?? "").toLowerCase() } : null;
}

/** True for a real calendar date written as YYYY-MM-DD, from 2000 up to a year from now. */
export function isExpenseDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() + 365);
  return value >= "2000-01-01" && date <= latest;
}

const personSchema = z.object({
  userId: uuidSchema,
  included: z.boolean(),
  paid: amountText,
  exact: amountText,
  percent: z.string().max(10),
  shares: z.string().max(10),
});

const baseExpenseSchema = z.object({
  splitWith: z.string().regex(SPLIT_WITH_PATTERN, "Choose a group or a friend."),
  description: z.string().trim().min(1, "Describe the expense.").max(200, "Keep it under 200 characters."),
  amount: amountText,
  currency: z.string().length(3, "Choose a currency."),
  date: z.string().refine(isExpenseDate, { error: "Choose a date from 2000 up to a year from today." }),
  category: z.string().max(40),
  notes: z.string().max(2000, "Keep notes under 2,000 characters."),
  tags: z
    .string()
    .max(1000)
    .refine((value) => parseTags(value).length <= 20, { error: "Use at most 20 tags." })
    .refine((value) => parseTags(value).every((tag) => tag.length <= 40), {
      error: "Keep each tag under 40 characters.",
    }),
  paidBy: z.union([uuidSchema, z.literal(MULTIPLE_PAYERS)], { error: "Choose who paid." }),
  splitMethod: z.enum(SPLIT_METHODS),
  people: z.array(personSchema).min(1).max(100),
  items: z
    .array(
      z.object({
        name: z.string().max(120, "Keep item names under 120 characters."),
        amount: amountText,
        assignees: z.array(uuidSchema).max(100),
      }),
    )
    .max(150, "Use at most 150 items."),
  adjustments: z
    .array(
      z.object({
        kind: z.enum(ADJUSTMENT_KINDS),
        amount: amountText,
        allocation: z.enum(["proportional", "equal"]),
      }),
    )
    .max(20),
});

/**
 * The expense form, validated the same way in the browser and in the Server
 * Action: structure first, then the split itself is resolved with the
 * accounting module and every problem is reported at its field.
 */
export const expenseFormSchema = baseExpenseSchema.superRefine((values, context) => {
  const result = resolveExpense(values as ExpenseFormValues);
  if (!result.ok) {
    for (const issue of result.issues) {
      context.addIssue({ code: "custom", path: issue.path.split("."), message: issue.message });
    }
    return;
  }
  // A direct expense is between exactly the two friends (SPEC §6).
  const where = parseSplitWith(values.splitWith);
  if (where?.kind === "friend" && involvedUsers(result.expense).length !== 2) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "An expense with a friend must involve both of you.",
    });
  }
});

export type ExpenseFormInput = z.input<typeof expenseFormSchema>;

export const createExpenseSchema = z.object({
  idempotencyKey: z.string().refine(isIdempotencyKey, { error: "Reload the page and try again." }),
  values: expenseFormSchema,
});

export const updateExpenseSchema = z.object({
  expenseId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  values: expenseFormSchema,
});

export const cancelExpenseSchema = z.object({
  expenseId: uuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const addCommentSchema = z.object({
  expenseId: uuidSchema,
  body: z.string().trim().min(1, "Write a comment.").max(2000, "Keep comments under 2,000 characters."),
});

export const commentIdSchema = z.object({ commentId: uuidSchema });

export const expensePageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
