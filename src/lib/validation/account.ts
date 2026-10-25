import { z } from "zod";

/** The word to type before deleting an account (also checked by `delete_my_account`). */
export const DELETE_CONFIRMATION = "DELETE";

export const deleteAccountSchema = z.object({
  confirmation: z
    .string()
    .trim()
    .refine((value) => value === DELETE_CONFIRMATION, { error: `Type ${DELETE_CONFIRMATION} to confirm.` }),
});

export type DeleteAccountValues = z.input<typeof deleteAccountSchema>;
