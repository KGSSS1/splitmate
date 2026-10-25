import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { ROUTES } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";
import { emailLinkSchema } from "@/lib/validation/auth";
import { onboardingUrlWithNext } from "@/server/after-auth";

/**
 * Landing route for email links. Two link styles arrive here:
 *
 * - `?token_hash=…&type=…` from custom templates (supabase/templates/*.html).
 *   Opening the link uses nothing: it shows /auth/continue, whose button
 *   verifies the token (POST). So a mail scanner that fetches links can't use
 *   it up, and a link someone else sends you can't sign you into their
 *   account without a click (review M9 L3).
 * - `?code=…` from Supabase's default `{{ .ConfirmationURL }}` templates: the
 *   auth server verifies the email and redirects here with a PKCE code, which
 *   needs the code verifier cookie set in the browser that signed up or asked
 *   for the reset. Opened elsewhere, the email is still confirmed (sign-up)
 *   but no session can be created.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The auth server reports expired or used links as query parameters or in
  // the URL fragment (#error=…), which never reaches the server: such a
  // request has no code or token and falls through to the same message below.
  if (params.get("error") || params.get("error_code")) redirect(`${ROUTES.login}?error=link`);

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash || type) {
    const link = emailLinkSchema.safeParse({ tokenHash, type });
    if (!link.success) redirect(`${ROUTES.login}?error=link`);
    const next = new URLSearchParams({ token_hash: link.data.tokenHash, type: link.data.type });
    redirect(`${ROUTES.authContinue}?${next.toString()}`);
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
