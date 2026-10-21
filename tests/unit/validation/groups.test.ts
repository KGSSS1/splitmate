import { describe, expect, it } from "vitest";

import { addFriendSchema } from "@/lib/validation/friends";
import {
  acceptInvitationSchema,
  createEmailInviteSchema,
  createGroupSchema,
  createInviteLinkSchema,
  setMemberRoleSchema,
  updateGroupSchema,
} from "@/lib/validation/groups";

const GROUP = "0d4b8a52-3c55-4f7e-9b1a-2f6c8e9d1a23";
const valid = { name: "  Goa trip ", description: "", groupType: "trip", defaultCurrency: "INR", simplifyDebts: true };

describe("group settings", () => {
  it("trims the name and accepts every group type", () => {
    expect(createGroupSchema.parse(valid).name).toBe("Goa trip");
    for (const groupType of ["trip", "home", "couple", "other"]) {
      expect(createGroupSchema.safeParse({ ...valid, groupType }).success).toBe(true);
    }
  });

  it.each([
    [{ name: "   " }, "name"],
    [{ name: "x".repeat(101) }, "name"],
    [{ description: "x".repeat(501) }, "description"],
    [{ groupType: "party" }, "groupType"],
    [{ defaultCurrency: "ZZZ" }, "defaultCurrency"],
    [{ simplifyDebts: "yes" }, "simplifyDebts"],
  ])("rejects %j", (change, field) => {
    const result = createGroupSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("needs a group ID to update", () => {
    expect(updateGroupSchema.safeParse(valid).success).toBe(false);
    expect(updateGroupSchema.safeParse({ ...valid, groupId: GROUP }).success).toBe(true);
    expect(updateGroupSchema.safeParse({ ...valid, groupId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("invitations", () => {
  it("accepts only the offered expiry periods", () => {
    expect(createInviteLinkSchema.parse({ groupId: GROUP, expiresInDays: "30" }).expiresInDays).toBe(30);
    expect(createInviteLinkSchema.parse({ groupId: GROUP }).expiresInDays).toBe(7);
    expect(createInviteLinkSchema.safeParse({ groupId: GROUP, expiresInDays: 31 }).success).toBe(false);
  });

  it("normalizes the invited email", () => {
    expect(createEmailInviteSchema.parse({ groupId: GROUP, email: " Bina@Example.COM " }).email).toBe(
      "bina@example.com",
    );
    expect(createEmailInviteSchema.safeParse({ groupId: GROUP, email: "nope" }).success).toBe(false);
  });

  it("accepts URL-safe tokens and an optional group", () => {
    const token = "AbC_-123abc456def789ghi012jkl345mno678pqr90";
    expect(acceptInvitationSchema.safeParse({ token }).success).toBe(true);
    expect(acceptInvitationSchema.safeParse({ token, groupId: GROUP }).success).toBe(true);
    expect(acceptInvitationSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token: `${token}/../x` }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token, groupId: "x" }).success).toBe(false);
  });
});

describe("members and friends", () => {
  it("allows only the admin and member roles", () => {
    expect(setMemberRoleSchema.safeParse({ groupId: GROUP, userId: GROUP, role: "admin" }).success).toBe(true);
    expect(setMemberRoleSchema.safeParse({ groupId: GROUP, userId: GROUP, role: "owner" }).success).toBe(false);
  });

  it("finds friends by a normalized exact email", () => {
    expect(addFriendSchema.parse({ email: " Asha@Example.com" }).email).toBe("asha@example.com");
    expect(addFriendSchema.safeParse({ email: "asha" }).success).toBe(false);
  });
});
