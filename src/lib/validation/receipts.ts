import { z } from "zod";

import { MAX_RECEIPT_BYTES, RECEIPT_TYPES } from "@/lib/receipts/files";

import { uuidSchema } from "./groups";

/** `{expense_id}/{uuid}.{ext}`: the only paths this app writes in the receipts bucket. */
export const RECEIPT_PATH_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

export const prepareReceiptSchema = z.object({
  expenseId: uuidSchema,
  /** What the browser found in the file's first bytes; checked again after upload. */
  type: z.enum(RECEIPT_TYPES),
  size: z.number().int().min(1).max(MAX_RECEIPT_BYTES, "Receipts can be at most 5 MB."),
});

export const attachReceiptSchema = z
  .object({
    expenseId: uuidSchema,
    path: z.string().regex(RECEIPT_PATH_PATTERN),
    fileName: z.string().max(500),
  })
  .refine((value) => value.path.startsWith(`${value.expenseId}/`), { error: "That upload is for another expense." });

export const receiptIdSchema = z.object({ attachmentId: uuidSchema });
