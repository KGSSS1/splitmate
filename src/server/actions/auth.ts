"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authErrorMessage } from "@/lib/auth/errors";
import { ROUTES, safeNextPath } from "@/lib/auth/routes";
import { getClientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  emailLinkSchema,
  passwordResetRequestSchema,
  resendConfirmationSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";
import { type ActionResult, invalidInput } from "@/server/action-result";
import { onboardingUrlWithNext, rememberNextPath } from "@/server/after-auth";
import { requireLiveSession, requireUser } from "@/server/auth";

/** Where email links (confirmation, password reset) land: the token-hash route. */
function emailLinkTarget(): string {
  return new URL(ROUTES.authConfirm, getClientEnv().NEXT_PUBLIC_APP_URL).toString();
}

export async function signUp(input: unknown): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: emailLinkTarget() },
  });
  if (error) return { ok: false, error: authErrorMessage(error.code) };

  // With email confirmation off (not the default) a session exists right away.
  if (data.session) {
    const next = safeNextPath(parsed.data.next);
    redirect(next === ROUTES.dashboard ? ROUTES.onboarding : `${ROUTES.onboarding}?next=${encodeURIComponent(next)}`);
  }
  // Brings the user back to, say, the invitation they signed up from.
  await rememberNextPath(parsed.data.next);
  // For an email that is already registered Supabase answers the same way and
  // sends nothing, so the response does not reveal which emails have accounts.
  redirect(`${ROUTES.checkEmail}?for=signup`);
}

export async function signIn(input: unknown): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // The code lets the form offer "resend confirmation email".
    const code = error.code === "email_not_confirmed" ? error.code : undefined;
    return { ok: false, error: authErrorMessage(error.code), code };
  }

  redirect(safeNextPath(parsed.data.next));
}

export async function resendConfirmation(input: unknown): Promise<ActionResult> {
  const parsed = resendConfirmationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: emailLinkTarget() },
  });
  if (error) return { ok: false, error: authErrorMessage(error.code) };
  return { ok: true, message: "If that account still needs confirming, we've sent a new link." };
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = passwordResetRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: emailLinkTarget(),
  });
  // Only rate limits are worth reporting; anything else would hint whether the
  // email has an account.
  if (error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return { ok: false, error: authErrorMessage(error.code) };
  }
  redirect(`${ROUTES.checkEmail}?for=reset`);
}

export async function updatePassword(input: unknown): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  await requireLiveSession();
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: authErrorMessage(error.code) };

  redirect(`${ROUTES.settings}?updated=password`);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // "local" ends this browser's session only; other devices stay signed in.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    // Supabase Auth couldn't be reached, so the session wasn't cleared. Drop its
    // cookies anyway: logging out must work in this browser (review L26).
    const store = await cookies();
    for (const { name } of store.getAll()) {
      if (name.startsWith("sb-")) store.delete(name);
    }
  }
  redirect(ROUTES.login);
}

const EMAIL_LINK_DESTINATIONS = {
  email: ROUTES.onboarding,
  signup: ROUTES.onboarding,
  recovery: ROUTES.updatePassword,
} as const;

/**
 * Verifies a token-hash email link when its owner presses Continue on
 * /auth/continue (review M9 L3: opening the link alone signs nobody in).
 * Bound to a plain <form>, so it works before JavaScript loads.
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  const link = emailLinkSchema.safeParse({ tokenHash: formData.get("token_hash"), type: formData.get("type") });
  if (!link.success) redirect(`${ROUTES.login}?error=link`);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: link.data.type, token_hash: link.data.tokenHash });
  if (error) redirect(`${ROUTES.login}?error=link`);
  // redirect() keeps the session cookies that verifyOtp just set.
  const destination = EMAIL_LINK_DESTINATIONS[link.data.type];
  redirect(destination === ROUTES.onboarding ? await onboardingUrlWithNext() : destination);
}
