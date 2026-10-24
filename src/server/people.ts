import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface PersonCard {
  id: string;
  displayName: string;
}

/** `profile_cards` accepts at most this many IDs per call. */
const CARD_BATCH = 200;

/**
 * Public names of people the caller shares a group or friendship with, keyed
 * by ID. Anyone the database does not reveal is simply missing from the map.
 */
export async function getPersonCards(supabase: Client, ids: readonly string[]): Promise<Map<string, PersonCard>> {
  const unique = [...new Set(ids)];
  const cards = new Map<string, PersonCard>();
  for (let start = 0; start < unique.length; start += CARD_BATCH) {
    const { data, error } = await supabase.rpc("profile_cards", {
      p_user_ids: unique.slice(start, start + CARD_BATCH),
    });
    if (error) throw new Error("Could not load people.");
    for (const card of data) cards.set(card.id, { id: card.id, displayName: card.display_name });
  }
  return cards;
}

/**
 * Names of groups the caller is or was in: the live name for current members,
 * the name when they left for former members (SPEC §8: only current members
 * read the group itself; review L9). Unknown groups are missing from the map.
 */
export async function getGroupNames(supabase: Client, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, string>();
  for (let start = 0; start < unique.length; start += CARD_BATCH) {
    const { data, error } = await supabase.rpc("group_names", { p_group_ids: unique.slice(start, start + CARD_BATCH) });
    if (error) throw new Error("Could not load groups.");
    for (const row of data) names.set(row.id, row.name);
  }
  return names;
}

/** The name to show for someone, even if their card could not be loaded. */
export function nameOf(cards: Map<string, PersonCard>, id: string): string {
  return cards.get(id)?.displayName ?? "Unknown member";
}
