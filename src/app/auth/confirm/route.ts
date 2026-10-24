import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { ROUTES } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";
import { onboardingUrlWithNext } from "@/server/after-auth";

/**
 * Landing route for email links. Two link styles arrive here:
 *
 * - `?token_hash=…&type=…` from custom templates (supabase/templates/*.html),
 *   verified on the server, so it works in any browser.
 * - `?code=…` from Supabase's default `{{ .ConfirmationURL }}` templates: the
 *   auth server verifies the email and redirects here with a PKCE code, which
 *   needs the code verifier cookie set in the browser that signed up or asked
 *   for the reset. Opened elsewhere, the email is still confirmed (sign-up)
 *   but no session can be created.
 */
const DESTINATIONS: Partial<Record<EmailOtpType, string>> = {
  email: ROUTES.onboarding,
  signup: ROUTES.onboarding,
  recovery: ROUTES.updatePassword,
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The auth server reports expired or used links as query parameters or in
  // the URL fragment (#error=…), which never reaches the server: such a
  // request has no code or token and falls through to the same message below.
  if (params.get("error") || params.get("error_code")) redirect(`${ROUTES.login}?error=link`);

  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const destination = type ? DESTINATIONS[type] : undefined;
  if (tokenHash && type && destination) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // redirect() keeps the session cookies that verifyOtp just set.
    if (!error) redirect(destination === ROUTES.onboarding ? await onboardingUrlWithNext() : destination);
    redirect(`${ROUTES.login}?error=link`);
  }

  const code = params.get("code");
  if (code) {
    const supabase = await createClient();
    const flowId = params.get("sb_flow_id");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    // auth-js returns redirectType ("recovery" for password resets) at runtime,
    // but its exchangeCodeForSession return type omits it.
    const redirectType = (data as { redirectType?: string | null }).redirectType;
    if (!error) redirect(redirectType === "recovery" ? ROUTES.updatePassword : await onboardingUrlWithNext());
    if (error.code === "pkce_code_verifier_not_found") redirect(`${ROUTES.login}?error=browser`);
  }

  redirect(`${ROUTES.login}?error=link`);
}
