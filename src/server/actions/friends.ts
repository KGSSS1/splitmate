"use server";

import { refresh } from "next/cache";

import { describeFriendRequest } from "@/lib/friends/request-outcome";
import { createClient } from "@/lib/supabase/server";
import { addFriendSchema, friendshipIdSchema, sentRequestIdSchema } from "@/lib/validation/friends";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireUser } from "@/server/auth";
import { getPersonCards } from "@/server/people";

/**
 * Sends a friend request to exactly this email (SPEC §2). The reply is the same
 * whether or not the address has an account (review L8).
 */
export async function addFriend(input: unknown): Promise<ActionResult> {
  const parsed = addFriendSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_friend_request", { p_email: parsed.data.email });
  if (error) return rpcFailure(error);

  const row = data[0];
  if (!row) return rpcFailure({});
  const cards = row.friend_id ? await getPersonCards(supabase, [row.friend_id]) : new Map();
  const outcome = describeFriendRequest(row.status, row.friend_id ? (cards.get(row.friend_id)?.displayName ?? null) : null);
  if (!outcome.ok) return { ok: false, error: outcome.message, fieldErrors: { email: outcome.message } };

  refresh();
  return { ok: true, message: outcome.message };
}

export async function acceptFriendRequest(input: unknown): Promise<ActionResult> {
  const parsed = friendshipIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_friend_request", { p_friendship_id: parsed.data.friendshipId });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "Friend request accepted." };
}

/** Withdraws a request you sent, from your list of sent requests. */
export async function withdrawFriendRequest(input: unknown): Promise<ActionResult> {
  const parsed = sentRequestIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_friend_request", { p_request_id: parsed.data.requestId });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true };
}

/** Declines a request you received, or withdraws one you sent. */
export async function deleteFriendRequest(input: unknown): Promise<ActionResult> {
  const parsed = friendshipIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_friend_request", { p_friendship_id: parsed.data.friendshipId });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true };
}
