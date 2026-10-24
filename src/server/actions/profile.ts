"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";
import { completeOnboardingSchema, profileSettingsSchema } from "@/lib/validation/profile";
import { type ActionResult, invalidInput } from "@/server/action-result";
import { requireUser } from "@/server/auth";

const SAVE_FAILED: ActionResult = { ok: false, error: "Couldn't save your profile. Please try again." };

export async function completeOnboarding(input: unknown): Promise<ActionResult> {
  const parsed = completeOnboardingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const user = await requireUser();
  const supabase = await createClient();
  // RLS limits the update to the caller's own, non-deleted row.
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      default_currency: parsed.data.defaultCurrency,
      timezone: parsed.data.timeZone,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id");
  if (error || data.length !== 1) return SAVE_FAILED;

  redirect(safeNextPath(parsed.data.next));
}

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const parsed = profileSettingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      default_currency: parsed.data.defaultCurrency,
      timezone: parsed.data.timeZone,
    })
    .eq("id", user.id)
    .select("id");
  if (error || data.length !== 1) return SAVE_FAILED;

  refresh();
  return { ok: true, message: "Profile saved." };
}
