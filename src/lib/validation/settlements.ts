import { z } from "zod";

import { isIdempotencyKey } from "@/lib/accounting/idempotency";
import { MONEY_ERRORS } from "@/lib/expenses/resolve";
import { parseMoney } from "@/lib/money/parse";
import { SETTLEMENT_DIRECTIONS, SETTLEMENT_METHODS } from "@/lib/settlements/options";

import { uuidSchema } from "./groups";
import { currencySchema } from "./profile";

const idempotencyKeySchema = z.string().refine(isIdempotencyKey, { error: "Reload the page and try again." });

/** True for a real calendar date (YYYY-MM-DD) from 2000 up to tomorrow (time zones differ by a day at most). */
export function isSettlementDate(value: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const latest = new Date(now);
  latest.setUTCDate(latest.getUTCDate() + 1);
  return value >= "2000-01-01" && value <= latest.toISOString().slice(0, 10);
}

const detailsSchema = z.object({
  method: z.enum(SETTLEMENT_METHODS, { error: "Choose how it was paid." }),
  upiReference: z
    .string()
    .trim()
    .max(64, "Keep the UPI reference under 64 characters.")
    .regex(/^[A-Za-z0-9 ._/-]*$/, "Use letters, numbers, spaces, dots, dashes or slashes."),
  note: z.string().trim().max(500, "Keep the note under 500 characters."),
});

/**
 * One repayment between the viewer and `personId`, in a group or directly
 * between friends. `direction` is from the viewer's side: "paid" = the viewer
 * paid them, "received" = they paid the viewer.
 */
export const settleUpFormSchema = detailsSchema
  .extend({
    personId: uuidSchema.or(z.literal("")),
    direction: z.enum(SETTLEMENT_DIRECTIONS, { error: "Choose who paid." }),
    amount: z.string().max(40, "That amount is too long."),
    currency: currencySchema,
    settledOn: z.string().refine((value) => isSettlementDate(value), { error: "Choose a date up to today." }),
  })
  .superRefine((values, context) => {
    if (!values.personId) {
      context.addIssue({ code: "custom", path: ["personId"], message: "Choose who you settled up with." });
    }
    const amount = parseMoney(values.amount, values.currency);
    if (!amount.ok) {
      context.addIssue({ code: "custom", path: ["amount"], message: MONEY_ERRORS[amount.error] });
    } else if (amount.value === 0) {
      context.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount above zero." });
    }
  });

export type SettleUpFormValues = z.input<typeof settleUpFormSchema>;

/** `group` set = a group settlement; otherwise `personId` must be a friend (direct). */
export const createSettlementSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  groupId: uuidSchema.nullable(),
  values: settleUpFormSchema,
});

export const settleUpEverythingSchema = detailsSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  friendId: uuidSchema,
});

export type SettleUpEverythingInput = z.input<typeof settleUpEverythingSchema>;

export const settlementIdSchema = z.object({ settlementId: uuidSchema });

export const settlementPageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
