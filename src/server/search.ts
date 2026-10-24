import "server-only";

import { EXPENSES_PAGE_SIZE } from "@/lib/expenses/options";
import { matchesTerms, matchingCategories, searchTerms } from "@/lib/search/match";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { type ExpenseListItem, toListItems } from "@/server/expenses";
import { getGroupNames, getPersonCards, nameOf } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface GroupHit {
  id: string;
  name: string;
  /** The viewer has left it: they can still see their history there. */
  former: boolean;
}

export interface FriendHit {
  id: string;
  displayName: string;
}

export interface ExpenseHit extends ExpenseListItem {
  groupName: string | null;
}

export interface SearchResults {
  friends: FriendHit[];
  groups: GroupHit[];
  expenses: ExpenseHit[];
  expenseTotal: number;
  page: number;
  pageCount: number;
}

/**
 * Friends, groups and expenses matching every word of `query`, limited to what
 * the viewer can access: their own friendships and memberships, and expenses
 * through RLS (`search_expenses` is SECURITY INVOKER). Takes the client so
 * integration tests can run it as any user.
 */
export async function loadSearch(supabase: Client, viewerId: string, query: string, page: number): Promise<SearchResults> {
  const terms = searchTerms(query);
  const [friendships, memberships, expenses] = await Promise.all([
    supabase.from("friendships").select("user_low, user_high").eq("status", "accepted"),
    supabase.from("group_members").select("group_id, left_at").eq("user_id", viewerId),
    supabase.rpc("search_expenses", {
      p_query: query,
      p_categories: matchingCategories(terms),
      p_limit: EXPENSES_PAGE_SIZE,
      p_offset: (page - 1) * EXPENSES_PAGE_SIZE,
    }),
  ]);
  if (friendships.error || memberships.error || expenses.error) throw new Error("Could not search.");

  const friendIds = friendships.data.map((row) => (row.user_low === viewerId ? row.user_high : row.user_low));
  const expenseGroupIds = expenses.data.flatMap((row) => (row.group_id ? [row.group_id] : []));
  // A member may have joined, left and rejoined: the current membership wins.
  const current = new Map<string, boolean>();
  for (const row of memberships.data) current.set(row.group_id, (current.get(row.group_id) ?? false) || row.left_at === null);

  const [cards, groupNames, items] = await Promise.all([
    getPersonCards(supabase, friendIds),
    getGroupNames(supabase, [...current.keys(), ...expenseGroupIds]),
    toListItems(supabase, viewerId, expenses.data),
  ]);

  const total = expenses.data[0]?.total_count ?? 0;
  const groupOf = new Map(expenses.data.map((row) => [row.id, row.group_id ?? null]));
  return {
    friends: friendIds
      .map((id) => ({ id, displayName: nameOf(cards, id) }))
      .filter((friend) => matchesTerms(terms, friend.displayName))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    groups: [...current]
      .flatMap(([id, isCurrent]) => {
        const name = groupNames.get(id);
        return name && matchesTerms(terms, name) ? [{ id, name, former: !isCurrent }] : [];
      })
      .sort((a, b) => Number(a.former) - Number(b.former) || a.name.localeCompare(b.name)),
    expenses: items.map((item) => {
      const groupId = groupOf.get(item.id) ?? null;
      return { ...item, groupName: groupId ? (groupNames.get(groupId) ?? null) : null };
    }),
    expenseTotal: total,
    page,
    pageCount: Math.max(1, Math.ceil(total / EXPENSES_PAGE_SIZE)),
  };
}

export async function search(query: string, page = 1): Promise<SearchResults> {
  const user = await requireUser();
  return loadSearch(await createClient(), user.id, query, page);
}
