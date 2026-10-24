import "server-only";

import { type GroupType, toGroupType } from "@/lib/groups/options";
import { type InviteStatus, toInviteStatus } from "@/lib/groups/invite-link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";

export type InvitationPreview =
  | {
      status: "valid" | "member";
      groupId: string;
      groupName: string;
      groupType: GroupType;
      inviterName: string;
      memberCount: number;
      invitedEmail: string | null;
      expiresAt: string;
    }
  | { status: Exclude<InviteStatus, "valid" | "member"> };

/**
 * What an invitation link leads to, without accepting it. Group details come
 * back only when the caller could join (or already belongs); otherwise just the
 * reason the link cannot be used.
 */
export async function getInvitationPreview(token: string, groupId: string | undefined): Promise<InvitationPreview> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_preview", {
    p_token: token,
    ...(groupId ? { p_group_id: groupId } : {}),
  });
  if (error) throw new Error("Could not load this invitation.");

  const row = data[0];
  const status = toInviteStatus(row?.status);
  if ((status === "valid" || status === "member") && row?.group_id && row.group_name) {
    return {
      status,
      groupId: row.group_id,
      groupName: row.group_name,
      groupType: toGroupType(row.group_type),
      inviterName: row.inviter_name ?? "A group member",
      memberCount: row.member_count ?? 0,
      invitedEmail: row.invited_email ?? null,
      expiresAt: row.expires_at,
    };
  }
  return { status: status === "valid" || status === "member" ? "not_found" : status };
}
