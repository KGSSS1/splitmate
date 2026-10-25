import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../src/types/database.types";

import type { Account } from "./accounts";
import { IS_REMOTE, remoteSupabase } from "./target";

// Same variables as `npm run dev` (the app Playwright starts reads .env.local too).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * A Supabase client signed in as `account`, talking to the API directly the
 * way a curious user could from the browser console: only the publishable key
 * and their own session, so RLS and function checks are all that stand in the way.
 */
export async function apiClientFor(account: Account): Promise<SupabaseClient<Database>> {
  const remote = IS_REMOTE ? remoteSupabase() : null;
  const url = remote?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!remote && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`E2E API calls only run against local Supabase; NEXT_PUBLIC_SUPABASE_URL is "${url}".`);
  }
  const client = createClient<Database>(url, remote?.publishableKey ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword(account);
  if (error) throw error;
  return client;
}
