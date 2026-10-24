import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for every Supabase session cookie (review L13). Nothing in the browser
 * reads the session (there is no browser Supabase client), so the cookies are
 * HttpOnly: an injected script can't steal the refresh token. Secure in
 * production builds (HTTPS); local development runs on http://localhost.
 */
export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};
