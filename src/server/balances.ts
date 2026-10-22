import "server-only";

import type { Balance } from "@/lib/accounting/types";
import { balancesByPerson } from "@/lib/accounting/person-balances";
import { type CounterpartyBalance, type CurrencySummary, summarizeBalances } from "@/lib/accounting/summary";
import { assertMinorAmount } from "@/lib/money/amount";
import type { Transfer } from "@/lib/settlements/simplify";
import { suggestedTransfers } from "@/lib/settlements/suggestions";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf } from "@/server/people";

/** The signed-in user's owed / owing / net totals per currency, from the ledger. */
export async function getBalanceSummary(): Promise<CurrencySummary[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("friend_balances");
  if (error) throw new Error("Could not load your balances.");
  // summarizeBalances rejects amounts outside the safe-integer range (SPEC §7).
  return summarizeBalances(data.map(({ currency, amount }) => ({ currency, amount })));
}

export interface PersonBalance {
  personId: string;
  displayName: string;
  /** Positive = they owe you; one entry per currency, never mixed. */
  balances: CounterpartyBalance[];
}

/** Everyone the viewer has an outstanding balance with (raw pairwise totals), by name. */
export async function listPersonBalances(): Promise<PersonBalance[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("friend_balances");
  if (error) throw new Error("Could not load your balances.");
  const byPerson = balancesByPerson(
    data.map((row) => ({ personId: row.friend_id, currency: row.currency, amount: row.amount })),
  );
  const cards = await getPersonCards(supabase, [...byPerson.keys()]);
  return [...byPerson]
    .map(([personId, balances]) => ({ personId, displayName: nameOf(cards, personId), balances }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface ContextBalance {
  /** null = direct expenses and settlements between the two of you. */
  groupId: string | null;
  groupName: string | null;
  currency: string;
  /** Positive = the friend owes you. */
  amount: number;
}

/** The viewer's raw pairwise balance with one person, per group (or direct) and currency. */
export async function getFriendContextBalances(friendId: string): Promise<ContextBalance[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("friend_group_balances", { p_friend_id: friendId });
  if (error) throw new Error("Could not load your balances.");
  const groupIds = [...new Set(data.flatMap((row) => (row.group_id ? [row.group_id] : [])))];
  const groups = groupIds.length
    ? await supabase.from("groups").select("id, name").in("id", groupIds)
    : { data: [], error: null };
  if (groups.error) throw new Error("Could not load your balances.");
  const names = new Map(groups.data.map((group) => [group.id, group.name]));

  return data.map((row) => {
    assertMinorAmount(row.amount, { allowNegative: true }, "balance");
    return {
      groupId: row.group_id,
      groupName: row.group_id ? (names.get(row.group_id) ?? "A group") : null,
      currency: row.currency,
      amount: row.amount,
    };
  });
}

/**
 * Suggested repayments in a group (SPEC §7): simplified from members' nets
 * when the group's toggle is on, the raw pairwise debts otherwise.
 */
export async function getGroupSuggestions(groupId: string, simplify: boolean): Promise<Transfer[]> {
  await requireUser();
  const supabase = await createClient();
  if (simplify) {
    const { data, error } = await supabase.rpc("group_balances", { p_group_id: groupId });
    if (error) throw new Error("Could not load group balances.");
    const nets: Balance[] = data.map((row) => ({ userId: row.user_id, currency: row.currency, amount: row.amount }));
    return suggestedTransfers({ simplify, nets, pairwise: [] });
  }
  const { data, error } = await supabase.rpc("group_pairwise_balances", { p_group_id: groupId });
  if (error) throw new Error("Could not load group balances.");
  return suggestedTransfers({
    simplify,
    nets: [],
    pairwise: data.map((row) => ({
      debtorId: row.debtor_id,
      creditorId: row.creditor_id,
      currency: row.currency,
      amount: row.amount,
    })),
  });
}
