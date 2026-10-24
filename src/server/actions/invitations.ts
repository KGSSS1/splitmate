"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/auth/routes";
import { getClientEnv } from "@/lib/env";
import { DEFAULT_LINK_MAX_USES } from "@/lib/groups/options";
import { buildInviteMailto, buildInviteUrl } from "@/lib/groups/invite-link";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInvitationSchema,
  createEmailInviteSchema,
  createInviteLinkSchema,
  invitationIdSchema,
} from "@/lib/validation/groups";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireOnboardedProfile } from "@/server/auth";

export interface CreatedInvite {
  url: string;
  /** For email invitations: a prefilled message for the inviter's own mail app. */
  mailto?: string;
}

/**
 * The raw token is returned by the database exactly once (only its hash is
 * stored), so the link is shown to the inviter now and never again.
 */
async function createInvite(
  groupId: string,
  email: string | null,
  maxUses: number,
  expiresInDays: number,
): Promise<ActionResult<CreatedInvite>> {
  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_group_id: groupId,
    ...(email ? { p_invited_email: email } : {}),
    p_max_uses: maxUses,
    p_expires_in_hours: expiresInDays * 24,
  });
  if (error) return rpcFailure(error);
  const token = data[0]?.token;
  if (!token) return rpcFailure({});

  const url = buildInviteUrl(getClientEnv().NEXT_PUBLIC_APP_URL, token, groupId);
  let mailto: string | undefined;
  if (email) {
    const { data: group } = await supabase.from("groups").select("name").eq("id", groupId).maybeSingle();
    mailto = buildInviteMailto(email, group?.name ?? "our group", url);
  }

  refresh();
  return { ok: true, data: mailto ? { url, mailto } : { url } };
}

export async function createInviteLink(input: unknown): Promise<ActionResult<CreatedInvite>> {
  const parsed = createInviteLinkSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return createInvite(parsed.data.groupId, null, DEFAULT_LINK_MAX_USES, parsed.data.expiresInDays);
}

/** Single-use, and only the account with this (confirmed) email can accept it. */
export async function createEmailInvite(input: unknown): Promise<ActionResult<CreatedInvite>> {
  const parsed = createEmailInviteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return createInvite(parsed.data.groupId, parsed.data.email, 1, parsed.data.expiresInDays);
}

/** The invitation's creator or a group admin. */
export async function revokeInvitation(input: unknown): Promise<ActionResult> {
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: parsed.data.invitationId });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "Invitation revoked." };
}

/**
 * Joins the group with a link token. The group ID from the link is checked
 * against the token's group by the database, so a token presented for another
 * group is refused.
 */
export async function acceptInvitation(input: unknown): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This invitation link isn't valid." };

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("accept_invitation", {
    p_token: parsed.data.token,
    ...(parsed.data.groupId ? { p_group_id: parsed.data.groupId } : {}),
  });
  if (error) return rpcFailure(error);

  redirect(`${ROUTES.groups}/${groupId}?joined=1`);
}

/** Joins with an invitation addressed to the caller's email (listed on the Groups page). */
export async function acceptInvitationById(input: unknown): Promise<ActionResult> {
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("accept_invitation", {
    p_invitation_id: parsed.data.invitationId,
  });
  if (error) return rpcFailure(error);

  redirect(`${ROUTES.groups}/${groupId}?joined=1`);
}
