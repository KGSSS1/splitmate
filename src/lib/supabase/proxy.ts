import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getRouteAccess, ROUTES } from "@/lib/auth/routes";
import { getClientEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

import { SESSION_COOKIE_OPTIONS } from "./cookie-options";

/**
 * Refreshes the Supabase session on every matched request and redirects by
 * route access (SPEC §8). The redirects are a convenience only: pages and
 * Server Actions verify identity again through src/server/auth.ts.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getClientEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Refreshed tokens go to Server Components (request) and the browser (response).
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-Control/Expires/Pragma so no CDN caches a response carrying a session.
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(): it refreshes
  // the session, and anything in between can cause random logouts.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);

  const { pathname, search } = request.nextUrl;
  const access = getRouteAccess(pathname);

  if (access === "protected" && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.login;
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return redirectKeepingSession(response, url);
  }

  if (access === "guest" && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.dashboard;
    url.search = "";
    return redirectKeepingSession(response, url);
  }

  return response;
}

/** A redirect that still carries any refreshed session cookies and cache headers. */
function redirectKeepingSession(from: NextResponse, url: URL): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(key);
    if (value) redirect.headers.set(key, value);
  }
  return redirect;
}
