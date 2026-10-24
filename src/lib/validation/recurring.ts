import { z } from "zod";

import { isIdempotencyKey } from "@/lib/accounting/idempotency";
import { todayIn } from "@/lib/expenses/dates";
import { addDays, FREQUENCIES, MAX_CATCH_UP_DAYS } from "@/lib/recurring/schedule";

import { baseExpenseSchema, refineExpense } from "./expenses";
import { uuidSchema } from "./groups";
import { isValidTimeZone } from "./profile";

/** "Doesn't repeat": the form saves a plain expense. */
export const NO_REPEAT = "never";

export const repeatSchema = z.object({
  frequency: z.enum([NO_REPEAT, ...FREQUENCIES]),
  /** "" for no end date. */
  endDate: z.string().max(10),
  timezone: z.string().max(64),
});

export type RepeatValues = z.input<typeof repeatSchema>;

export function noRepeat(timezone: string): RepeatValues {
  return { frequency: NO_REPEAT, endDate: "", timezone };
}

/** True for a real YYYY-MM-DD calendar date. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type EditorValues = z.output<typeof baseExpenseSchema> & { repeat: z.output<typeof repeatSchema> };

/** Schedule checks for a repeating expense; the date field is its first date. */
function refineRepeat(values: EditorValues, context: z.RefinementCtx): void {
  const { repeat } = values;
  if (repeat.frequency === NO_REPEAT) return;
  if (!isValidTimeZone(repeat.timezone)) {
    context.addIssue({ code: "custom", path: ["repeat", "timezone"], message: "Choose a valid time zone." });
  }
  if (repeat.endDate !== "") {
    if (!isCalendarDate(repeat.endDate) || repeat.endDate > "2100-12-31") {
      context.addIssue({ code: "custom", path: ["repeat", "endDate"], message: "Choose a valid end date." });
    } else if (repeat.endDate < values.date) {
      context.addIssue({
        code: "custom",
        path: ["repeat", "endDate"],
        message: "The end date must be on or after the first date.",
      });
    }
  }
}

/**
 * The add/edit expense form with its "Repeat" section. A plain expense ignores
 * `repeat` (its action's schema strips it).
 */
export const expenseEditorSchema = baseExpenseSchema
  .extend({ repeat: repeatSchema })
  .superRefine((values, context) => {
    refineExpense(values, context);
    refineRepeat(values, context);
  });

export type ExpenseEditorInput = z.input<typeof expenseEditorSchema>;

/** A recurring template: the editor with a real frequency. */
export const recurringFormSchema = expenseEditorSchema.refine((values) => values.repeat.frequency !== NO_REPEAT, {
  error: "Choose how often it repeats.",
  path: ["repeat", "frequency"],
});

/**
 * Why a new template's first date is refused, or null: at most 31 days back
 * (the generator catches those dates up) and a year ahead, in its time zone.
 * Mirrors `private.validate_recurring_schedule`.
 */
export function firstDateProblem(date: string, timezone: string, now: Date = new Date()): string | null {
  if (!isCalendarDate(date)) return "Choose a valid date.";
  const today = todayIn(timezone, now);
  if (date < addDays(today, -MAX_CATCH_UP_DAYS) || date > addDays(today, 365)) {
    return `The first date must be within the last ${MAX_CATCH_UP_DAYS} days or the next year.`;
  }
  return null;
}

export const createRecurringSchema = z.object({
  idempotencyKey: z.string().refine(isIdempotencyKey, { error: "Reload the page and try again." }),
  values: recurringFormSchema,
});

export const updateRecurringSchema = z.object({
  recurringId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  values: recurringFormSchema,
});

export const RECURRING_ACTIONS = ["paused", "active", "cancelled"] as const;

export const recurringStatusSchema = z.object({
  recurringId: uuidSchema,
  status: z.enum(RECURRING_ACTIONS),
});
