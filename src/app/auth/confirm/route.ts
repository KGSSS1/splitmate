import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { ROUTES } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing route for email links (supabase/templates/*.html). Verifying the
 * token hash on the server works even when the link is opened in a different
 * browser from the one that signed up, unlike the PKCE code exchange.
 */
const DESTINATIONS: Partial<Record<EmailOtpType, string>> = {
  email: ROUTES.onboarding,
  signup: ROUTES.onboarding,
  recovery: ROUTES.updatePassword,
};

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const destination = type ? DESTINATIONS[type] : undefined;

  if (tokenHash && type && destination) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // redirect() keeps the session cookies that verifyOtp just set.
    if (!error) redirect(destination);
  }

  redirect(`${ROUTES.login}?error=link`);
}
