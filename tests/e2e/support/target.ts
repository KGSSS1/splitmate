import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../src/types/database.types";

/**
 * Where the E2E suite runs.
 *
 * - **Local** (default): Playwright starts `npm run dev`, the app talks to the
 *   local Supabase stack, and confirmation emails are read from Mailpit.
 * - **Remote staging** (`npm run test:e2e:staging`): `E2E_BASE_URL` is the
 *   staging URL, plus the staging project's API URL, publishable key and
 *   secret key, all in `.env.e2e.local` (git-ignored; see docs/deployment.md). Accounts are created
 *   already confirmed through the Auth admin API, so no email is sent, and the
 *   tests that read emails are skipped.
 *
 * Production is refused: these tests create accounts and data.
 */
const STAGING = process.env.E2E_TARGET === "staging";
// Only `npm run test:e2e:staging` reads the staging settings, so a leftover
// .env.e2e.local can never point an ordinary local run at staging.
if (STAGING && existsSync(".env.e2e.local")) process.loadEnvFile(".env.e2e.local");

export const REMOTE_BASE_URL = STAGING ? process.env.E2E_BASE_URL || undefined : undefined;
export const IS_REMOTE = REMOTE_BASE_URL !== undefined;

if (STAGING && !REMOTE_BASE_URL) throw new Error("npm run test:e2e:staging needs E2E_BASE_URL in .env.e2e.local.");
if (REMOTE_BASE_URL) {
  const host = new URL(REMOTE_BASE_URL).hostname;
  if (!/(^|[.-])staging([.-]|$)/.test(host)) {
    throw new Error(`E2E_BASE_URL must be a staging URL (its host must contain "staging"), got ${host}.`);
  }
}

interface RemoteSupabase {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/** The staging project's API settings; throws with a clear message when one is missing. */
export function remoteSupabase(): RemoteSupabase {
  const url = process.env.E2E_SUPABASE_URL ?? "";
  const publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "";
  const secretKey = process.env.E2E_SUPABASE_SECRET_KEY ?? "";
  const missing = [
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) && "E2E_SUPABASE_URL (https://<staging-ref>.supabase.co)",
    !publishableKey.startsWith("sb_publishable_") && "E2E_SUPABASE_PUBLISHABLE_KEY",
    !secretKey.startsWith("sb_secret_") && "E2E_SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Remote E2E needs ${missing.join(", ")} in .env.e2e.local.`);
  return { url, publishableKey, secretKey };
}

/** Secret-key client for creating and removing E2E accounts on staging. */
export function remoteAdmin(): SupabaseClient<Database> {
  const { url, secretKey } = remoteSupabase();
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** E2E accounts are always `e2e-…@example.com`; cleanup only ever touches those. */
export const E2E_EMAIL = /^e2e-[a-z0-9-]+@example\.com$/;
