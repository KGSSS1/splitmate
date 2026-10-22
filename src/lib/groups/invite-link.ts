import { brand } from "@/config/brand";
import { ROUTES } from "@/lib/auth/routes";

/**
 * The acceptance URL for an invitation: `/invite/{token}?group={groupId}`.
 * The token alone decides which group is joined; the group ID lets the page
 * refuse a token that is presented for a different group.
 */
export function buildInvitePath(token: string, groupId?: string): string {
  const path = `${ROUTES.invite}/${encodeURIComponent(token)}`;
  return groupId ? `${path}?group=${encodeURIComponent(groupId)}` : path;
}

export function buildInviteUrl(appUrl: string, token: string, groupId: string): string {
  return new URL(buildInvitePath(token, groupId), appUrl).toString();
}

/** A prefilled email in the inviter's own mail app (the core app sends no email, SPEC §15). */
export function buildInviteMailto(email: string, groupName: string, inviteUrl: string): string {
  const subject = `Join "${groupName}" on ${brand.name}`;
  const body = `I've added you to "${groupName}" on ${brand.name} so we can split expenses.\n\nJoin here: ${inviteUrl}\n\nThe link is for ${email} only.`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** What the acceptance page says for each `invitation_preview` status. */
export const INVITE_STATUS_MESSAGES = {
  not_found: "This invitation link isn't valid. Check that you copied all of it, or ask for a new one.",
  wrong_group: "This invitation link isn't valid for this group. Ask the person who invited you for a new link.",
  wrong_email:
    "This invitation was sent to a different email address. Log in with that address, or ask for a new link.",
  revoked: "This invitation has been revoked. Ask the person who invited you for a new one.",
  expired: "This invitation has expired. Ask the person who invited you for a new one.",
  used: "This invitation has already been used. Ask the person who invited you for a new one.",
  inactive: "This invitation is no longer valid. Ask a current group member for a new one.",
} as const;

export type InviteStatus = "valid" | "member" | keyof typeof INVITE_STATUS_MESSAGES;

export function toInviteStatus(value: string | null | undefined): InviteStatus {
  if (value === "valid" || value === "member") return value;
  return value && Object.hasOwn(INVITE_STATUS_MESSAGES, value)
    ? (value as keyof typeof INVITE_STATUS_MESSAGES)
    : "not_found";
}
