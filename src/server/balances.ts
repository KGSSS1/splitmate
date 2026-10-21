import "server-only";

import { type CurrencySummary, summarizeBalances } from "@/lib/accounting/summary";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";

/** The signed-in user's owed / owing / net totals per currency, from the ledger. */
export async function getBalanceSummary(): Promise<CurrencySummary[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("friend_balances");
  if (error) throw new Error("Could not load your balances.");
  // summarizeBalances rejects amounts outside the safe-integer range (SPEC §7).
  return summarizeBalances(data.map(({ currency, amount }) => ({ currency, amount })));
}
