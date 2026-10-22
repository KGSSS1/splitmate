import "server-only";

import { cookies } from "next/headers";

import { ROUTES, safeNextPath } from "@/lib/auth/routes";

/**
 * Where a new user goes once their email is confirmed and onboarding is done
 * (for example the invitation that brought them here). The confirmation link
 * cannot carry it — the email templates append their own query string — so it
 * is kept in a short-lived cookie in the browser that signed up. Opened in
 * another browser, the user simply lands on the dashboard.
 */
const COOKIE = "splitmate-next";
const MAX_AGE_SECONDS = 24 * 60 * 60;

export async function rememberNextPath(next: string | undefined): Promise<void> {
  const path = safeNextPath(next);
  const store = await cookies();
  if (path === ROUTES.dashboard) {
    store.delete(COOKIE);
    return;
  }
  store.set(COOKIE, path, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** The onboarding URL, carrying the remembered destination (which is then forgotten). */
export async function onboardingUrlWithNext(): Promise<string> {
  const store = await cookies();
  const remembered = store.get(COOKIE)?.value;
  if (!remembered) return ROUTES.onboarding;
  store.delete(COOKIE);
  const path = safeNextPath(remembered);
  return path === ROUTES.dashboard ? ROUTES.onboarding : `${ROUTES.onboarding}?next=${encodeURIComponent(path)}`;
}
