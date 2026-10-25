"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";
import { DELETE_CONFIRMATION, deleteAccountSchema } from "@/lib/validation/account";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireLiveSession } from "@/server/auth";

/**
 * Deletes the caller's account (SPEC §6, §8). `delete_my_account` does it all
 * in one transaction: it refuses while any balance is open, leaves groups,
 * removes personal data, anonymizes the profile and deletes the auth user (so
 * every session ends). Expenses and the ledger stay for everyone else.
 */
export async function deleteAccount(input: unknown): Promise<ActionResult> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireLiveSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account", { p_confirmation: DELETE_CONFIRMATION });
  if (error) return rpcFailure(error);

  // The session no longer exists on the server; drop this browser's cookies too.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith("sb-")) store.delete(name);
  }
  redirect(ROUTES.accountDeleted);
}
