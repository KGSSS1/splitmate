import "server-only";

import { cache } from "react";

import type { Balance } from "@/lib/accounting/types";
import { balancesByPerson } from "@/lib/accounting/person-balances";
import { type CounterpartyBalance, type CurrencySummary, summarizeBalances } from "@/lib/accounting/summary";
import { type ContextBalance, friendContextBalances } from "@/lib/settlements/friend-view";
import type { Transfer } from "@/lib/settlements/simplify";
import { suggestedTransfers } from "@/lib/settlements/suggestions";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The viewer's balance with everyone, per context and currency (SPEC §2, §7):
 * raw pairwise for direct expenses and groups that don't simplify, the group's
 * simplified plan for groups that do. Takes the client so integration tests can
 * run it as any user.
 */
export async function loadContextBalances(supabase: Client, viewerId: string): Promise<ContextBalance[]> {
  const [raw, nets] = await Promise.all([
    supabase.rpc("my_pairwise_balances"),
    supabase.rpc("my_simplified_group_balances"),
  ]);
  if (raw.error || nets.error) throw new Error("Could not load your balances.");
  return friendContextBalances({
    viewerId,
    raw: raw.data.map((row) => ({
      counterpartyId: row.friend_id,
      groupId: row.group_id,
      currency: row.currency,
      amount: row.amount,
      simplified: row.simplified,
    })),
    groupNets: nets.data.map((row) => ({
      groupId: row.group_id,
      userId: row.user_id,
      currency: row.currency,
      amount: row.amount,
    })),
  });
}

/** Memoized per request: the dashboard, friend pages and settle-up all read it. */
export const getMyContextBalances = cache(async (): Promise<ContextBalance[]> => {
  const user = await requireUser();
  return loadContextBalances(await createClient(), user.id);
});

/** Per person, per currency (all contexts added up); positive = they owe the viewer. */
export async function getBalancesByPerson(): Promise<Map<string, CounterpartyBalance[]>> {
  const rows = await getMyContextBalances();
  return balancesByPerson(rows.map(({ counterpartyId, currency, amount }) => ({ personId: counterpartyId, currency, amount })));
}

/** The signed-in user's owed / owing / net totals per currency. */
export async function getBalanceSummary(): Promise<CurrencySummary[]> {
  const byPerson = await getBalancesByPerson();
  // summarizeBalances rejects amounts outside the safe-integer range (SPEC §7).
  return summarizeBalances([...byPerson.values()].flat());
}

export interface PersonBalance {
  personId: string;
  displayName: string;
  /** Positive = they owe you; one entry per currency, never mixed. */
  balances: CounterpartyBalance[];
}

/** Everyone the viewer has an outstanding balance with, by name. */
export async function listPersonBalances(): Promise<PersonBalance[]> {
  const byPerson = await getBalancesByPerson();
  const cards = await getPersonCards(await createClient(), [...byPerson.keys()]);
  return [...byPerson]
    .map(([personId, balances]) => ({ personId, displayName: nameOf(cards, personId), balances }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface NamedContextBalance extends ContextBalance {
  groupName: string | null;
}

/** The viewer's balance with one person, per group (or direct) and currency, with group names. */
export async function getFriendContextBalances(friendId: string): Promise<NamedContextBalance[]> {
  const rows = (await getMyContextBalances()).filter((row) => row.counterpartyId === friendId);
  const groupIds = [...new Set(rows.flatMap((row) => (row.groupId ? [row.groupId] : [])))];
  const groups = groupIds.length
    ? await (await createClient()).from("groups").select("id, name").in("id", groupIds)
    : { data: [], error: null };
  if (groups.error) throw new Error("Could not load your balances.");
  const names = new Map(groups.data.map((group) => [group.id, group.name]));
  return rows.map((row) => ({
    ...row,
    groupName: row.groupId ? (names.get(row.groupId) ?? "A group") : null,
  }));
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
