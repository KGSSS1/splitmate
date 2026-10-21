import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const NO_SESSION_STORAGE = { auth: { persistSession: false, autoRefreshToken: false } };

/** Secret-key client for test setup and cleanup only (bypasses RLS). */
export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(url(), process.env.SUPABASE_SECRET_KEY ?? "", NO_SESSION_STORAGE);
}

/** A client acting as nobody yet, like the browser before login. */
export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(url(), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", NO_SESSION_STORAGE);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Creates a synthetic user. `confirmed: false` leaves the email unverified. */
export async function createTestUser(
  admin: SupabaseClient<Database>,
  { confirmed = true, displayName }: { confirmed?: boolean; displayName?: string } = {},
): Promise<TestUser> {
  const email = `it-${randomUUID()}@Example.com`;
  const password = `it-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: confirmed,
    user_metadata: displayName === undefined ? {} : { display_name: displayName },
  });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

/** A client signed in as `user`. */
export async function signedInClient(user: TestUser): Promise<SupabaseClient<Database>> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

/** Removes test users and their profiles (profiles deliberately have no FK to auth.users). */
export async function deleteTestUsers(admin: SupabaseClient<Database>, users: readonly TestUser[]) {
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id);
    await admin.from("profiles").delete().eq("id", user.id);
  }
}
