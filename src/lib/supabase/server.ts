import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { getClientEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting as the signed-in user (publishable key + session cookies, so RLS
 * applies). Create one per request; never share it.
 */
export async function createClient() {
  // Auth checks token expiry against the clock, so with Cache Components the
  // client may only run at request time, never during prerendering.
  await connection();
  const cookieStore = await cookies();
  const env = getClientEnv();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. src/proxy.ts refreshes the
          // session before rendering, so nothing is lost here.
        }
      },
    },
  });
}
