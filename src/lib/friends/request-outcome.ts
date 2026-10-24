import { brand } from "@/config/brand";

/**
 * Outcomes returned by the `send_friend_request` database function. `sent` covers
 * every request to an address, whether or not it has an account (SPEC §2, review
 * L8); the others only describe people the sender already knows.
 */
export type FriendRequestStatus = "sent" | "accepted" | "already_friends" | "self";

export interface FriendRequestOutcome {
  ok: boolean;
  message: string;
}

/** The one reply for a request to an address: it never says whether anyone uses it. */
export const NEUTRAL_REQUEST_MESSAGE = `Request sent. If someone uses ${brand.name} with that email, they'll see it.`;

/** What to tell the user after asking to add someone by email. */
export function describeFriendRequest(status: string, name: string | null): FriendRequestOutcome {
  const who = name ?? "them";
  switch (status) {
    case "sent":
      return { ok: true, message: NEUTRAL_REQUEST_MESSAGE };
    case "accepted":
      return { ok: true, message: `You and ${who} are now friends.` };
    case "already_friends":
      return { ok: true, message: `You're already friends with ${who}.` };
    case "self":
      return { ok: false, message: "That's your own email address." };
    default:
      return { ok: false, message: "Something went wrong. Please try again." };
  }
}
