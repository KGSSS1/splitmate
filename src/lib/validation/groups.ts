import { z } from "zod";

import { DEFAULT_INVITE_EXPIRY_DAYS, GROUP_TYPES, INVITE_EXPIRY_DAYS } from "@/lib/groups/options";

import { emailSchema } from "./auth";
import { currencySchema } from "./profile";

export const uuidSchema = z.uuid("Invalid ID.");

export const groupSettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name.").max(100, "Keep the name under 100 characters."),
  description: z.string().trim().max(500, "Keep the description under 500 characters."),
  groupType: z.enum(GROUP_TYPES, { error: "Choose a group type." }),
  defaultCurrency: currencySchema,
  simplifyDebts: z.boolean(),
});

export const createGroupSchema = groupSettingsSchema;

export const updateGroupSchema = groupSettingsSchema.extend({ groupId: uuidSchema });

const expiryDaysSchema = z.coerce
  .number()
  .int()
  .refine((days) => (INVITE_EXPIRY_DAYS as readonly number[]).includes(days), {
    error: "Choose how long the invitation lasts.",
  })
  .default(DEFAULT_INVITE_EXPIRY_DAYS);

/** A shareable link anyone can use, a limited number of times. */
export const createInviteLinkSchema = z.object({
  groupId: uuidSchema,
  expiresInDays: expiryDaysSchema,
});

/** A single-use invitation only the person with this email can accept. */
export const createEmailInviteSchema = z.object({
  groupId: uuidSchema,
  email: emailSchema,
  expiresInDays: expiryDaysSchema,
});

export const invitationIdSchema = z.object({ invitationId: uuidSchema });

/** Tokens are 43 URL-safe base64 characters (256 bits); allow some slack, nothing else. */
export const inviteTokenSchema = z
  .string()
  .min(16, "This invitation link isn't valid.")
  .max(200, "This invitation link isn't valid.")
  .regex(/^[A-Za-z0-9_-]+$/, "This invitation link isn't valid.");

export const acceptInvitationSchema = z.object({
  token: inviteTokenSchema,
  groupId: uuidSchema.optional(),
});

export const groupIdSchema = z.object({ groupId: uuidSchema });

export const memberActionSchema = z.object({ groupId: uuidSchema, userId: uuidSchema });

export const setMemberRoleSchema = memberActionSchema.extend({ role: z.enum(["admin", "member"]) });

export type GroupSettingsInput = z.input<typeof groupSettingsSchema>;
export type CreateEmailInviteInput = z.input<typeof createEmailInviteSchema>;
