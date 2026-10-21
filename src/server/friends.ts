import "server-only";

import { balancesByPerson } from "@/lib/accounting/person-balances";
import type { CounterpartyBalance } from "@/lib/accounting/summary";
import { type GroupType, toGroupType } from "@/lib/groups/options";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf } from "@/server/people";

export interface Friend {
  id: string;
  displayName: string;
  /** Per currency, from the ledger; positive = they owe you. Empty = settled up. */
  balances: CounterpartyBalance[];
}

export interface FriendRequest {
  friendshipId: string;
  userId: string;
  displayName: string;
  createdAt: string;
}

export interface FriendsOverview {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

/** The caller's balance with each friend, keyed by friend ID (SPEC §2: across groups and direct expenses). */
async function getFriendBalances(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("friend_balances");
  if (error) throw new Error("Could not load your balances.");
  return balancesByPerson(data.map((row) => ({ personId: row.friend_id, currency: row.currency, amount: row.amount })));
}

export async function getFriendsOverview(): Promise<FriendsOverview> {
  const user = await requireUser();
  const supabase = await createClient();

  // RLS: only friendships the caller is part of.
  const { data: rows, error } = await supabase
    .from("friendships")
    .select("id, user_low, user_high, requested_by, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load your friends.");

  const otherId = (row: { user_low: string; user_high: string }) =>
    row.user_low === user.id ? row.user_high : row.user_low;
  const [cards, balances] = await Promise.all([
    getPersonCards(supabase, rows.map(otherId)),
    getFriendBalances(supabase),
  ]);

  const overview: FriendsOverview = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const id = otherId(row);
    const displayName = nameOf(cards, id);
    if (row.status === "accepted") {
      overview.friends.push({ id, displayName, balances: balances.get(id) ?? [] });
    } else {
      const request = { friendshipId: row.id, userId: id, displayName, createdAt: row.created_at };
      (row.requested_by === user.id ? overview.outgoing : overview.incoming).push(request);
    }
  }
  overview.friends.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return overview;
}

export interface FriendDetail extends Friend {
  since: string | null;
  sharedGroups: { id: string; name: string; groupType: GroupType }[];
}

/** A friend of the caller, or null if they are not (accepted) friends. */
export async function getFriend(friendId: string): Promise<FriendDetail | null> {
  const user = await requireUser();
  if (friendId === user.id) return null;
  const supabase = await createClient();

  const { data: friendship, error } = await supabase
    .from("friendships")
    .select("accepted_at")
    .eq("user_low", user.id < friendId ? user.id : friendId)
    .eq("user_high", user.id < friendId ? friendId : user.id)
    .eq("status", "accepted")
    .maybeSingle();
  if (error) throw new Error("Could not load this friend.");
  if (!friendship) return null;

  // RLS shows other people's memberships only in groups the caller is currently in.
  const [cards, balances, shared] = await Promise.all([
    getPersonCards(supabase, [friendId]),
    getFriendBalances(supabase),
    supabase
      .from("group_members")
      .select("groups!group_members_group_id_fkey(id, name, group_type)")
      .eq("user_id", friendId)
      .is("left_at", null),
  ]);
  if (shared.error) throw new Error("Could not load shared groups.");

  return {
    id: friendId,
    displayName: nameOf(cards, friendId),
    balances: balances.get(friendId) ?? [],
    since: friendship.accepted_at,
    sharedGroups: shared.data
      .flatMap((row) => (row.groups ? [row.groups] : []))
      .map((group) => ({ id: group.id, name: group.name, groupType: toGroupType(group.group_type) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
