"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { parseMoney } from "@/lib/money/parse";
import { settleableWith } from "@/lib/settlements/friend-view";
import { createClient } from "@/lib/supabase/server";
import {
  createSettlementSchema,
  settlementIdSchema,
  settleUpEverythingSchema,
} from "@/lib/validation/settlements";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireLiveSession, requireOnboardedProfile } from "@/server/auth";
import { getMyContextBalances } from "@/server/balances";
import { getFriend } from "@/server/friends";
import { pendingContextKeysWith } from "@/server/settlements";

const SETTLEMENTS = "/settlements";

/**
 * Records one repayment between the caller and another person. The database
 * decides the status: completed when the caller received the money, pending
 * (until the receiver confirms) when the caller paid (SPEC §2).
 */
export async function createSettlement(input: unknown): Promise<ActionResult> {
  const parsed = createSettlementSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { idempotencyKey, groupId, values } = parsed.data;
  const amount = parseMoney(values.amount, values.currency);
  if (!amount.ok) return { ok: false, error: "Check the amount." };

  const profile = await requireOnboardedProfile();
  if (values.personId === profile.id) return { ok: false, error: "Choose someone other than yourself." };
  const [payerId, receiverId] =
    values.direction === "paid" ? [profile.id, values.personId] : [values.personId, profile.id];

  const supabase = await createClient();
  const { data: settlementId, error } = await supabase.rpc("create_settlement", {
    p_idempotency_key: idempotencyKey,
    // A direct settlement has no group; the generated type does not allow null here.
    p_group_id: groupId ?? (null as unknown as string),
    p_payer_id: payerId,
    p_receiver_id: receiverId,
    p_amount: amount.value,
    p_currency: values.currency,
    p_method: values.method,
    // The reference only means something for UPI payments.
    ...(values.method === "upi" && values.upiReference ? { p_upi_reference: values.upiReference } : {}),
    ...(values.note ? { p_note: values.note } : {}),
    p_settled_on: values.settledOn,
  });
  if (error) return rpcFailure(error);

  redirect(`${SETTLEMENTS}/${settlementId}?saved=${values.direction}`);
}

/**
 * One settlement per group and currency with a friend, in one transaction
 * (SPEC §11): raw pairwise amounts for direct and non-simplifying groups, the
 * simplified plan for groups that simplify. The key comes from the form, so a
 * retry records nothing twice.
 */
export async function settleUpEverything(input: unknown): Promise<ActionResult> {
  const parsed = settleUpEverythingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { idempotencyKey, friendId, method, upiReference, note } = parsed.data;

  const profile = await requireOnboardedProfile();
  const friend = await getFriend(friendId);
  if (!friend) return { ok: false, error: "You can only settle up with friends." };
  // Amounts are worked out here, never taken from the browser; the database checks each one.
  const items = settleableWith(
    await getMyContextBalances(),
    friendId,
    new Set(friend.sharedGroups.map((group) => group.id)),
    await pendingContextKeysWith(friendId),
  ).map((row) => ({ group_id: row.groupId, currency: row.currency, amount: row.amount }));
  if (items.length === 0) return { ok: false, error: "There is nothing to settle with this friend." };

  const supabase = await createClient();
  const { data: ids, error } = await supabase.rpc("settle_up_with_friend", {
    p_idempotency_key: idempotencyKey,
    p_friend_id: friendId,
    p_items: items,
    p_method: method,
    ...(method === "upi" && upiReference ? { p_upi_reference: upiReference } : {}),
    ...(note ? { p_note: note } : {}),
  });
  if (error) return rpcFailure(error);

  const { data: rows, error: readError } = await supabase
    .from("settlements")
    .select("status, payer_id, amount, currency")
    .in("id", ids);
  refresh();
  if (readError) return { ok: true, message: "Settled up." };

  const pending = rows.filter((row) => row.status === "pending");
  const parts = [`Recorded ${rows.length} ${rows.length === 1 ? "settlement" : "settlements"}.`];
  if (pending.length > 0) {
    const owed = pending
      .filter((row) => row.payer_id === profile.id)
      .map((row) => formatMoney(row.amount, row.currency))
      .join(" and ");
    parts.push(`Your payment of ${owed} is waiting for your friend to confirm it.`);
  }
  return { ok: true, message: parts.join(" ") };
}

type Transition = "confirm_settlement" | "reject_settlement" | "cancel_settlement";

type Client = Awaited<ReturnType<typeof createClient>>;

async function transition(
  input: unknown,
  fn: Transition,
  message: string | ((supabase: Client, settlementId: string) => Promise<string>),
): Promise<ActionResult> {
  const parsed = settlementIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  // Confirming or cancelling money needs a session Supabase Auth still knows (L12).
  await requireLiveSession();
  const supabase = await createClient();
  const { settlementId } = parsed.data;
  const { error } = await supabase.rpc(fn, { p_settlement_id: settlementId });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: typeof message === "string" ? message : await message(supabase, settlementId) };
}

/** The receiver confirms a payer's record: only now does it change balances. */
export async function confirmSettlement(input: unknown): Promise<ActionResult> {
  return transition(input, "confirm_settlement", "Payment confirmed. Balances are updated.");
}

/** The receiver says the payment never arrived; balances stay as they were. */
export async function rejectSettlement(input: unknown): Promise<ActionResult> {
  return transition(input, "reject_settlement", "Payment rejected. Balances are unchanged.");
}

/** The payer withdraws a pending record, or either person cancels a completed one (reversed in the ledger). */
export async function cancelSettlement(input: unknown): Promise<ActionResult> {
  return transition(input, "cancel_settlement", async (supabase, settlementId) => {
    const { data } = await supabase.from("settlements").select("status").eq("id", settlementId).maybeSingle();
    return data?.status === "withdrawn"
      ? "Payment withdrawn. Balances are unchanged."
      : "Settlement cancelled and reversed.";
  });
}
