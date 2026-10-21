import { brand } from "@/config/brand";

/** Outcomes returned by the `send_friend_request` database function. */
export type FriendRequestStatus =
  | "requested"
  | "already_requested"
  | "accepted"
  | "already_friends"
  | "not_found"
  | "self";

export interface FriendRequestOutcome {
  ok: boolean;
  message: string;
}

/** What to tell the user after asking to add someone by email. */
export function describeFriendRequest(status: string, name: string | null): FriendRequestOutcome {
  const who = name ?? "them";
  switch (status) {
    case "requested":
      return { ok: true, message: `Friend request sent to ${who}.` };
    case "already_requested":
      return { ok: true, message: `You've already sent ${who} a friend request.` };
    case "accepted":
      return { ok: true, message: `You and ${who} are now friends.` };
    case "already_friends":
      return { ok: true, message: `You're already friends with ${who}.` };
    case "not_found":
      return {
        ok: false,
        message: `No ${brand.name} account uses that email address. Ask them to sign up, or invite them to a group.`,
      };
    case "self":
      return { ok: false, message: "That's your own email address." };
    default:
      return { ok: false, message: "Something went wrong. Please try again." };
  }
}
