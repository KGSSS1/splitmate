import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { ROUTES } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

/**
 * Data access layer for identity (SPEC §8). Identity always comes from
 * `getClaims()`, which verifies the JWT — never from `getSession()` alone.
 * Each helper is memoized per request with React `cache`.
 */

export interface SessionUser {
  id: string;
  email: string | null;
}

export type Profile = Pick<
  Tables<"profiles">,
  "id" | "email" | "display_name" | "default_currency" | "timezone" | "onboarded_at"
>;

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const { sub, email } = data.claims;
  if (!sub) return null;
  return { id: sub, email: typeof email === "string" ? email : null };
});

/** The signed-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(ROUTES.login);
  return user;
}

/** The signed-in user's own profile (RLS: own row only). */
export const getProfile = cache(async (): Promise<Profile> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, default_currency, timezone, onboarded_at, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error("Could not load your profile.");
  // A deleted (anonymized) account has no profile to show; end the session.
  if (!data || data.deleted_at) redirect(ROUTES.login);

  return {
    id: data.id,
    email: data.email,
    display_name: data.display_name,
    default_currency: data.default_currency,
    timezone: data.timezone,
    onboarded_at: data.onboarded_at,
  };
});

/** The profile of a user who finished onboarding, or a redirect to onboarding. */
export async function requireOnboardedProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile.onboarded_at) redirect(ROUTES.onboarding);
  return profile;
}
