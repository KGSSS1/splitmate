"use server";

import { refresh } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { markReadSchema, notificationPreferencesSchema } from "@/lib/validation/notifications";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireUser } from "@/server/auth";

/**
 * Marks some of the caller's notifications read (others' IDs are ignored by the
 * RPC and RLS). No refresh: it also runs as the viewer follows a notification's
 * link, and the list updates its own rows.
 */
export async function markNotificationsRead(input: unknown): Promise<ActionResult> {
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: parsed.data.ids });
  if (error) return rpcFailure(error);
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", {});
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "All notifications marked as read." };
}

/** Saves which notification types the caller wants in the app. */
export async function saveNotificationPreferences(input: unknown): Promise<ActionResult> {
  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_preferences", { p_preferences: parsed.data });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "Notification settings saved." };
}
