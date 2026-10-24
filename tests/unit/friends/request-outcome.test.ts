import { describe, expect, it } from "vitest";

import { describeFriendRequest, NEUTRAL_REQUEST_MESSAGE } from "@/lib/friends/request-outcome";

describe("describeFriendRequest", () => {
  it.each([
    ["accepted", true, "You and Bina are now friends."],
    ["already_friends", true, "You're already friends with Bina."],
  ])("%s → ok=%s", (status, ok, message) => {
    expect(describeFriendRequest(status, "Bina")).toEqual({ ok, message });
  });

  // Review M6 L8 (SPEC §2): the reply never reveals whether the address has an account.
  it("gives one neutral reply for every request to an address, account or not", () => {
    expect(describeFriendRequest("sent", null)).toEqual({ ok: true, message: NEUTRAL_REQUEST_MESSAGE });
    expect(NEUTRAL_REQUEST_MESSAGE).toBe("Request sent. If someone uses SplitMate with that email, they'll see it.");
    expect(NEUTRAL_REQUEST_MESSAGE).not.toMatch(/account|not found|no one/i);
  });

  it("reports your own email as an error", () => {
    expect(describeFriendRequest("self", null)).toEqual({ ok: false, message: "That's your own email address." });
  });

  it("never reports success for an unknown outcome", () => {
    expect(describeFriendRequest("not_found", null).ok).toBe(false);
    expect(describeFriendRequest("something_else", "Bina").ok).toBe(false);
  });
});
