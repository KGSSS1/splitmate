import { describe, expect, it } from "vitest";

import { describeFriendRequest } from "@/lib/friends/request-outcome";

describe("describeFriendRequest", () => {
  it.each([
    ["requested", true, "Friend request sent to Bina."],
    ["already_requested", true, "You've already sent Bina a friend request."],
    ["accepted", true, "You and Bina are now friends."],
    ["already_friends", true, "You're already friends with Bina."],
  ])("%s → ok=%s", (status, ok, message) => {
    expect(describeFriendRequest(status, "Bina")).toEqual({ ok, message });
  });

  it("reports unknown emails and your own email as errors", () => {
    expect(describeFriendRequest("not_found", null)).toMatchObject({ ok: false });
    expect(describeFriendRequest("not_found", null).message).toContain("No SplitMate account");
    expect(describeFriendRequest("self", null)).toEqual({ ok: false, message: "That's your own email address." });
  });

  it("never reports success for an unknown outcome", () => {
    expect(describeFriendRequest("something_else", "Bina").ok).toBe(false);
  });
});
