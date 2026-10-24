import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/routes";
import {
  buildInviteMailto,
  buildInvitePath,
  buildInviteUrl,
  INVITE_STATUS_MESSAGES,
  toInviteStatus,
} from "@/lib/groups/invite-link";

const TOKEN = "AbC_-123abc456def789ghi012jkl345mno678pqr90";
const GROUP = "0d4b8a52-3c55-4f7e-9b1a-2f6c8e9d1a23";

describe("invitation links", () => {
  it("puts the token in the path and the group in the query", () => {
    expect(buildInvitePath(TOKEN, GROUP)).toBe(`/invite/${TOKEN}?group=${GROUP}`);
    expect(buildInvitePath(TOKEN)).toBe(`/invite/${TOKEN}`);
    expect(buildInviteUrl("https://splitmate.example", TOKEN, GROUP)).toBe(
      `https://splitmate.example/invite/${TOKEN}?group=${GROUP}`,
    );
  });

  it("is a safe place to return to after signing up", () => {
    expect(safeNextPath(buildInvitePath(TOKEN, GROUP))).toBe(buildInvitePath(TOKEN, GROUP));
  });

  it("builds a prefilled email with the link", () => {
    const mailto = buildInviteMailto("friend@example.com", "Goa & beyond", "https://x.example/invite/t");
    expect(mailto.startsWith("mailto:friend%40example.com?subject=")).toBe(true);
    const params = new URLSearchParams(mailto.split("?")[1]);
    expect(params.get("subject")).toBe('Join "Goa & beyond" on SplitMate');
    expect(params.get("body")).toContain("https://x.example/invite/t");
  });
});

describe("toInviteStatus", () => {
  it("keeps known statuses and treats anything else as not found", () => {
    expect(toInviteStatus("valid")).toBe("valid");
    expect(toInviteStatus("member")).toBe("member");
    expect(toInviteStatus("revoked")).toBe("revoked");
    expect(toInviteStatus("wrong_group")).toBe("wrong_group");
    expect(toInviteStatus("constructor")).toBe("not_found");
    expect(toInviteStatus(null)).toBe("not_found");
  });

  it("has a message for every status that blocks joining", () => {
    for (const status of ["not_found", "wrong_group", "wrong_email", "revoked", "expired", "used", "inactive"] as const) {
      expect(INVITE_STATUS_MESSAGES[status]).toMatch(/\.$/);
    }
  });
});
