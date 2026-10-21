import { describe, expect, it } from "vitest";

import { signInSchema, signUpSchema, updatePasswordSchema } from "@/lib/validation/auth";

describe("auth schemas", () => {
  it("trims and lower-cases emails", () => {
    const parsed = signUpSchema.parse({ email: "  Asha@Example.COM ", password: "long-enough" });
    expect(parsed.email).toBe("asha@example.com");
  });

  it("rejects malformed emails and short passwords with readable messages", () => {
    const result = signUpSchema.safeParse({ email: "not-an-email", password: "short" });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message);
    expect(messages).toContain("Enter a valid email address.");
    expect(messages).toContain("Use at least 8 characters.");
  });

  it("rejects passwords over bcrypt's 72-byte limit, counting bytes not characters", () => {
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "x".repeat(72) }).success).toBe(true);
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "x".repeat(73) }).success).toBe(false);
    // 25 × "₹" is 25 characters but 75 bytes in UTF-8.
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "₹".repeat(25) }).success).toBe(false);
  });

  it("does not apply new-password rules when logging in", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "old" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("requires the confirmation to match the new password", () => {
    const result = updatePasswordSchema.safeParse({ password: "new-password", confirmPassword: "other" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});
