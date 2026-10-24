import { z } from "zod";

import { NOTIFICATION_TYPES } from "@/lib/notifications/types";

import { uuidSchema } from "./groups";

/** Notifications to mark read (the page marks one at a time; the RPC accepts up to 100). */
export const markReadSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(100),
});

/** Every type with its in-app switch; the form always sends them all. */
export const notificationPreferencesSchema = z.object(
  Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, z.boolean()])) as Record<
    (typeof NOTIFICATION_TYPES)[number],
    z.ZodBoolean
  >,
);

export type NotificationPreferencesValues = z.infer<typeof notificationPreferencesSchema>;
